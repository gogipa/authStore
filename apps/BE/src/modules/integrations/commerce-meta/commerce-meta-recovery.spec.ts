import { createMetaKit, muteNestLogger } from '../../../../test/support/commerce-meta-kit.js';
import { META_SYNC_INTERRUPTED_MESSAGE } from './commerce-meta.constants.js';

describe('CommerceMetaRecovery(규칙 10: 재시작 때 RUNNING → FAILED)', () => {
  muteNestLogger();
  it('RUNNING 행은 부트스트랩 뒤 FAILED·finished_at·중단 사유, 끝난 행은 그대로. ready가 풀린다', async () => {
    const k = createMetaKit();
    const startedAt = k.clock.now();
    const running = k.prisma.commerceMetaSyncRun.seed({
      target: 'CATEGORY',
      status: 'RUNNING',
      startedAt,
    });
    const done = k.prisma.commerceMetaSyncRun.seed({
      target: 'ADDRESSBOOK',
      status: 'SUCCEEDED',
      startedAt,
      finishedAt: startedAt,
      itemCount: 4,
    });
    k.clock.advance(5_000);

    await k.recovery.onApplicationBootstrap();
    await expect(k.recovery.ready).resolves.toBeUndefined();

    expect(k.prisma.commerceMetaSyncRun.rows.find((r) => r.id === running.id)).toMatchObject({
      status: 'FAILED',
      finishedAt: k.clock.now(),
      errorMessage: META_SYNC_INTERRUPTED_MESSAGE,
    });
    expect(k.prisma.commerceMetaSyncRun.rows.find((r) => r.id === done.id)).toMatchObject({
      status: 'SUCCEEDED',
      itemCount: 4,
    });
    // 한 번 더 해도 닫을 것이 없다
    expect(await k.recovery.recover()).toBe(0);
  });

  it('정리가 실패해도 ready는 풀린다(자동 실행이 멈추지 않게)', async () => {
    const k = createMetaKit();
    k.prisma.commerceMetaSyncRun.updateMany = () => Promise.reject(new Error('db down'));
    await k.recovery.onApplicationBootstrap();
    await expect(k.recovery.ready).resolves.toBeUndefined();
  });
});
