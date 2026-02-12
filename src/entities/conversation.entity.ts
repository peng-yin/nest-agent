import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ nullable: true })
  title: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Index()
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ name: 'workflow_id', nullable: true })
  workflowId: string;

  /** 对话摘要（LLM 自动压缩历史消息生成） */
  @Column({ type: 'text', nullable: true })
  summary: string;

  /** 摘要覆盖到的最后一条消息 ID */
  @Column({ name: 'summary_until_message_id', nullable: true })
  summaryUntilMessageId: string;

  @OneToMany(() => Message, (msg) => msg.conversation)
  messages: Message[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
