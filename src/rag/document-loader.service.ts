import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import * as cheerio from 'cheerio';

export interface LoadedDocument {
  content: string;
  metadata: Record<string, any>;
}

@Injectable()
export class DocumentLoaderService {
  private readonly logger = new Logger(DocumentLoaderService.name);

  /**
   * 根据文件类型加载文档，提取纯文本
   */
  async loadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
  ): Promise<LoadedDocument[]> {
    const ext = this.getExtension(originalName);
    this.logger.log(
      `Loading file: ${originalName} (${mimeType}, ${buffer.length} bytes)`,
    );

    switch (ext) {
      case '.pdf':
        return this.loadPdf(buffer, originalName);
      case '.txt':
      case '.md':
      case '.csv':
        return this.loadText(buffer, originalName, ext);
      case '.html':
      case '.htm':
        return this.loadHtml(buffer, originalName);
      case '.json':
        return this.loadJson(buffer, originalName);
      default:
        throw new BadRequestException(
          `不支持的文件类型: ${ext}，支持 PDF、TXT、MD、CSV、HTML、JSON`,
        );
    }
  }

  /**
   * 从 URL 加载网页内容
   */
  async loadUrl(url: string): Promise<LoadedDocument[]> {
    this.logger.log(`Loading URL: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; KnowledgeBaseBot/1.0; +https://example.com)',
          Accept: 'text/html,application/xhtml+xml,text/plain,*/*',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        throw new BadRequestException(
          `无法获取网页内容: HTTP ${response.status}`,
        );
      }

      const contentType = response.headers.get('content-type') || '';
      const body = await response.text();

      if (contentType.includes('text/html') || contentType.includes('xhtml')) {
        return this.parseHtml(body, url);
      }

      // 纯文本内容
      return [
        {
          content: body.trim(),
          metadata: { source: url, type: 'url', contentType },
        },
      ];
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`加载网页失败: ${err.message}`);
    }
  }

  // ========== 私有方法 ==========

  private async loadPdf(
    buffer: Buffer,
    filename: string,
  ): Promise<LoadedDocument[]> {
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      const textResult = await parser.getText();

      if (!textResult.text || textResult.text.trim().length === 0) {
        throw new BadRequestException('PDF 文件中未提取到文本内容');
      }

      this.logger.log(
        `PDF parsed: ${textResult.total} pages, ${textResult.text.length} chars`,
      );

      const info = await parser.getInfo().catch(() => null);
      await parser.destroy();

      return [
        {
          content: textResult.text,
          metadata: {
            source: filename,
            type: 'pdf',
            pages: textResult.total,
            ...(info?.info ? { info: info.info } : {}),
          },
        },
      ];
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`PDF 解析失败: ${err.message}`);
    }
  }

  private loadText(
    buffer: Buffer,
    filename: string,
    ext: string,
  ): LoadedDocument[] {
    const content = buffer.toString('utf-8').trim();
    if (!content) {
      throw new BadRequestException('文件内容为空');
    }

    return [
      {
        content,
        metadata: {
          source: filename,
          type: ext.replace('.', ''),
        },
      },
    ];
  }

  private loadHtml(buffer: Buffer, filename: string): LoadedDocument[] {
    const html = buffer.toString('utf-8');
    return this.parseHtml(html, filename);
  }

  private parseHtml(html: string, source: string): LoadedDocument[] {
    const $ = cheerio.load(html);

    // 移除不需要的标签
    $('script, style, nav, footer, header, aside, iframe, noscript').remove();

    // 提取标题
    const title = $('title').text().trim() || $('h1').first().text().trim();

    // 提取主要内容（优先 article/main，否则 body）
    let mainContent = '';
    const mainEl = $('article, main, [role="main"]').first();
    if (mainEl.length) {
      mainContent = mainEl.text();
    } else {
      mainContent = $('body').text();
    }

    // 清理多余空白
    const content = mainContent.replace(/\s+/g, ' ').trim();

    if (!content) {
      throw new BadRequestException('网页中未提取到有效文本内容');
    }

    return [
      {
        content,
        metadata: { source, type: 'html', title },
      },
    ];
  }

  private loadJson(buffer: Buffer, filename: string): LoadedDocument[] {
    try {
      const text = buffer.toString('utf-8');
      const json = JSON.parse(text);

      let docs: LoadedDocument[] = [];

      if (Array.isArray(json)) {
        docs = json.map((item: any) => ({
          content: typeof item === 'string' ? item : item.content,
          metadata: {
            source: filename,
            type: 'json',
            ...(item.metadata || {}),
          },
        }));
      } else if (json.documents && Array.isArray(json.documents)) {
        docs = json.documents.map((item: any) => ({
          content: item.content,
          metadata: {
            source: filename,
            type: 'json',
            ...(item.metadata || {}),
          },
        }));
      } else if (json.content) {
        docs = [
          {
            content: json.content,
            metadata: {
              source: filename,
              type: 'json',
              ...(json.metadata || {}),
            },
          },
        ];
      } else {
        throw new Error('不支持的 JSON 格式');
      }

      if (docs.length === 0 || docs.some((d) => !d.content)) {
        throw new Error('JSON 中没有有效文档内容');
      }

      return docs;
    } catch (err: any) {
      throw new BadRequestException(`JSON 解析失败: ${err.message}`);
    }
  }

  private getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
  }
}
