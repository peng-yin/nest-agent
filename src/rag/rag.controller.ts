import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import {
  FileInterceptor,
  FilesInterceptor,
} from '@nestjs/platform-express';
import { z } from 'zod';
import { RagService } from './rag.service';
import { DocumentLoaderService } from './document-loader.service';
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

const LoadUrlSchema = z.object({
  url: z.string().url(),
});

@Controller('knowledge-bases')
@UseGuards(JwtAuthGuard, TenantGuard)
export class RagController {
  constructor(
    private readonly ragService: RagService,
    private readonly documentLoaderService: DocumentLoaderService,
  ) {}

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

  /**
   * 上传文件（PDF/TXT/MD/CSV/HTML/JSON）到知识库
   * 支持单文件上传
   */
  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @TenantId() tenantId: string,
  ) {
    if (!file) {
      throw new Error('未选择文件');
    }

    const docs = await this.documentLoaderService.loadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    const result = await this.ragService.addDocuments(
      id,
      tenantId,
      docs.map((d) => ({ content: d.content, metadata: d.metadata })),
    );

    return {
      ...result,
      fileName: file.originalname,
      documentsLoaded: docs.length,
    };
  }

  /**
   * 批量上传文件到知识库
   */
  @Post(':id/upload-batch')
  @UseInterceptors(FilesInterceptor('files', 10))
  async uploadFiles(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @TenantId() tenantId: string,
  ) {
    if (!files || files.length === 0) {
      throw new Error('未选择文件');
    }

    const results: Array<{
      fileName: string;
      chunksCreated: number;
      documentsLoaded: number;
      error?: string;
    }> = [];

    for (const file of files) {
      try {
        const docs = await this.documentLoaderService.loadFile(
          file.buffer,
          file.originalname,
          file.mimetype,
        );

        const result = await this.ragService.addDocuments(
          id,
          tenantId,
          docs.map((d) => ({ content: d.content, metadata: d.metadata })),
        );

        results.push({
          fileName: file.originalname,
          chunksCreated: result.chunksCreated,
          documentsLoaded: docs.length,
        });
      } catch (err: any) {
        results.push({
          fileName: file.originalname,
          chunksCreated: 0,
          documentsLoaded: 0,
          error: err.message,
        });
      }
    }

    return { results };
  }

  /**
   * 从 URL 加载网页内容到知识库
   */
  @Post(':id/load-url')
  async loadUrl(
    @Param('id') id: string,
    @Body() body: any,
    @TenantId() tenantId: string,
  ) {
    const dto = LoadUrlSchema.parse(body);
    const docs = await this.documentLoaderService.loadUrl(dto.url);

    const result = await this.ragService.addDocuments(
      id,
      tenantId,
      docs.map((d) => ({ content: d.content, metadata: d.metadata })),
    );

    return {
      ...result,
      url: dto.url,
      documentsLoaded: docs.length,
    };
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
