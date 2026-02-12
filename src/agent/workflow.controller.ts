import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { WorkflowService } from './workflow.service';
import { JwtAuthGuard, TenantGuard } from '../auth/guards';
import { TenantId } from '../common/decorators/tenant.decorator';

const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['agent', 'tool', 'condition', 'start', 'end']),
  name: z.string(),
  config: z.record(z.any()),
});

const WorkflowEdgeSchema = z.object({
  source: z.string(),
  target: z.string(),
  condition: z.string().optional(),
});

const CreateWorkflowSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z.array(WorkflowNodeSchema),
  edges: z.array(WorkflowEdgeSchema),
  globalVariables: z.record(z.any()).optional(),
});

const UpdateWorkflowSchema = CreateWorkflowSchema.partial();

@Controller('workflows')
@UseGuards(JwtAuthGuard, TenantGuard)
export class WorkflowController {
  constructor(private readonly workflowService: WorkflowService) {}

  @Post()
  async create(@Body() body: any, @TenantId() tenantId: string) {
    const dto = CreateWorkflowSchema.parse(body);
    return this.workflowService.create({ ...dto, tenantId });
  }

  @Get()
  async list(@TenantId() tenantId: string) {
    return this.workflowService.findAll(tenantId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @TenantId() tenantId: string) {
    return this.workflowService.findById(id, tenantId);
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() body: any,
    @TenantId() tenantId: string,
  ) {
    const dto = UpdateWorkflowSchema.parse(body);
    return this.workflowService.update(id, tenantId, dto);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @TenantId() tenantId: string) {
    await this.workflowService.delete(id, tenantId);
    return { success: true };
  }
}
