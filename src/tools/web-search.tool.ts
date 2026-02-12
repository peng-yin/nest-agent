import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { tavily } from '@tavily/core';

/**
 * Web 搜索工具 — 基于 Tavily Search API
 * 专为 AI Agent 设计，返回结构化搜索结果
 */
export const webSearchTool = tool(
  async (input: { query: string; maxResults?: number }) => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      return JSON.stringify({
        error: 'TAVILY_API_KEY not configured',
        message: '请在 .env 中配置 TAVILY_API_KEY',
      });
    }

    try {
      const client = tavily({ apiKey });

      const response = await client.search(input.query, {
        maxResults: input.maxResults || 5,
        searchDepth: 'basic',
        includeAnswer: true,
      });

      const results = response.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
        score: r.score,
      }));

      return JSON.stringify({
        answer: response.answer || '',
        results,
      });
    } catch (err: any) {
      return JSON.stringify({
        error: err.message || 'Search failed',
        results: [],
      });
    }
  },
  {
    name: 'web_search',
    description:
      'Search the web for current information. Use this when you need up-to-date information or facts you are not sure about.',
    schema: z.object({
      query: z.string().describe('The search query'),
      maxResults: z
        .number()
        .optional()
        .default(5)
        .describe('Maximum number of results'),
    }),
  },
);
