/**
 * 흐름 테스트(P5-01) 가짜 연동 BE — 자식 프로세스. 운영 코드를 바꾸지 않고 `Test.createTestingModule({ imports: [AppModule] })`에
 * `overrideProvider`로 가짜(HTTP_FETCH·CLOCK·SECRET_STORE·AI 어댑터·이미지 생성·자동 작업 끔)를 끼워 127.0.0.1:3100에 띄운다.
 * `flow-server.mjs`(감독 프로세스)가 `node --import ./test/flow/register-ts.mjs test/flow/flow-app.ts`로 띄우고 IPC로 부린다.
 *
 * 환경변수(감독이 넣는다)
 * - DATABASE_URL: autostore_test만(이름에 test가 없으면 시작하지 않는다 — 06-4 TEST_DATABASE_URL 규칙)
 * - FLOW_TRUNCATE=1: 앱을 켜기 전에 테스트 DB의 모든 표를 TRUNCATE … RESTART IDENTITY CASCADE하고 설정 파일·시드를 새로 놓는다
 *   (0이면 DB를 그대로 두고 다시 켠다 — 재시작 시험)
 * - FLOW_FAKES: 시작할 때의 가짜 동작(JSON, `FlowFakeModes`)
 * - FLOW_RESTART_CHECK=off: 재시작 뒤 결과확인필요 자동 조회(P4-03 F-BS-18)를 끈다(기본 켬 — 운영과 같다)
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp, NEST_APP_OPTIONS } from '../../src/app.setup.js';
import { SECRET_STORE } from '../../src/common/secrets/secret-store.port.js';
import {
  COMMERCE_META_SCHEDULE,
  defaultCommerceMetaSchedule,
} from '../../src/modules/integrations/commerce-meta/commerce-meta-sync.scheduler.js';
import { AI_ENGINE_ADAPTERS } from '../../src/modules/integrations/ai-engine/ai-engine.port.js';
import { CLOCK } from '../../src/modules/integrations/http/clock.token.js';
import { HTTP_FETCH } from '../../src/modules/integrations/http/http-fetch.token.js';
import { IMAGE_GEN_PROVIDER } from '../../src/modules/integrations/image-gen/image-gen.port.js';
import {
  defaultFxCollectSchedule,
  FX_COLLECT_SCHEDULE,
} from '../../src/modules/pricing/fx/fx-collector.service.js';
import { REGISTRATION_RESTART_CHECK } from '../../src/modules/registration/result-check/result-check.service.js';
import { AI_ENGINE_RELOAD_CHECK } from '../../src/modules/system/ai-cli-checks/ai-engine-reload.check.js';
import { AI_ENGINE_STARTUP_CHECK } from '../../src/modules/system/ai-cli-checks/ai-engine-startup.check.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { InMemorySecretStore } from '../support/in-memory-secret-store.js';
import { FlowFakes, type FlowFakeModes } from './flow-fakes.js';
import {
  assertTestDatabase,
  FLOW_SECRETS,
  flowSettingsText,
  seedStart,
  truncateAll,
} from './flow-seed.js';

export const FLOW_BE_PORT = 3100;

interface ControlMessage {
  id: number;
  type: 'state' | 'fakes';
  modes?: FlowFakeModes;
}

async function main(): Promise<void> {
  assertTestDatabase();
  const truncateFirst = process.env.FLOW_TRUNCATE === '1';
  const modes = JSON.parse(process.env.FLOW_FAKES ?? '{}') as FlowFakeModes;
  const fakes = new FlowFakes(modes, (v) => process.send?.({ type: 'violation', violation: v }));
  const secrets = new InMemorySecretStore({ initial: { ...FLOW_SECRETS } });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(HTTP_FETCH)
    .useValue(fakes.fetch)
    .overrideProvider(CLOCK)
    .useValue(fakes.clock)
    .overrideProvider(SECRET_STORE)
    .useValue(secrets)
    .overrideProvider(AI_ENGINE_ADAPTERS)
    .useValue(fakes.ai.adapters)
    .overrideProvider(IMAGE_GEN_PROVIDER)
    .useValue(fakes.imageGen)
    .overrideProvider(COMMERCE_META_SCHEDULE)
    .useValue(defaultCommerceMetaSchedule(false))
    .overrideProvider(FX_COLLECT_SCHEDULE)
    .useValue(defaultFxCollectSchedule(false))
    .overrideProvider(AI_ENGINE_STARTUP_CHECK)
    .useValue({ enabled: false })
    .overrideProvider(AI_ENGINE_RELOAD_CHECK)
    .useValue({ enabled: false })
    .overrideProvider(REGISTRATION_RESTART_CHECK)
    .useValue({ enabled: process.env.FLOW_RESTART_CHECK !== 'off' })
    .compile();
  const prisma = moduleRef.get(PrismaService);
  if (truncateFirst) {
    await truncateAll(prisma);
    const dataDir = process.env.APP_DATA_DIR!;
    mkdirSync(join(dataDir, 'settings'), { recursive: true });
    writeFileSync(join(dataDir, 'settings', 'settings.json'), flowSettingsText());
    await seedStart(prisma);
  }
  const app = moduleRef.createNestApplication<NestExpressApplication>(NEST_APP_OPTIONS);
  await configureApp(app);
  await app.listen(FLOW_BE_PORT, '127.0.0.1');

  process.on('message', (raw: ControlMessage) => {
    if (raw.type === 'state') {
      process.send?.({ type: 'reply', id: raw.id, body: fakes.state() });
    } else if (raw.type === 'fakes') {
      fakes.apply(raw.modes ?? {});
      process.send?.({ type: 'reply', id: raw.id, body: fakes.state() });
    }
  });
  process.send?.({ type: 'ready', port: FLOW_BE_PORT });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `flow-app 시작 실패: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exit(1);
});
