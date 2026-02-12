import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/** 知识库实体 */
@Entity('knowledge_bases')
export class KnowledgeBase {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Index()
  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** Milvus collection 名称 */
  @Column({ name: 'collection_name', unique: true })
  collectionName: string;

  /** 使用的 embedding 模型 */
  @Column({ name: 'embedding_model', default: 'BAAI/bge-m3' })
  embeddingModel: string;

  @Column({ name: 'chunk_size', default: 1000 })
  chunkSize: number;

  @Column({ name: 'chunk_overlap', default: 200 })
  chunkOverlap: number;

  @Column({ name: 'document_count', default: 0 })
  documentCount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
