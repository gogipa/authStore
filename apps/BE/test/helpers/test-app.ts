import type { AddressInfo } from 'node:net';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { SSE_HEARTBEAT_INTERVAL_MS } from '../../src/common/events/events.controller.js';
import { CLOCK } from '../../src/modules/integrations/http/clock.token.js';
import { HTTP_FETCH } from '../../src/modules/integrations/http/http-fetch.token.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { FakeClock, FakeFetch } from './fakes.js';

/** 테스트 시작 시각: 2026-09-28 09:00 KST(한국 날짜 경계에서 멀다) */
export const TEST_START_MS = Date.parse('2026-09-28T00:00:00Z');

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  clock: FakeClock;
  fetch: FakeFetch;
  port: number;
}

export interface CreateTestAppOptions {
  /**
   * 앱을 켜기(init) 전에 부른다. 시작 때 도는 일(설정 파일 검사·스냅샷 저장, P1-03)보다 먼저
   * DB를 비우거나 파일을 놓을 때 쓴다. Prisma는 첫 쿼리 때 접속하므로 여기서 써도 된다.
   */
  beforeInit?: (prisma: PrismaService) => Promise<void>;
  /** AppModule 옆에 더 붙일 테스트 모듈(예: 가짜 실행기 FakeStepRunnersModule, P1-05) */
  imports?: ModuleMetadata['imports'];
}

/**
 * AppModule 전체를 띄우되, 밖을 부르는 것(HTTP_FETCH)과 시계(CLOCK)는 가짜로 바꾼다.
 * SSE 연결 유지 주석(heartbeat)은 끈다.
 */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const clock = new FakeClock(TEST_START_MS);
  const fetch = new FakeFetch(clock);
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  })
    .overrideProvider(HTTP_FETCH)
    .useValue(fetch.fn)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(SSE_HEARTBEAT_INTERVAL_MS)
    .useValue(0)
    .compile();
  if (options.beforeInit) await options.beforeInit(moduleRef.get(PrismaService));
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  await configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, prisma: app.get(PrismaService), clock, fetch, port };
}

/** 삭제 금지·추가만 트리거가 있어 deleteMany 대신 TRUNCATE */
export async function truncate(prisma: PrismaService, tables: string[]): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
