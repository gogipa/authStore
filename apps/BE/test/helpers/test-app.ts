import type { AddressInfo } from 'node:net';
import type { ModuleMetadata } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { SSE_HEARTBEAT_INTERVAL_MS } from '../../src/common/events/events.controller.js';
import {
  COMMERCE_META_SCHEDULE,
  defaultCommerceMetaSchedule,
} from '../../src/modules/integrations/commerce-meta/commerce-meta-sync.scheduler.js';
import { AI_ENGINE_ADAPTERS } from '../../src/modules/integrations/ai-engine/ai-engine.port.js';
import { CLOCK } from '../../src/modules/integrations/http/clock.token.js';
import { AI_ENGINE_RELOAD_CHECK } from '../../src/modules/system/ai-cli-checks/ai-engine-reload.check.js';
import { AI_ENGINE_STARTUP_CHECK } from '../../src/modules/system/ai-cli-checks/ai-engine-startup.check.js';
import { HTTP_FETCH } from '../../src/modules/integrations/http/http-fetch.token.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createFakeAiEngines, type FakeAiEngines } from '../support/fake-ai-engines.js';
import { FakeClock, FakeFetch } from './fakes.js';

/** 테스트 시작 시각: 2026-09-28 09:00 KST(한국 날짜 경계에서 멀다) */
export const TEST_START_MS = Date.parse('2026-09-28T00:00:00Z');

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  clock: FakeClock;
  fetch: FakeFetch;
  port: number;
  /** 가짜 AI 엔진 어댑터 3개(AI_ENGINE_ADAPTERS, P1-10) */
  ai: FakeAiEngines;
}

export interface CreateTestAppOptions {
  /**
   * 앱을 켜기(init) 전에 부른다. 시작 때 도는 일(설정 파일 검사·스냅샷 저장, P1-03)보다 먼저
   * DB를 비우거나 파일을 놓을 때 쓴다. Prisma는 첫 쿼리 때 접속하므로 여기서 써도 된다.
   */
  beforeInit?: (prisma: PrismaService, moduleRef: TestingModule) => Promise<void>;
  /** AppModule 옆에 더 붙일 테스트 모듈(예: 가짜 실행기 FakeStepRunnersModule, P1-05) */
  imports?: ModuleMetadata['imports'];
  /**
   * 더 바꿔 끼울 제공자(예: SECRET_STORE → 메모리 저장소, LOG_DESTINATION → 메모리 스트림, P1-07).
   * 기본 가짜(HTTP_FETCH·CLOCK·SSE 주기)보다 뒤에 적용한다.
   */
  overrides?: readonly { provide: unknown; useValue: unknown }[];
  /** 가짜 AI 엔진(주지 않으면 새로 만든다 — 기본: CLAUDE 설치·로그인, AGY 설치, CODEX 미설치) */
  ai?: FakeAiEngines;
  /** 앱 시작 AI 엔진 점검을 켠다(기본 꺼짐, P1-10 규칙 13). 켜도 가짜 어댑터만 부른다 */
  aiStartupCheck?: boolean;
  /** 설정 다시 읽기 뒤 선택 엔진 점검을 켠다(기본 꺼짐, P1-11 Proposed `AiEngineReloadCheck`). 켜도 가짜 어댑터만 부른다 */
  aiReloadCheck?: boolean;
}

/**
 * AppModule 전체를 띄우되, 밖을 부르는 것(HTTP_FETCH)과 시계(CLOCK)는 가짜로 바꾼다.
 * SSE 연결 유지 주석(heartbeat)과 메타데이터 자동 동기화(P1-08, 켜 두면 테스트 중에 몰래 가짜 서버를 부른다)는 끈다.
 * AI 엔진 어댑터는 늘 가짜(AI_ENGINE_ADAPTERS)이고 앱 시작 AI 점검·설정 다시 읽기 뒤 점검은 기본으로 끈다
 * (P1-10·P1-11 — 진짜 CLI·구독 쿼터를 쓰지 않게).
 */
export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  const clock = new FakeClock(TEST_START_MS);
  const fetch = new FakeFetch(clock);
  const ai = options.ai ?? createFakeAiEngines();
  let builder = Test.createTestingModule({
    imports: [AppModule, ...(options.imports ?? [])],
  })
    .overrideProvider(HTTP_FETCH)
    .useValue(fetch.fn)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .overrideProvider(SSE_HEARTBEAT_INTERVAL_MS)
    .useValue(0)
    .overrideProvider(COMMERCE_META_SCHEDULE)
    .useValue(defaultCommerceMetaSchedule(false))
    .overrideProvider(AI_ENGINE_ADAPTERS)
    .useValue(ai.adapters)
    .overrideProvider(AI_ENGINE_STARTUP_CHECK)
    .useValue({ enabled: options.aiStartupCheck ?? false })
    .overrideProvider(AI_ENGINE_RELOAD_CHECK)
    .useValue({ enabled: options.aiReloadCheck ?? false });
  for (const o of options.overrides ?? []) {
    builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  }
  const moduleRef = await builder.compile();
  if (options.beforeInit) await options.beforeInit(moduleRef.get(PrismaService), moduleRef);
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
  await configureApp(app);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return { app, prisma: app.get(PrismaService), clock, fetch, port, ai };
}

/** 삭제 금지·추가만 트리거가 있어 deleteMany 대신 TRUNCATE */
export async function truncate(prisma: PrismaService, tables: string[]): Promise<void> {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`);
}
