import { tool } from '@langchain/core/tools';
import { z } from 'zod';

/**
 * RAG 知识库检索工具（工厂函数）
 * vectorStore 在运行时由 RAG 模块注入
 */
export function createRagRetrievalTool(vectorStore: any) {
  return tool(
    async (input: { query: string; topK?: number; knowledgeBaseId?: string }) => {
      try {
        const retriever = vectorStore.asRetriever({
          k: input.topK || 5,
          filter: input.knowledgeBaseId
            ? { knowledgeBaseId: input.knowledgeBaseId }
            : undefined,
        });

        const docs = await retriever.invoke(input.query);

        const results = docs.map((doc: any) => ({
          content: doc.pageContent,
          metadata: doc.metadata,
          score: doc.metadata?.score,
        }));

        return JSON.stringify({ results, success: true });
      } catch (err: any) {
        return JSON.stringify({ error: err.message, success: false });
      }
    },
    {
      name: 'rag_retrieval',
      description:
        'Search the knowledge base for relevant information. Use this when the user asks about domain-specific knowledge.',
      schema: z.object({
        query: z.string().describe('The search query'),
        topK: z.number().optional().default(5).describe('Number of results to return'),
        knowledgeBaseId: z.string().optional().describe('Specific knowledge base ID to search'),
      }),
    },
  );
}
