import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { KnowledgeBase } from '../entities/knowledge-base.entity';
import { MilvusService } from './milvus.service';
import { OpenAIEmbeddings } from '@langchain/openai';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private embeddings: OpenAIEmbeddings;

  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    private readonly milvusService: MilvusService,
    private readonly configService: ConfigService,
  ) {
    const apiKey = this.configService.get('llm.openai.apiKey');
    const baseUrl = this.configService.get('llm.openai.baseUrl');

    this.embeddings = new OpenAIEmbeddings({
      modelName: 'BAAI/bge-m3',
      openAIApiKey: apiKey,
      ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
    });
  }

  /**
   * 创建知识库
   */
  async createKnowledgeBase(
    name: string,
    description: string,
    tenantId: string,
    options?: { chunkSize?: number; chunkOverlap?: number; embeddingModel?: string },
  ) {
    const collectionName = `kb_${tenantId}_${Date.now()}`.replace(/-/g, '_');

    await this.milvusService.createCollection(collectionName);

    const kb = this.kbRepo.create({
      name,
      description,
      tenantId,
      collectionName,
      chunkSize: options?.chunkSize || 1000,
      chunkOverlap: options?.chunkOverlap || 200,
      embeddingModel: options?.embeddingModel || 'BAAI/bge-m3',
    });

    return this.kbRepo.save(kb);
  }

  /**
   * 向知识库中添加文档
   */
  async addDocuments(
    knowledgeBaseId: string,
    tenantId: string,
    documents: Array<{ content: string; metadata?: Record<string, any> }>,
  ) {
    const kb = await this.kbRepo.findOne({
      where: { id: knowledgeBaseId, tenantId },
    });
    if (!kb) throw new NotFoundException('Knowledge base not found');

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: kb.chunkSize,
      chunkOverlap: kb.chunkOverlap,
    });

    const allChunks: Array<{
      id: string;
      text: string;
      vector: number[];
      metadata: any;
      knowledge_base_id: string;
    }> = [];

    for (const doc of documents) {
      const chunks = await splitter.splitText(doc.content);

      const vectors = await this.embeddings.embedDocuments(chunks);

      for (let i = 0; i < chunks.length; i++) {
        allChunks.push({
          id: uuidv4(),
          text: chunks[i],
          vector: vectors[i],
          metadata: { ...doc.metadata, chunkIndex: i },
          knowledge_base_id: knowledgeBaseId,
        });
      }
    }

    if (allChunks.length > 0) {
      await this.milvusService.insert(kb.collectionName, allChunks);
      await this.kbRepo.update(kb.id, {
        documentCount: kb.documentCount + documents.length,
      });
    }

    this.logger.log(
      `Added ${documents.length} documents (${allChunks.length} chunks) to KB ${kb.name}`,
    );

    return { chunksCreated: allChunks.length };
  }

  /**
   * 检索知识库
   */
  async search(
    knowledgeBaseId: string,
    tenantId: string,
    query: string,
    topK = 5,
  ) {
    const kb = await this.kbRepo.findOne({
      where: { id: knowledgeBaseId, tenantId },
    });
    if (!kb) throw new NotFoundException('Knowledge base not found');

    const queryVector = await this.embeddings.embedQuery(query);

    // 防止 filter 注入：只允许合法的 UUID 字符
    const safeId = knowledgeBaseId.replace(/[^a-zA-Z0-9-]/g, '');
    const results = await this.milvusService.search(
      kb.collectionName,
      queryVector,
      topK,
      `knowledge_base_id == "${safeId}"`,
    );

    return results.map((r: any) => ({
      text: r.text,
      metadata: r.metadata,
      score: r.score,
    }));
  }

  async listKnowledgeBases(tenantId: string) {
    return this.kbRepo.find({ where: { tenantId } });
  }

  async deleteKnowledgeBase(id: string, tenantId: string) {
    const kb = await this.kbRepo.findOne({ where: { id, tenantId } });
    if (!kb) throw new NotFoundException('Knowledge base not found');

    await this.milvusService.dropCollection(kb.collectionName);
    await this.kbRepo.delete(id);
  }
}
