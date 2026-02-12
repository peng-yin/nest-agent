import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Conversation } from './conversation.entity';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

@Entity('messages')
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'conversation_id' })
  conversationId: string;

  @Index()
  @Column({ name: 'tenant_id' })
  tenantId: string;

  @Column({ type: 'varchar', length: 20 })
  role: MessageRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'agent_name', nullable: true })
  agentName: string;

  @ManyToOne(() => Conversation, (conv) => conv.messages)
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
