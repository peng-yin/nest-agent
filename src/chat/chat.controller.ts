import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Res,
  UseGuards,
  HttpCode,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ChatService } from './chat.service';
import { AgentService } from '../agent/agent.service';
import { JwtAuthGuard, TenantGuard } from '../auth/guards';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TenantId } from '../common/decorators/tenant.decorator';
import { AGUIEvent, EventType, serializeEvent, genId } from '../common/interfaces/ag-ui-events';
import type { AuthenticatedUser } from '../auth/jwt.strategy';

const ChatRequestSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
  llmOptions: z
    .object({
      provider: z.enum(['openai', 'anthropic', 'dashscope']).optional(),
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
    })
    .optional(),
});

const CreateConvSchema = z.object({
  title: z.string().optional(),
  workflowId: z.string().uuid().optional(),
});

@Controller('chat')
@UseGuards(JwtAuthGuard, TenantGuard)
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly agentService: AgentService,
  ) {}

  /**
   * AG-UI 流式对话接口
   * POST /chat/completions
   */
  @Post('completions')
  @HttpCode(200)
  async chatCompletions(
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
    @Res() res: Response,
  ) {
    const dto = ChatRequestSchema.parse(body);

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 获取或创建会话（threadId）
    let threadId = dto.conversationId;
    if (!threadId) {
      const conv = await this.chatService.createConversation(user.id, tenantId, undefined, dto.workflowId);
      threadId = conv.id;
    }

    const runId = genId();

    await this.chatService.addMessage(threadId, tenantId, 'user', dto.message);
    const messages = await this.chatService.getContextMessages(threadId, tenantId);

    // 收集 assistant 回复用于持久化
    const collectedMessages: Map<string, { content: string; role: string }> = new Map();
    let lastStepName = 'assistant';

    const onEvent = (event: AGUIEvent) => {
      res.write(serializeEvent(event));

      // 收集 TextMessage 内容
      if (event.type === EventType.TEXT_MESSAGE_START) {
        collectedMessages.set(event.messageId, { content: '', role: event.role });
      }
      if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
        const msg = collectedMessages.get(event.messageId);
        if (msg) msg.content += event.delta;
      }
      if (event.type === EventType.STEP_STARTED) {
        lastStepName = event.stepName;
      }
    };

    try {
      await this.agentService.execute({
        threadId,
        runId,
        messages,
        workflowId: dto.workflowId,
        llmOptions: dto.llmOptions,
        tenantId,
        onEvent,
      });

      // 持久化所有 assistant 消息
      for (const [, msg] of collectedMessages) {
        if (msg.content && msg.role === 'assistant') {
          await this.chatService.addMessage(threadId, tenantId, 'assistant', msg.content, lastStepName);
        }
      }
    } catch (error: any) {
      this.logger.error(`Chat completion error: ${error.message}`, error.stack);
      const errEvent: AGUIEvent = {
        type: EventType.RUN_ERROR,
        message: error.message,
      };
      res.write(serializeEvent(errEvent));
    } finally {
      res.write('event: done\ndata: [DONE]\n\n');
      res.end();
    }
  }

  @Post('conversations')
  async createConversation(
    @Body() body: any,
    @CurrentUser() user: AuthenticatedUser,
    @TenantId() tenantId: string,
  ) {
    const dto = CreateConvSchema.parse(body);
    return this.chatService.createConversation(user.id, tenantId, dto.title, dto.workflowId);
  }

  @Get('conversations')
  async listConversations(@CurrentUser() user: AuthenticatedUser, @TenantId() tenantId: string) {
    return this.chatService.listConversations(user.id, tenantId);
  }

  @Get('conversations/:id/messages')
  async getMessages(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.chatService.getMessages(id, tenantId);
  }

  @Delete('conversations/:id')
  async deleteConversation(@Param('id') id: string, @TenantId() tenantId: string) {
    await this.chatService.deleteConversation(id, tenantId);
    return { success: true };
  }
}
