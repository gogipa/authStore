import { toKstDateValue } from '../src/common/time/kst.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';

/**
 * @prisma/adapter-pg는 timestamptz를 오프셋 없는 UTC 문자열로 보낸다. DB 세션 시간대가 UTC가 아니면
 * 시각이 어긋나고 KST 0~9시(UTC 날짜 ≠ KST 날짜)에 ck_call_log_kst가 깨진다(PrismaService가 TimeZone=UTC로 맞춘다).
 */
describe('Prisma 시각 저장(세션 TimeZone=UTC)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['call_log']);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it.each([
    '2026-09-28T14:59:59.000Z',
    '2026-09-28T15:00:00.000Z',
    '2026-09-28T20:30:00.123Z',
    '2026-09-29T00:00:00.000Z',
  ])('%s: KST 날짜 CHECK를 통과하고 같은 시각으로 저장·조회된다', async (iso) => {
    const calledAt = new Date(iso);
    const row = await t.prisma.callLog.create({
      data: { calledAt, kstDate: toKstDateValue(calledAt), target: 'RAKUTEN_PAGE' },
    });
    expect(row.calledAt.toISOString()).toBe(iso);
    const [db] = await t.prisma.$queryRawUnsafe<{ epoch_ms: number }[]>(
      'SELECT (extract(epoch FROM called_at) * 1000)::float8 AS epoch_ms FROM call_log WHERE id = $1',
      row.id,
    );
    expect(Math.round(db!.epoch_ms)).toBe(calledAt.getTime());
  });

  it('DB now() 기본값도 제 시각으로 읽힌다', async () => {
    const [row] = await t.prisma.$queryRawUnsafe<{ now: Date }[]>('SELECT now() AS now');
    expect(Math.abs(row!.now.getTime() - Date.now())).toBeLessThan(60_000);
  });
});
