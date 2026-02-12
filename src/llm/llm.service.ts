import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';

export type LLMProvider = 'openai' | 'anthropic' | 'dashscope';

export interface LLMOptions {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

/** OpenAI 兼容模型的配置（OpenAI / DashScope 等都走这个） */
interface OpenAICompatConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel: string;
}

@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name);

  constructor(private readonly configService: ConfigService) {}

  createModel(options: LLMOptions = {}): BaseChatModel {
    const provider = options.provider || this.configService.get<string>('llm.defaultProvider') || 'openai';
    const model = options.model || this.configService.get<string>('llm.defaultModel') || 'gpt-4o';
    const temperature = options.temperature ?? 0.7;
    const streaming = options.streaming ?? true;

    this.logger.debug(`Creating LLM: ${provider}/${model}`);

    if (provider === 'anthropic') {
      return new ChatAnthropic({
        modelName: model || 'claude-sonnet-4-20250514',
        temperature,
        streaming,
        maxTokens: options.maxTokens || 4096,
        anthropicApiKey: this.configService.get<string>('llm.anthropic.apiKey'),
      });
    }

    // OpenAI 兼容（openai / dashscope 等）
    const configs: Record<string, OpenAICompatConfig> = {
      openai: {
        apiKey: this.configService.get<string>('llm.openai.apiKey')!,
        baseUrl: this.configService.get<string>('llm.openai.baseUrl'),
        defaultModel: 'gpt-4o',
      },
      dashscope: {
        apiKey: this.configService.get<string>('llm.dashscope.apiKey')!,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        defaultModel: 'qwen-max',
      },
    };

    const conf = configs[provider] || configs.openai;
    return new ChatOpenAI({
      modelName: model || conf.defaultModel,
      temperature,
      streaming,
      ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      openAIApiKey: conf.apiKey,
      ...(conf.baseUrl ? { configuration: { baseURL: conf.baseUrl } } : {}),
    });
  }
}
