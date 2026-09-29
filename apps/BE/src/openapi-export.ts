/**
 * 구현 명세 내보내기: dist/openapi.impl.json (HTTP 경로로는 노출하지 않는다).
 * 05-2(설계 원본)와의 대조는 13 테스트 단계에서 한다.
 * 실행: pnpm --filter @autostore/be openapi:export
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { API_PREFIX } from './app.setup.js';
import { BE_ROOT } from './common/config/paths.js';

async function exportOpenApi(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  app.setGlobalPrefix(API_PREFIX);
  const config = new DocumentBuilder()
    .setTitle('autoStore API (구현)')
    .setDescription(
      'apps/BE 코드에서 뽑은 구현 명세. 설계 원본은 docs/dev/05_API/05-2_openapi.yaml',
    )
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const outDir = join(BE_ROOT, 'dist');
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, 'openapi.impl.json');
  writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  process.stdout.write(`openapi: ${Object.keys(document.paths).length} paths → ${outFile}\n`);
}

void exportOpenApi();
