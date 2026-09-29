import { UserActionLogService } from '../src/common/audit/user-action-log.service.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';

describe('감사 기록 user_action_log (e2e)', () => {
  let t: TestApp;
  let audit: UserActionLogService;

  beforeAll(async () => {
    t = await createTestApp();
    audit = t.app.get(UserActionLogService);
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['user_action_log']);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('KST 0~9시(UTC 날짜 ≠ KST 날짜)에도 ck_ual_kst를 통과한다', async () => {
    const row = await audit.record({
      eventType: 'SETTING_CHANGED',
      occurredAt: new Date('2026-09-28T16:30:00Z'),
      detail: { changedKeys: ['registrationSwitch.apiBlocked'] },
    });
    expect(row.kstDate.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(row.occurredAt.toISOString()).toBe('2026-09-28T16:30:00.000Z');
  });

  it('부르는 쪽 트랜잭션 안에서 쓰고, 트랜잭션이 되돌려지면 기록도 남지 않는다', async () => {
    await t.prisma.$transaction(async (tx) => {
      await audit.record({ eventType: 'OWNER_CONFIRMED', detail: { item: 'adultProduct' } }, tx);
    });
    expect(await t.prisma.userActionLog.count()).toBe(1);

    await expect(
      t.prisma.$transaction(async (tx) => {
        await audit.record({ eventType: 'SETTING_CHANGED', detail: { changedKeys: ['x'] } }, tx);
        throw new Error('게이트 통과 실패(되돌림)');
      }),
    ).rejects.toThrow('되돌림');
    expect(await t.prisma.userActionLog.count()).toBe(1);
  });

  it('추가만 한다(UPDATE는 트리거가 막는다)', async () => {
    const row = await audit.record({ eventType: 'OWNER_CONFIRMED' });
    await expect(
      t.prisma.userActionLog.update({ where: { id: row.id }, data: { eventType: 'OWNER_EDITED' } }),
    ).rejects.toThrow();
  });
});
