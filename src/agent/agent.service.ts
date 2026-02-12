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

    for await (const event of eventStream) {
      const { event: eventName, data, name: runName, tags, metadata } = event;

      // 从 metadata 或 tags 中提取当前节点名
      const langgraphNode = metadata?.langgraph_node || '';

      // ── LLM token 级别流式 ──
      if (eventName === 'on_chat_model_stream' && data.chunk) {
        const chunk = data.chunk;

        // 跳过 supervisor 路由节点的流式输出
        if (langgraphNode === 'supervisor') continue;

        // 确保 step 已开始
        if (langgraphNode && !activeSteps.has(langgraphNode)) {
          activeSteps.add(langgraphNode);
          onEvent({ type: EventType.STEP_STARTED, stepName: langgraphNode });
        }

        // 工具调用 chunk
        if (chunk.tool_call_chunks?.length > 0) {
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
        const textContent = typeof chunk.content === 'string' ? chunk.content : '';
        if (textContent) {
          if (!currentMessageId) {
            currentMessageId = genId();
            onEvent({ type: EventType.TEXT_MESSAGE_START, messageId: currentMessageId, role: 'assistant' });
          }
          onEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: currentMessageId, delta: textContent });
        }
      }

      // ── LLM 调用结束 ──
      if (eventName === 'on_chat_model_end' && data.output) {
        if (langgraphNode === 'supervisor') continue;

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
      if (eventName === 'on_chain_end' && langgraphNode && activeSteps.has(langgraphNode)) {
        // 只在顶层节点结束时发射 StepFinished（避免内部 chain 的 end 事件）
        const isTopLevel = metadata?.langgraph_step !== undefined && !metadata?.langgraph_checkpoint_ns;
        if (isTopLevel) {
          // 确保文本消息已关闭
          if (currentMessageId) {
            onEvent({ type: EventType.TEXT_MESSAGE_END, messageId: currentMessageId });
            currentMessageId = null;
          }
          onEvent({ type: EventType.STEP_FINISHED, stepName: langgraphNode });
          activeSteps.delete(langgraphNode);
        }
      }
    }

    // 确保最后的文本消息已关闭
    if (currentMessageId) {
      onEvent({ type: EventType.TEXT_MESSAGE_END, messageId: currentMessageId });
    }
  }
}
