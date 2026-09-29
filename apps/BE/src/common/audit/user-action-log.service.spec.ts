import type { PrismaService } from '../../prisma/prisma.service.js';
import {
  isForbiddenDetailKey,
  USER_ACTION_EVENT_TYPES,
  UserActionLogInputError,
  type UserActionLogInput,
  UserActionLogService,
} from './user-action-log.service.js';

/** create 호출을 모으는 가짜 Prisma(부르는 쪽 트랜잭션도 같은 모양) */
function fakeDb() {
  const calls: Record<string, unknown>[] = [];
  const db = {
    userActionLog: {
      create: ({ data }: { data: Record<string, unknown> }) => {
        calls.push(data);
        return Promise.resolve({ id: calls.length, ...data });
      },
    },
  };
  return { db, calls };
}

describe('UserActionLogService', () => {
  it('CHECK ck_ual_event의 11종', () => {
    expect([...USER_ACTION_EVENT_TYPES]).toEqual([
      'GATE_PASSED',
      'OWNER_CONFIRMED',
      'OWNER_EDITED',
      'CATEGORY_DECISION',
      'SETTING_CHANGED',
      'GATE_ENTERED',
      'SCREEN_ENTERED',
      'SCREEN_LEFT',
      'WINDOW_INACTIVE',
      'WINDOW_ACTIVE',
      'PRODUCT_ACTION',
    ]);
  });

  it('GATE_PASSED에 gate가 없으면 거부하고 DB에 쓰지 않는다', async () => {
    const { db, calls } = fakeDb();
    const service = new UserActionLogService(db as unknown as PrismaService);
    await expect(service.record({ eventType: 'GATE_PASSED', candidateId: 1 })).rejects.toThrow(
      UserActionLogInputError,
    );
    await expect(service.record({ eventType: 'GATE_ENTERED' })).rejects.toThrow(/gate/);
    expect(calls).toHaveLength(0);
  });

  it('11종 밖 event_type은 거부한다', async () => {
    const { db } = fakeDb();
    const service = new UserActionLogService(db as unknown as PrismaService);
    await expect(
      service.record({ eventType: 'LOGIN' } as unknown as UserActionLogInput),
    ).rejects.toThrow(/eventType/);
  });

  it('gate·stepCode는 CHECK 값만', async () => {
    const { db } = fakeDb();
    const service = new UserActionLogService(db as unknown as PrismaService);
    await expect(
      service.record({ eventType: 'GATE_PASSED', gate: 'G9' } as unknown as UserActionLogInput),
    ).rejects.toThrow(/gate는/);
    await expect(
      service.record({
        eventType: 'OWNER_EDITED',
        stepCode: 'KEYWORD',
      } as unknown as UserActionLogInput),
    ).rejects.toThrow(/stepCode/);
  });

  it('kst_date는 occurred_at의 한국 날짜다(0시 경계)', async () => {
    const { db, calls } = fakeDb();
    const service = new UserActionLogService(db as unknown as PrismaService);
    await service.record({
      eventType: 'GATE_PASSED',
      gate: 'G2',
      candidateId: 7,
      occurredAt: new Date('2026-09-27T15:00:00Z'),
    });
    await service.record({
      eventType: 'SETTING_CHANGED',
      occurredAt: new Date('2026-09-27T14:59:59Z'),
      detail: { changedKeys: ['pricing.marginRate'], secretKey: 'COMMERCE_CLIENT_ID' },
    });
    expect((calls[0]!.kstDate as Date).toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(calls[0]).toMatchObject({ gate: 'G2', candidateId: 7, eventType: 'GATE_PASSED' });
    expect((calls[1]!.kstDate as Date).toISOString()).toBe('2026-09-27T00:00:00.000Z');
  });

  it('occurred_at을 생략해도 앱이 정해 kst_date와 같이 쓴다', async () => {
    const { db, calls } = fakeDb();
    const service = new UserActionLogService(db as unknown as PrismaService);
    await service.record({ eventType: 'OWNER_CONFIRMED', candidateId: 3 });
    expect(calls[0]!.occurredAt).toBeInstanceOf(Date);
    expect(calls[0]!.kstDate).toBeInstanceOf(Date);
  });

  it('부르는 쪽의 트랜잭션 클라이언트가 있으면 그쪽에 쓴다', async () => {
    const root = fakeDb();
    const tx = fakeDb();
    const service = new UserActionLogService(root.db as unknown as PrismaService);
    await service.record({ eventType: 'GATE_PASSED', gate: 'G4', candidateId: 1 }, tx.db as never);
    expect(root.calls).toHaveLength(0);
    expect(tx.calls).toHaveLength(1);
  });

  it('detail에 비밀값·경쟁 태그 원문 키를 넣으면 거부한다(키 이름만은 된다)', async () => {
    const { db } = fakeDb();
    const service = new UserActionLogService(db as unknown as PrismaService);
    for (const detail of [
      { clientSecret: 'x' },
      { nested: { accessToken: 'x' } },
      { rows: [{ competitorTags: ['a'] }] },
      { token: 'x' },
      { applicationId: 'x' },
    ]) {
      await expect(service.record({ eventType: 'SETTING_CHANGED', detail })).rejects.toThrow(
        /detail에 넣을 수 없는 키/,
      );
    }
    expect(isForbiddenDetailKey('secretKey')).toBe(false);
    expect(isForbiddenDetailKey('tagCount')).toBe(false);
  });
});
