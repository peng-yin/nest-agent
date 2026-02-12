import { Injectable, Logger } from '@nestjs/common';
import { StateGraph, MessagesAnnotation, Command, START, END } from '@langchain/langgraph';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

export interface AgentDefinition {
  name: string;
  prompt: string;
  tools: StructuredToolInterface[];
  llm?: BaseChatModel;
}

@Injectable()
export class SupervisorFactory {
  private readonly logger = new Logger(SupervisorFactory.name);

  createSupervisorGraph(llm: BaseChatModel, agents: AgentDefinition[]) {
    const agentNames = agents.map((a) => a.name);
    this.logger.log(`Creating supervisor with agents: ${agentNames.join(', ')}`);

    // 路由 schema
    const routeOptions = [...agentNames, 'RESPOND', '__end__'] as unknown as [string, ...string[]];
    const routeSchema = z.object({
      next: z.enum(routeOptions).describe('Route to an agent, RESPOND to answer directly, or __end__ if done'),
      reason: z.string().describe('Brief reason for this routing decision'),
    });

    const systemPrompt =
      `You are a team supervisor managing agents: ${agentNames.join(', ')}.\n\n` +
      `Rules:\n` +
      `- Route to the appropriate agent for specialized tasks.\n` +
      `- Choose RESPOND for general questions or simple conversations.\n` +
      `- Choose __end__ when a sub-agent has already provided a complete answer.\n\n` +
      `Agents:\n` +
      agents.map((a) => `- ${a.name}: ${a.prompt}`).join('\n');

    // Supervisor 路由节点
    const supervisorNode = async (state: typeof MessagesAnnotation.State) => {
      const response = await llm.withStructuredOutput(routeSchema).invoke([
        { role: 'system', content: systemPrompt },
        ...state.messages,
      ]);

      const goto = response.next === 'RESPOND' ? 'responder' : response.next === '__end__' ? END : response.next;
      return new Command({
        goto,
        update: {
          messages: [{ role: 'assistant' as const, content: `[Supervisor] Routing to ${response.next}: ${response.reason}`, name: 'supervisor' }],
        },
      });
    };

    // 直接回复节点
    const responderNode = async (state: typeof MessagesAnnotation.State) => {
      const filtered = state.messages.filter((m: any) => !(typeof m.content === 'string' && m.content.startsWith('[Supervisor]')));
      const response = await llm.invoke([
        { role: 'system', content: 'You are a helpful AI assistant. Answer naturally. Respond in the same language as the user.' },
        ...filtered,
      ]);
      return new Command({ goto: END, update: { messages: [response] } });
    };

    // 构建 StateGraph
    const graph = new StateGraph(MessagesAnnotation);

    graph.addNode('supervisor', supervisorNode, { ends: [...agentNames, 'responder', END] });
    graph.addNode('responder', responderNode, { ends: [END] });

    for (const agentDef of agents) {
      const reactAgent = createReactAgent({
        llm: agentDef.llm || llm,
        tools: agentDef.tools,
        name: agentDef.name,
        prompt: agentDef.prompt,
      });

      graph.addNode(
        agentDef.name,
        async (state: typeof MessagesAnnotation.State) => {
          const result = await reactAgent.invoke({ messages: state.messages });
          return new Command({ goto: 'supervisor', update: { messages: result.messages } });
        },
        { ends: ['supervisor'] },
      );
    }

    graph.addEdge(START, 'supervisor' as any);
    return graph.compile();
  }
}
