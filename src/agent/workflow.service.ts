import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Workflow } from '../entities/workflow.entity';

@Injectable()
export class WorkflowService {
  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,
  ) {}

  async create(data: Partial<Workflow>) {
    return this.workflowRepo.save(this.workflowRepo.create(data));
  }

  async findById(id: string, tenantId: string) {
    return this.workflowRepo.findOne({ where: { id, tenantId } });
  }

  async findAll(tenantId: string) {
    return this.workflowRepo.find({ where: { tenantId } });
  }

  async update(id: string, tenantId: string, data: Partial<Workflow>) {
    await this.workflowRepo.update({ id, tenantId }, data);
    return this.findById(id, tenantId);
  }

  async delete(id: string, tenantId: string) {
    return this.workflowRepo.delete({ id, tenantId });
  }
}
