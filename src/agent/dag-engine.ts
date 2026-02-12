import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, MessagesAnnotation, START, END, Command } from '@langchain/langgraph';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StructuredToolInterface } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage } from '@langchain/core/messages';
import { WorkflowNode, WorkflowEdge } from '../entities/workflow.entity';
import { AGUIEvent, EventType } from '../common/interfaces/ag-ui-events';

export interface DagExecutionContext {
  llm: BaseChatModel;
  tools: Map<string, StructuredToolInterface>;
  onEvent?: (event: AGUIEvent) => void;
  threadId: string;
}

@Injectable()
export class DagEngine {
  private readonly logger = new Logger(DagEngine.name);

  compile(nodes: WorkflowNode[], edges: WorkflowEdge[], ctx: DagExecutionContext) {
    const graph = new StateGraph(MessagesAnnotation);

    const adjacency = new Map<string, WorkflowEdge[]>();
    for (const edge of edges) {
      if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
      adjacency.get(edge.source)!.push(edge);
    }

    for (const node of nodes) {
      if (node.type === 'start' || node.type === 'end') continue;

      const outEdges = adjacency.get(node.id) || [];
      const endNodes = outEdges.map((e) => {
        const target = nodes.find((n) => n.id === e.target);
        return target?.type === 'end' ? END : e.target;
      });

      graph.addNode(node.id, this.createNodeFn(node, ctx, adjacency, nodes), {
        ends: endNodes.length > 0 ? endNodes : [END],
      });
    }

    const startEdge = edges.find((e) => nodes.find((n) => n.id === e.source)?.type === 'start');
    if (startEdge) graph.addEdge(START, startEdge.target as any);

    return graph.compile();
  }

  private createNodeFn(
    node: WorkflowNode,
    ctx: DagExecutionContext,
    adjacency: Map<string, WorkflowEdge[]>,
    allNodes: WorkflowNode[],
  ) {
    const emit = (event: AGUIEvent) => ctx.onEvent?.(event);

    return async (state: typeof MessagesAnnotation.State) => {
      emit({ type: EventType.STEP_STARTED, stepName: node.name });

      let result: any;

      try {
        if (node.type === 'agent') {
          const tools = (node.config.tools || []).map((n: string) => ctx.tools.get(n)).filter(Boolean) as StructuredToolInterface[];
          const agent = createReactAgent({ llm: ctx.llm, tools, name: node.name, prompt: node.config.prompt || `You are ${node.name}.` });
          result = await agent.invoke({ messages: state.messages });
        } else if (node.type === 'tool') {
          const tool = ctx.tools.get(node.config.toolName);
          if (!tool) {
            this.logger.warn(`Tool "${node.config.toolName}" not found for node "${node.name}", skipping`);
          } else {
            const output = await tool.invoke(JSON.stringify(node.config.input || {}));
            result = { messages: [...state.messages, new HumanMessage(`[Tool ${node.name}]: ${output}`)] };
          }
        } else if (node.type === 'condition') {
          const outEdges = adjacency.get(node.id) || [];
          const lastContent = typeof state.messages.at(-1)?.content === 'string' ? (state.messages.at(-1)!.content as string) : '';
          const matched = outEdges.find((e) => e.condition && lastContent.toLowerCase().includes(e.condition.toLowerCase()));
          const target = matched?.target || outEdges[0]?.target || END;

          emit({ type: EventType.STEP_FINISHED, stepName: node.name });
          return new Command({ goto: target, update: { messages: state.messages } });
        }
      } catch (err: any) {
        this.logger.error(`Node "${node.name}" execution failed: ${err.message}`, err.stack);
        result = { messages: [...state.messages, new HumanMessage(`[Error in ${node.name}]: ${err.message}`)] };
      }

      emit({ type: EventType.STEP_FINISHED, stepName: node.name });

      const outEdges = adjacency.get(node.id) || [];
      if (outEdges.length === 1) {
        const targetId = outEdges[0].target;
        const targetNode = allNodes.find((n) => n.id === targetId);
        return new Command({
          goto: targetNode?.type === 'end' ? END : targetId,
          update: result || { messages: state.messages },
        });
      }

      return result || { messages: state.messages };
    };
  }
}
