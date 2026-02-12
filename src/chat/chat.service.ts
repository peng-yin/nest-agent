import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';
import { Message, MessageRole } from '../entities/message.entity';
import { RedisService } from '../redis/redis.service';
import { LLMService } from '../llm/llm.service';

const CACHE_TTL = 3600;
const CONV_KEY = (id: string) => `conv:${id}`;
const MSG_KEY = (id: string) => `conv_msgs:${id}`;

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly windowSize: number;
  private readonly summaryThreshold: number;

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly llmService: LLMService,
  ) {
    this.windowSize = this.configService.get<number>('memory.windowSize') || 10;
    this.summaryThreshold = this.configService.get<number>('memory.summaryThreshold') || 20;
  }

  // ─── 会话 CRUD ───

  async createConversation(userId: string, tenantId: string, title?: string, workflowId?: string) {
    const conv = await this.convRepo.save(
      this.convRepo.create({ userId, tenantId, title: title || 'New Conversation', workflowId }),
    );
    await this.redisService.setJson(CONV_KEY(conv.id), conv, CACHE_TTL);
    return conv;
  }

  async getConversation(id: string, tenantId: string) {
    const cached = await this.redisService.getJson<Conversation>(CONV_KEY(id));
    if (cached?.tenantId === tenantId) return cached;

    const conv = await this.convRepo.findOne({ where: { id, tenantId } });
    if (conv) await this.redisService.setJson(CONV_KEY(id), conv, CACHE_TTL);
    return conv;
  }

  async listConversations(userId: string, tenantId: string) {
    return this.convRepo.find({ where: { userId, tenantId }, order: { updatedAt: 'DESC' } });
  }

  async deleteConversation(id: string, tenantId: string) {
    await this.msgRepo.delete({ conversationId: id, tenantId });
    await this.convRepo.delete({ id, tenantId });
    await this.redisService.del(CONV_KEY(id));
    await this.redisService.del(MSG_KEY(id));
  }

  /**
   * 根据用户第一条消息自动生成对话标题
   */
  async generateTitle(conversationId: string, tenantId: string, userMessage: string) {
    try {
      const llm = this.llmService.createModel({ streaming: false, temperature: 0.3 });
      const result = await llm.invoke([
        {
          role: 'system',
          content:
            '根据用户的消息，生成一个简短的对话标题（不超过15个字）。直接输出标题文本，不要加引号或其他标点。用与用户消息相同的语言。',
        },
        { role: 'user', content: userMessage },
      ] as any);
      const title = typeof result.content === 'string' ? result.content.trim().slice(0, 50) : '';
      if (title) {
        await this.convRepo.update({ id: conversationId, tenantId }, { title });
        await this.redisService.del(CONV_KEY(conversationId));
        this.logger.log(`Title generated for ${conversationId}: ${title}`);
      }
    } catch (err: any) {
      this.logger.error(`Title generation failed: ${err.message}`);
    }
  }

  // ─── 消息 ───

  async addMessage(conversationId: string, tenantId: string, role: MessageRole, content: string, agentName?: string) {
    const saved = await this.msgRepo.save(
      this.msgRepo.create({ conversationId, tenantId, role, content, agentName }),
    );
    // 追加到缓存
    const cached = await this.redisService.getJson<Message[]>(MSG_KEY(conversationId));
    if (cached) {
      cached.push(saved);
      await this.redisService.setJson(MSG_KEY(conversationId), cached, CACHE_TTL);
    }
    return saved;
  }

  async getMessages(conversationId: string, tenantId: string) {
    const cached = await this.redisService.getJson<Message[]>(MSG_KEY(conversationId));
    if (cached) return cached;

    const messages = await this.msgRepo.find({
      where: { conversationId, tenantId },
      order: { createdAt: 'ASC' },
    });
    if (messages.length) await this.redisService.setJson(MSG_KEY(conversationId), messages, CACHE_TTL);
    return messages;
  }

  // ─── 记忆策略：滑动窗口 + 摘要压缩 ───

  /**
   * 获取带记忆策略的上下文消息
   * - 消息数 <= windowSize → 全量
   * - 消息数 > summaryThreshold → 自动摘要 + 最近 N 条
   * - 中间 → 纯滑动窗口
   */
  async getContextMessages(conversationId: string, tenantId: string): Promise<Array<{ role: string; content: string }>> {
    const all = await this.getMessages(conversationId, tenantId);

    // 不超过窗口，全量返回
    if (all.length <= this.windowSize) {
      return all.map((m) => ({ role: m.role, content: m.content }));
    }

    // 超过阈值，触发摘要
    let conv = await this.getConversation(conversationId, tenantId);
    if (all.length > this.summaryThreshold && conv) {
      await this.generateSummary(conversationId, tenantId, all, conv);
      conv = await this.convRepo.findOne({ where: { id: conversationId, tenantId } });
    }

    // 最近 N 条
    const recent = all.slice(-this.windowSize).map((m) => ({ role: m.role, content: m.content }));

    // 有摘要则前置
    if (conv?.summary) {
      return [{ role: 'system', content: `[对话历史摘要]\n${conv.summary}` }, ...recent];
    }
    return recent;
  }

  /** 用 LLM 自动压缩历史消息为摘要 */
  private async generateSummary(conversationId: string, tenantId: string, all: Message[], conv: Conversation) {
    try {
      const toSummarize = all.slice(0, -this.windowSize);
      const existing = conv.summary || '';

      // 构建提示
      let prompt = existing
        ? `已有的历史摘要：\n${existing}\n\n新增的对话内容：\n`
        : '请将以下对话历史压缩为摘要：\n\n';
      for (const m of toSummarize) {
        prompt += `[${m.role === 'user' ? '用户' : '助手'}]: ${m.content}\n`;
      }
      prompt += '\n请输出一段简洁的摘要（保留关键信息、决策结果和用户偏好）：';

      const llm = this.llmService.createModel({ streaming: false, temperature: 0.3 });
      const result = await llm.invoke([
        { role: 'system', content: '你是一个对话摘要助手。请将对话历史压缩为简洁的摘要，保留关键信息。用中文输出。' },
        { role: 'user', content: prompt },
      ] as any);

      const summary = typeof result.content === 'string' ? result.content : '';

      if (summary) {
        const lastId = toSummarize[toSummarize.length - 1]?.id;
        await this.convRepo.update({ id: conversationId, tenantId }, { summary, summaryUntilMessageId: lastId });
        await this.redisService.del(CONV_KEY(conversationId));
        this.logger.log(`Summary generated for ${conversationId}, compressed ${toSummarize.length} messages`);
      }
    } catch (err: any) {
      this.logger.error(`Summary generation failed: ${err.message}`);
    }
  }
}
