import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MilvusClient, DataType } from '@zilliz/milvus2-sdk-node';

const EMBEDDING_DIM = 1024; // BAAI/bge-m3 default

@Injectable()
export class MilvusService implements OnModuleInit {
  private readonly logger = new Logger(MilvusService.name);
  private client: MilvusClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get('milvus.host');
    const port = this.configService.get('milvus.port');

    try {
      this.client = new MilvusClient({
        address: `${host}:${port}`,
        timeout: 5000,
      });
      const healthCheck = this.client.checkHealth();
      const timeout = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Milvus health check timeout')), 5000),
      );
      const health = await Promise.race([healthCheck, timeout]);
      this.logger.log(`Milvus connected: healthy=${(health as any)?.isHealthy}`);
    } catch (err: any) {
      this.logger.warn(`Milvus not available: ${err.message}. RAG features disabled until Milvus is up.`);
      this.client = null;
    }
  }

  /** 获取 client，不可用时抛出明确错误 */
  private requireClient(): MilvusClient {
    if (!this.client) {
      throw new Error('Milvus is not available. Please check Milvus connection.');
    }
    return this.client;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async createCollection(collectionName: string, dim = EMBEDDING_DIM) {
    const client = this.requireClient();
    const exists = await client.hasCollection({ collection_name: collectionName });
    if (exists.value) {
      this.logger.log(`Collection ${collectionName} already exists`);
      return;
    }

    await client.createCollection({
      collection_name: collectionName,
      fields: [
        { name: 'id', data_type: DataType.VarChar, is_primary_key: true, max_length: 64 },
        { name: 'text', data_type: DataType.VarChar, max_length: 65535 },
        { name: 'vector', data_type: DataType.FloatVector, dim },
        { name: 'metadata', data_type: DataType.JSON },
        { name: 'knowledge_base_id', data_type: DataType.VarChar, max_length: 64 },
      ],
    });

    await client.createIndex({
      collection_name: collectionName,
      field_name: 'vector',
      index_type: 'IVF_FLAT',
      metric_type: 'COSINE',
      params: { nlist: 1024 },
    });

    await client.loadCollection({ collection_name: collectionName });
    this.logger.log(`Collection ${collectionName} created and loaded`);
  }

  async insert(
    collectionName: string,
    data: Array<{ id: string; text: string; vector: number[]; metadata: any; knowledge_base_id: string }>,
  ) {
    return this.requireClient().insert({ collection_name: collectionName, data });
  }

  async search(
    collectionName: string,
    vector: number[],
    topK = 5,
    filter?: string,
  ) {
    const result = await this.requireClient().search({
      collection_name: collectionName,
      data: [vector],
      limit: topK,
      output_fields: ['text', 'metadata', 'knowledge_base_id'],
      filter,
    });
    return result.results;
  }

  async dropCollection(collectionName: string) {
    return this.requireClient().dropCollection({ collection_name: collectionName });
  }
}
