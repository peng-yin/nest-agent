import { Injectable, Logger } from '@nestjs/common';
import { StructuredToolInterface } from '@langchain/core/tools';
import { webSearchTool } from './web-search.tool';

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private tools = new Map<string, StructuredToolInterface>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults() {
    this.register(webSearchTool);
    this.logger.log(`Registered ${this.tools.size} default tools`);
  }

  register(tool: StructuredToolInterface) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): StructuredToolInterface | undefined {
    return this.tools.get(name);
  }

  getAll(): StructuredToolInterface[] {
    return Array.from(this.tools.values());
  }

  getByNames(names: string[]): StructuredToolInterface[] {
    return names.map((n) => this.tools.get(n)).filter(Boolean) as StructuredToolInterface[];
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
