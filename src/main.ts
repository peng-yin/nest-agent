import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get('port') || 3000;

  // 全局异常过滤器
  app.useGlobalFilters(new GlobalExceptionFilter());

  // CORS — 生产环境通过 CORS_ORIGIN 环境变量限制
  const corsOrigin = configService.get('cors.origin') || '*';
  app.enableCors({
    origin: corsOrigin,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
  });

  // 全局前缀
  app.setGlobalPrefix('api/v1');

  await app.listen(port);
  logger.log(`Application running on http://localhost:${port}`);
  logger.log(`API base: http://localhost:${port}/api/v1`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error(`Failed to start application: ${err.message}`, err.stack);
  process.exit(1);
});
