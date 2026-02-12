import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type WorkflowNodeType = 'agent' | 'tool' | 'condition' | 'start' | 'end';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  name: string;
  config: Record<string, any>;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  condition?: string;
}

/** DAG 工作流定义 */
@Entity('workflows')
export class Workflow {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Index()
  @Column({ name: 'tenant_id' })
  tenantId: string;

  /** DAG 节点定义 */
  @Column({ type: 'json' })
  nodes: WorkflowNode[];

  /** DAG 边定义 */
  @Column({ type: 'json' })
  edges: WorkflowEdge[];

  /** 全局变量 */
  @Column({ name: 'global_variables', type: 'json', nullable: true })
  globalVariables: Record<string, any>;

  @Column({ default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
