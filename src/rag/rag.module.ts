import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeBase } from '../entities/knowledge-base.entity';
import { RagService } from './rag.service';
import { MilvusService } from './milvus.service';
import { RagController } from './rag.controller';

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase])],
  controllers: [RagController],
  providers: [RagService, MilvusService],
  exports: [RagService, MilvusService],
})
export class RagModule {}
