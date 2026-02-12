import { Injectable, Logger } from '@nestjs/common';
import { LLMService, LLMOptions } from '../llm/llm.service';
import { ToolRegistry } from '../tools/tool-registry';
import { SupervisorFactory, AgentDefinition } from './supervisor.factory';
import { DagEngine, DagExecutionContext } from './dag-engine';
import { WorkflowService } from './workflow.service';
import { RagService } from '../rag/rag.service';
import { createRagRetrievalTool } from '../tools/rag-retrieval.tool';
import { AGUIEvent, EventType, genId } from '../common/interfaces/ag-ui-events';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';

export interface OrchestrationRequest {
  threadId: string;
  runId: string;
  messages: Array<{ role: string; content: string }>;
  workflowId?: string;
  llmOptions?: LLMOptions;
  tenantId: string;
  onEvent: (event: AGUIEvent) => void;
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  private readonly defaultAgents: Omit<AgentDefinition, 'tools'>[] = [
    {
      name: 'researcher',
      prompt:
        'You are a research agent with two tools: rag_retrieval and web_search.\n' +
        '- ALWAYS try rag_retrieval FIRST to search the internal knowledge base.\n' +
        '- If the user explicitly mentions "知识库" (knowledge base), you MUST use rag_retrieval.\n' +
        '- Only use web_search if rag_retrieval returns no useful results or for real-time information.\n' +
        '- Always cite your sources.',
    },
  ];

  private readonly agentToolMapping: Record<string, string[]> = {
    researcher: ['web_search', 'rag_retrieval'],
  };

  constructor(
    private readonly llmService: LLMService,
    private readonly toolRegistry: ToolRegistry,
    private readonly supervisorFactory: SupervisorFactory,
    private readonly dagEngine: DagEngine,
    private readonly workflowService: WorkflowService,
    private readonly ragService: RagService,
  ) {}

  async execute(request: OrchestrationRequest): Promise<void> {
    const { threadId, runId, onEvent } = request;

    // RunStarted
    onEvent({ type: EventType.RUN_STARTED, threadId, runId });

    try {
      if (request.workflowId) {
        await this.executeDag(request);
      } else {
        await this.executeSupervisor(request);
      }
      // RunFinished
      onEvent({ type: EventType.RUN_FINISHED, threadId, runId });
    } catch (error: any) {
      this.logger.error(`Agent execution error: ${error.message}`, error.stack);
      onEvent({ type: EventType.RUN_ERROR, message: error.message });
    }
  }

  private toLangChainMessages(messages: Array<{ role: string; content: string }>): BaseMessage[] {
    return messages.map((m) => {
      if (m.role === 'system') return new SystemMessage(m.content);
      if (m.role === 'assistant') return new AIMessage(m.content);
      return new HumanMessage(m.content);
    });
  }

  // ─── Supervisor 模式 ───

  private async executeSupervisor(request: OrchestrationRequest) {
    const { onEvent } = request;
    const llm = this.llmService.createModel({ ...request.llmOptions, streaming: true });

    // 动态创建带 tenantId 的 rag_retrieval 工具
    const ragTool = createRagRetrievalTool(this.ragService, request.tenantId);

    const agentDefs: AgentDefinition[] = this.defaultAgents.map((def) => {
      const registeredTools = this.toolRegistry.getByNames(
        (this.agentToolMapping[def.name] || []).filter((n) => n !== 'rag_retrieval'),
      );
      // 为 researcher 追加动态 rag_retrieval 工具
      if (this.agentToolMapping[def.name]?.includes('rag_retrieval')) {
        registeredTools.push(ragTool);
      }
      return { ...def, tools: registeredTools };
    });

    this.logger.log(`Supervisor agents: ${agentDefs.map((a) => `${a.name}[${a.tools.map((t) => t.name).join(',')}]`).join(', ')}`);

    const graph = this.supervisorFactory.createSupervisorGraph(llm, agentDefs);
    await this.processStreamEvents(graph, request.messages, onEvent, 25);
  }

  // ─── DAG 模式 ───

  private async executeDag(request: OrchestrationRequest) {
    const { onEvent } = request;
    const workflow = await this.workflowService.findById(request.workflowId!, request.tenantId);
    if (!workflow) throw new Error(`Workflow ${request.workflowId} not found`);

    const llm = this.llmService.createModel({ ...request.llmOptions, streaming: true });
    const toolsMap = new Map(this.toolRegistry.getAll().map((t) => [t.name, t]));

    const ctx: DagExecutionContext = { llm, tools: toolsMap, onEvent, threadId: request.threadId };
    const graph = this.dagEngine.compile(workflow.nodes, workflow.edges, ctx);
    await this.processStreamEvents(graph, request.messages, onEvent, 50);
  }

  /**
   * 使用 streamEvents 实现 token 级别的流式输出
   * 通过 on_chat_model_stream 事件获取 LLM 逐 token 生成的内容
   */
  private async processStreamEvents(
    graph: any,
    messages: Array<{ role: string; content: string }>,
    onEvent: (e: AGUIEvent) => void,
    recursionLimit: number,
  ) {
    const eventStream = graph.streamEvents(
      { messages: this.toLangChainMessages(messages) },
      { version: 'v2', recursionLimit },
    );

    // 跟踪当前正在流式输出的文本消息
    let currentMessageId: string | null = null;
    // 跟踪已发射过的 step
    const activeSteps = new Set<string>();
    // 跟踪已处理过的工具调用
    const emittedToolCalls = new Set<string>();
    // 跟踪已看到的 tool 消息
    const emittedToolResults = new Set<string>();
    // 标记当前是否正处于工具调用阶段（跳过工具调用期间的文本输出）
    let inToolCall = false;
    // 累积文本缓冲区，用于检测和过滤 XML 工具调用标签
    let textBuffer = '';
    // 跟踪每个节点是否已执行过工具调用（用于过滤子 agent 工具调用前的"思考"文本）
    const nodeHasToolCall = new Set<string>();
    // 跟踪每个节点的工具调用是否已完成（收到 on_tool_end）
    const nodeToolsDone = new Set<string>();
    // 标记某个节点是否需要抑制工具调用前的文本（即子 agent 节点）
    // 对于使用 createReactAgent 的子 agent，工具调用前的文本通常是复述 prompt 指令
    let pendingTextPerNode = new Map<string, string>();

    // 检测文本中是否包含 XML 格式的工具调用标签（某些模型如 qwen 会这样输出）
    const TOOL_CALL_XML_RE = /<\/?tool_call>|<tool_call\b/;
    const TOOL_CALL_BLOCK_RE = /<tool_call[\s\S]*?<\/tool_call>/g;

    // 提取 chunk.content 中的纯文本
    const extractText = (content: any): string => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .filter((c: any) => c.type === 'text')
          .map((c: any) => c.text || '')
          .join('');
      }
      return '';
    };

    // 将缓冲区中清洗过的文本发射出去
    const flushTextBuffer = () => {
      if (!textBuffer) return;
      // 移除完整的 <tool_call>...</tool_call> 块
      let cleaned = textBuffer.replace(TOOL_CALL_BLOCK_RE, '');
      // 移除残留的开/闭标签及其属性
      cleaned = cleaned.replace(/<\/?tool_call[^>]*>/g, '').trim();
      if (cleaned) {
        if (!currentMessageId) {
          currentMessageId = genId();
          onEvent({ type: EventType.TEXT_MESSAGE_START, messageId: currentMessageId, role: 'assistant' });
        }
        onEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: currentMessageId, delta: cleaned });
      }
      textBuffer = '';
    };

    for await (const event of eventStream) {
      const { event: eventName, data, name: runName, tags, metadata } = event;

      // 从 metadata 中提取当前节点名
      // 对于嵌套子图（如 createReactAgent），checkpoint_ns 格式为 "researcher:xxx"
      const langgraphNode = metadata?.langgraph_node || '';
      const checkpointNs: string = metadata?.langgraph_checkpoint_ns || '';
      // 提取顶层父节点名（用于 step 追踪）
      const parentNode = checkpointNs ? checkpointNs.split(':')[0] : '';
      const effectiveNode = parentNode || langgraphNode;

      // ── LLM token 级别流式 ──
      if (eventName === 'on_chat_model_stream' && data.chunk) {
        const chunk = data.chunk;

        // 跳过 supervisor 路由节点的流式输出
        if (langgraphNode === 'supervisor' || effectiveNode === 'supervisor') continue;

        // 确保 step 已开始（使用 effectiveNode 作为 step 名）
        if (effectiveNode && !activeSteps.has(effectiveNode)) {
          activeSteps.add(effectiveNode);
          onEvent({ type: EventType.STEP_STARTED, stepName: effectiveNode });
        }

        // 结构化工具调用 chunk（OpenAI 等标准模型）
        if (chunk.tool_call_chunks?.length > 0) {
          // 工具调用开始 → 丢弃子 agent 之前暂存的"思考"文本
          if (effectiveNode && parentNode && langgraphNode !== parentNode) {
            pendingTextPerNode.delete(effectiveNode);
          }
          flushTextBuffer();
          inToolCall = true;
          if (effectiveNode) nodeHasToolCall.add(effectiveNode);

          for (const tc of chunk.tool_call_chunks) {
            const toolCallId = tc.id || '';
            if (toolCallId && !emittedToolCalls.has(toolCallId)) {
              emittedToolCalls.add(toolCallId);
              onEvent({
                type: EventType.TOOL_CALL_START,
                toolCallId,
                toolCallName: tc.name || '',
                parentMessageId: genId(),
              });
            }
            if (toolCallId && tc.args) {
              onEvent({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: tc.args });
            }
          }
          continue;
        }

        // 文本内容 token
        const textContent = extractText(chunk.content);
        if (!textContent) continue;

        // 如果正在结构化工具调用阶段，跳过同步输出的文本（通常是冗余的）
        if (inToolCall) continue;

        // 检查是否包含 XML 工具调用标签
        if (TOOL_CALL_XML_RE.test(textContent) || TOOL_CALL_XML_RE.test(textBuffer + textContent)) {
          textBuffer += textContent;
          // 同时标记此节点有工具调用（XML 格式的）
          if (effectiveNode) nodeHasToolCall.add(effectiveNode);
          continue;
        }

        // 对于嵌套子 agent（如 createReactAgent 内部的 LLM），
        // 当 langgraphNode !== parentNode 时说明是子图内部的 LLM 调用
        // 如果工具尚未完成，暂存文本以过滤工具调用前模型复述 prompt 的"思考"文本
        const isNestedAgent = parentNode && langgraphNode !== parentNode;
        if (isNestedAgent && !nodeToolsDone.has(effectiveNode)) {
          const prev = pendingTextPerNode.get(effectiveNode) || '';
          pendingTextPerNode.set(effectiveNode, prev + textContent);
          continue;
        }

        // 如果缓冲区有内容，先刷出
        if (textBuffer) {
          textBuffer += textContent;
          flushTextBuffer();
          continue;
        }

        // 正常文本 token，直接发射
        if (!currentMessageId) {
          currentMessageId = genId();
          onEvent({ type: EventType.TEXT_MESSAGE_START, messageId: currentMessageId, role: 'assistant' });
        }
        onEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: currentMessageId, delta: textContent });
      }

      // ── LLM 调用结束 ──
      if (eventName === 'on_chat_model_end' && data.output) {
        if (langgraphNode === 'supervisor' || effectiveNode === 'supervisor') continue;

        // 刷出剩余文本缓冲区
        flushTextBuffer();
        inToolCall = false;

        const output = data.output;

        // 结束工具调用
        if (output.tool_calls?.length > 0) {
          for (const tc of output.tool_calls) {
            const toolCallId = tc.id || '';
            if (toolCallId && emittedToolCalls.has(toolCallId)) {
              onEvent({ type: EventType.TOOL_CALL_END, toolCallId });
            }
          }
        }

        // 结束文本消息
        if (currentMessageId) {
          onEvent({ type: EventType.TEXT_MESSAGE_END, messageId: currentMessageId });
          currentMessageId = null;
        }
      }

      // ── 工具执行结果 ──
      if (eventName === 'on_tool_end' && data.output) {
        const toolCallId = metadata?.langgraph_tool_call_id || genId();
        // 标记该节点的工具已执行完成，后续 LLM 输出可以正常流式发射
        if (effectiveNode) nodeToolsDone.add(effectiveNode);

        if (!emittedToolResults.has(toolCallId)) {
          emittedToolResults.add(toolCallId);
          const content = typeof data.output === 'string' ? data.output :
            (data.output?.content ? String(data.output.content) : JSON.stringify(data.output));
          onEvent({
            type: EventType.TOOL_CALL_RESULT,
            messageId: genId(),
            toolCallId,
            role: 'tool',
            content,
          });
        }
      }

      // ── 节点执行结束 ──
      if (eventName === 'on_chain_end') {
        const stepNode = effectiveNode || langgraphNode;
        if (stepNode && activeSteps.has(stepNode)) {
          // 顶层节点结束：checkpoint_ns 为空且 langgraph_node 匹配
          const isTopLevel = !checkpointNs && metadata?.langgraph_step !== undefined;
          if (isTopLevel) {
            flushTextBuffer();
            if (currentMessageId) {
              onEvent({ type: EventType.TEXT_MESSAGE_END, messageId: currentMessageId });
              currentMessageId = null;
            }
            onEvent({ type: EventType.STEP_FINISHED, stepName: stepNode });
            activeSteps.delete(stepNode);
          }
        }
      }
    }

    // 确保最后的缓冲区和文本消息已关闭
    flushTextBuffer();
    if (currentMessageId) {
      onEvent({ type: EventType.TEXT_MESSAGE_END, messageId: currentMessageId });
    }
  }
}
