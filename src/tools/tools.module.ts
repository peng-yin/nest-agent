import { Module, Global } from '@nestjs/common';
import { ToolRegistry } from './tool-registry';

@Global()
@Module({
  providers: [ToolRegistry],
  exports: [ToolRegistry],
})
export class ToolsModule {}
