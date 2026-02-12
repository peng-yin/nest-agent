import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workflow } from '../entities/workflow.entity';
import { AgentService } from './agent.service';
import { SupervisorFactory } from './supervisor.factory';
import { DagEngine } from './dag-engine';
import { WorkflowService } from './workflow.service';
import { WorkflowController } from './workflow.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Workflow])],
  controllers: [WorkflowController],
  providers: [AgentService, SupervisorFactory, DagEngine, WorkflowService],
  exports: [AgentService, WorkflowService],
})
export class AgentModule {}
