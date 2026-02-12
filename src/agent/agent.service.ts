import { Injectable, Logger } from '@nestjs/common';
import { LLMService, LLMOptions } from '../llm/llm.service';
import { ToolRegistry } from '../tools/tool-registry';
import { SupervisorFactory, AgentDefinition } from './supervisor.factory';
import { DagEngine, DagExecutionContext } from './dag-engine';
import { WorkflowService } from './workflow.service';
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
      prompt: 'You are a research agent. Use web search and RAG retrieval to find relevant information. Always cite your sources.',
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

  private extractContent(msg: any): string {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    }
    return '';
  }

  // ─── Supervisor 模式 ───

  private async executeSupervisor(request: OrchestrationRequest) {
    const { onEvent } = request;
    const llm = this.llmService.createModel({ ...request.llmOptions, streaming: true });

    const agentDefs: AgentDefinition[] = this.defaultAgents.map((def) => ({
      ...def,
      tools: this.toolRegistry.getByNames(this.agentToolMapping[def.name] || []),
    }));

    const graph = this.supervisorFactory.createSupervisorGraph(llm, agentDefs);
    const stream = await graph.stream(
      { messages: this.toLangChainMessages(request.messages) },
      { recursionLimit: 25 },
    );

    await this.processGraphStream(stream, onEvent);
  }

  /** 处理 LangGraph 流式消息 → 发射 AG-UI 事件 */
  private processStreamMessage(msg: any, agentName: string, onEvent: (e: AGUIEvent) => void) {
    const msgType = msg._getType?.() || msg.constructor?.name?.toLowerCase();
    const content = this.extractContent(msg);

    if (msgType === 'ai' || msg.constructor?.name === 'AIMessage') {
      // 工具调用 → ToolCall Start/Args/End
      if (msg.tool_calls?.length > 0) {
        for (const tc of msg.tool_calls) {
          const toolCallId = tc.id || genId();
          const messageId = genId();

          onEvent({ type: EventType.TOOL_CALL_START, toolCallId, toolCallName: tc.name, parentMessageId: messageId });
          onEvent({ type: EventType.TOOL_CALL_ARGS, toolCallId, delta: JSON.stringify(tc.args) });
          onEvent({ type: EventType.TOOL_CALL_END, toolCallId });
        }
      }

      // Supervisor 路由 → StepStarted
      if (content.startsWith('[Supervisor]')) {
        onEvent({ type: EventType.STEP_STARTED, stepName: agentName });
        return;
      }

      // 普通文本 → TextMessage Start/Content/End (三段式)
      if (content) {
        const messageId = genId();
        onEvent({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' });
        onEvent({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: content });
        onEvent({ type: EventType.TEXT_MESSAGE_END, messageId });
        onEvent({ type: EventType.STEP_FINISHED, stepName: agentName });
      }
      return;
    }

    // 工具结果 → ToolCallResult
    if (msgType === 'tool') {
      onEvent({
        type: EventType.TOOL_CALL_RESULT,
        messageId: genId(),
        toolCallId: msg.tool_call_id || genId(),
        role: 'tool',
        content,
      });
    }
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

    const stream = await graph.stream(
      { messages: this.toLangChainMessages(request.messages) },
      { recursionLimit: 50 },
    );

    await this.processGraphStream(stream, onEvent);
  }

  /** 公共：遍历 LangGraph stream 并发射 AG-UI 事件 */
  private async processGraphStream(
    stream: AsyncIterable<Record<string, any>>,
    onEvent: (e: AGUIEvent) => void,
  ) {
    for await (const chunk of stream) {
      for (const [nodeName, nodeState] of Object.entries(chunk)) {
        if (nodeName === '__end__') continue;
        const { messages } = nodeState as any;
        if (!messages) continue;

        for (const msg of messages) {
          this.processStreamMessage(msg, nodeName, onEvent);
        }
      }
    }
  }
}
