/**
 * 메타 동기화 단위 테스트 묶음(P1-08): 커머스 인증 묶음(가짜 시계·메모리 키체인·가짜 커머스 서버·SSE 기록기) 위에
 * 가짜 메타 서버와 메모리 Prisma(FakeMetaPrisma)를 얹고, 실제 동기화·캐시·목록·재시작 정리 서비스를 생성자로 만든다.
 */
import { Logger } from '@nestjs/common';
import type { ProgressEventsService } from '../../src/common/events/progress-events.service.js';
import type { SecretKey } from '../../src/common/secrets/secret-keys.js';
import { CommerceMetaCacheService } from '../../src/modules/integrations/commerce-meta/commerce-meta-cache.service.js';
import { CommerceMetaQueryService } from '../../src/modules/integrations/commerce-meta/commerce-meta-query.service.js';
import { CommerceMetaRecovery } from '../../src/modules/integrations/commerce-meta/commerce-meta-recovery.js';
import { CommerceMetaSyncService } from '../../src/modules/integrations/commerce-meta/commerce-meta-sync.service.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';
import { FakeMetaPrisma } from '../helpers/fake-prisma.js';
import { createCommerceKit } from './commerce-test-kit.js';
import { FakeCommerceMetaServer } from './fake-commerce-meta.js';

export function createMetaKit(
  options: { secrets?: Partial<Record<SecretKey, string>>; startMs?: number } = {},
) {
  const kit = createCommerceKit(options);
  const server = new FakeCommerceMetaServer().install(kit.transport);
  const prisma = new FakeMetaPrisma();
  const db = prisma as unknown as PrismaService;
  const cache = new CommerceMetaCacheService(db);
  const sync = new CommerceMetaSyncService(
    db,
    kit.store,
    kit.events as unknown as ProgressEventsService,
    kit.clock,
    kit.client,
    cache,
  );
  const query = new CommerceMetaQueryService(db, cache);
  const recovery = new CommerceMetaRecovery(db, kit.clock);
  /** 동기화를 시작하고 끝날 때까지 기다린다 */
  const syncAll = async (...args: Parameters<CommerceMetaSyncService['start']>) => {
    const runs = await sync.start(...args);
    await sync.whenIdle();
    return runs;
  };
  return { ...kit, server, prisma, db, cache, sync, query, recovery, syncAll };
}

export type MetaKit = ReturnType<typeof createMetaKit>;

/**
 * 실패를 일부러 만드는 테스트에서 Nest 로그(warn·error)를 숨긴다(ESM 모드라 jest.spyOn 대신 직접 바꾼다).
 * describe 안에서 부른다.
 */
export function muteNestLogger(): void {
  const original = { warn: Logger.prototype.warn, error: Logger.prototype.error };
  beforeAll(() => {
    Logger.prototype.warn = () => undefined;
    Logger.prototype.error = () => undefined;
  });
  afterAll(() => {
    Logger.prototype.warn = original.warn;
    Logger.prototype.error = original.error;
  });
}
