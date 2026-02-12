import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { RagService } from './rag.service';
import { JwtAuthGuard, TenantGuard } from '../auth/guards';
import { TenantId } from '../common/decorators/tenant.decorator';

const CreateKBSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(''),
  chunkSize: z.number().optional(),
  chunkOverlap: z.number().optional(),
});

const AddDocsSchema = z.object({
  documents: z.array(
    z.object({
      content: z.string().min(1),
      metadata: z.record(z.any()).optional(),
    }),
  ),
});

const SearchSchema = z.object({
  query: z.string().min(1),
  topK: z.number().optional().default(5),
});

@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RagController {
  constructor(private readonly ragService: RagService) {}

  @Post()
  async create(@Body() body: any, @TenantId() tenantId: string) {
    const dto = CreateKBSchema.parse(body);
    return this.ragService.createKnowledgeBase(
      dto.name,
      dto.description,
      tenantId,
      { chunkSize: dto.chunkSize, chunkOverlap: dto.chunkOverlap },
    );
  }

  @Get()
  async list(@TenantId() tenantId: string) {
    return this.ragService.listKnowledgeBases(tenantId);
  }

  @Post(':id/documents')
  async addDocuments(
    @Param('id') id: string,
    @Body() body: any,
    @TenantId() tenantId: string,
  ) {
    const dto = AddDocsSchema.parse(body);
    return this.ragService.addDocuments(id, tenantId, dto.documents);
  }

  @Post(':id/search')
  async search(
    @Param('id') id: string,
    @Body() body: any,
    @TenantId() tenantId: string,
  ) {
    const dto = SearchSchema.parse(body);
    return this.ragService.search(id, tenantId, dto.query, dto.topK);
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @TenantId() tenantId: string) {
    await this.ragService.deleteKnowledgeBase(id, tenantId);
    return { success: true };
  }
}
