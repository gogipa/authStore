import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../src/common/events/progress-events.service.js';
import { ForwarderRateTablesService } from '../src/modules/settings/forwarder-rate-tables/forwarder-rate-tables.service.js';
import { createCandidate } from './fixtures/step-engine/candidate.factory.js';
import { insertStepRun } from './fixtures/step-engine/step-run.factory.js';
import { STEP_ENGINE_TABLES } from './fixtures/step-engine/truncate.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'forwarder');
const file = (name: string) => readFileSync(join(FIXTURES, name));
/** setup-env.cjs가 이 파일에 준 임시 데이터 폴더 */
const DATA_DIR = process.env.APP_DATA_DIR!;

const RATE_TABLE_TABLES = ['forwarder_rate_tier', 'forwarder_rate_table'];

interface TierBody {
  id: number;
  weightMaxKg: number;
  fee: number;
  currency: string;
  volumetricDivisor: number | null;
  volumetricAppliesWhen: string | null;
}
interface TableBody {
  id: number;
  forwarderName: string | null;
  sourceFileName: string;
  sourceFileSha256: string;
  rowCount: number;
  isActive: boolean;
  importedAt: string;
  activatedAt: string | null;
  tiers?: TierBody[];
}
interface ImportBody {
  rateTable: TableBody & { tiers: TierBody[] };
  reused: boolean;
  rerunRequiredStepCount: number;
}
interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
}

const SUMMARY_KEYS = [
  'activatedAt',
  'forwarderName',
  'id',
  'importedAt',
  'isActive',
  'rowCount',
  'sourceFileName',
  'sourceFileSha256',
];

describe('배대지 요금표 POST·GET /forwarder-rate-tables (e2e)', () => {
  let t: TestApp;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const importFile = (name: string, content: Buffer = file(name), forwarderName?: string) => {
    const req = http()
      .post('/api/v1/forwarder-rate-tables')
      .set('X-AutoStore-Client', '1')
      .attach('file', content, name);
    return forwarderName ? req.field('forwarderName', forwarderName) : req;
  };
  const activeCount = () => t.prisma.forwarderRateTable.count({ where: { isActive: true } });

  beforeAll(async () => {
    t = await createTestApp();
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await truncate(t.prisma, [...RATE_TABLE_TABLES, ...STEP_ENGINE_TABLES]);
    events.length = 0;
  });

  afterAll(async () => {
    unsubscribe();
    await t.app.close();
  });

  it('새 파일 → 201, Location, reused=false, isActive=true, 구간은 무게 오름차순, sourceFilePath 없음, 원본 CSV 보관', async () => {
    const res = await importFile('rate-table-v2026-09.csv', undefined, '[배대지 A]').expect(201);
    const body = res.body as ImportBody;
    expect(res.headers.location).toBe(`/api/v1/forwarder-rate-tables/${body.rateTable.id}`);
    expect(body.reused).toBe(false);
    expect(body.rerunRequiredStepCount).toBe(0);
    expect(Object.keys(body.rateTable).sort()).toEqual([...SUMMARY_KEYS, 'tiers'].sort());
    expect(body.rateTable).toMatchObject({
      forwarderName: '[배대지 A]',
      sourceFileName: 'rate-table-v2026-09.csv',
      rowCount: 5,
      isActive: true,
      importedAt: '2026-09-28T00:00:00.000Z',
      activatedAt: '2026-09-28T00:00:00.000Z',
    });
    expect(body.rateTable.tiers.map((x) => [x.weightMaxKg, x.fee, x.currency])).toEqual([
      [0.5, 9000, 'KRW'],
      [1, 12000, 'KRW'],
      [1.2, 15000, 'KRW'],
      [2, 18000, 'KRW'],
      [3, 22000, 'KRW'],
    ]);
    expect(body.rateTable.tiers[4]).toMatchObject({
      volumetricDivisor: 6000,
      volumetricAppliesWhen: 'ALWAYS',
    });
    const sha = createHash('sha256').update(file('rate-table-v2026-09.csv')).digest('hex');
    expect(body.rateTable.sourceFileSha256).toBe(sha);
    const row = await t.prisma.forwarderRateTable.findUniqueOrThrow({
      where: { id: body.rateTable.id },
    });
    expect(row.sourceFilePath).toBe(`forwarder-rate-tables/${sha}.csv`);
    expect(existsSync(join(DATA_DIR, 'forwarder-rate-tables', `${sha}.csv`))).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('forwarder-rate-tables/');
    const audit = await t.prisma.userActionLog.findMany({
      where: { eventType: 'SETTING_CHANGED' },
    });
    expect(audit.map((a) => a.detail)).toEqual([
      {
        setting: 'FORWARDER_RATE_TABLE',
        rateTableId: body.rateTable.id,
        previousRateTableId: null,
        reused: false,
      },
    ]);
  });

  it('같은 파일 다시 → 200, reused=true, 요금표 행 수 그대로', async () => {
    const first = (await importFile('rate-table-v2026-09.csv').expect(201)).body as ImportBody;
    const again = await importFile('rate-table-v2026-09.csv').expect(200);
    expect(again.headers.location).toBeUndefined();
    expect(again.body as ImportBody).toMatchObject({
      reused: true,
      rerunRequiredStepCount: 0,
      rateTable: { id: first.rateTable.id, isActive: true },
    });
    expect(await t.prisma.forwarderRateTable.count()).toBe(1);
    expect(await t.prisma.forwarderRateTier.count()).toBe(5);
  });

  it('다른 파일 → 201, 앞 버전 isActive=false, 활성은 1개. 앞 파일을 다시 넣으면 200 reused로 다시 켠다', async () => {
    const a = (await importFile('rate-table-v2026-09.csv').expect(201)).body as ImportBody;
    t.clock.advance(60_000);
    const b = (await importFile('rate-table-v2026-10.csv').expect(201)).body as ImportBody;
    expect(b.rateTable.isActive).toBe(true);
    expect(b.rateTable.tiers.map((x) => [x.weightMaxKg, x.fee, x.currency])).toEqual([
      [0.5, 1000, 'JPY'],
      [1.5, 1500, 'JPY'],
      [3, 2400, 'JPY'],
    ]);
    expect(
      (await t.prisma.forwarderRateTable.findUniqueOrThrow({ where: { id: a.rateTable.id } }))
        .isActive,
    ).toBe(false);
    expect(await activeCount()).toBe(1);
    t.clock.advance(60_000);
    const back = (await importFile('rate-table-v2026-09.csv').expect(200)).body as ImportBody;
    expect(back).toMatchObject({ reused: true, rateTable: { id: a.rateTable.id, isActive: true } });
    expect(back.rateTable.activatedAt).toBe('2026-09-28T00:02:00.000Z');
    expect(await activeCount()).toBe(1);
    expect(await t.prisma.forwarderRateTable.count()).toBe(2);
  });

  it('5MB 넘는 파일 → 413 PAYLOAD_TOO_LARGE, 행 없음', async () => {
    const big = Buffer.concat([
      file('rate-table-v2026-09.csv'),
      Buffer.alloc(5 * 1024 * 1024, 0x20),
    ]);
    const res = await importFile('big.csv', big).expect(413);
    expect((res.body as ErrorBody).code).toBe('PAYLOAD_TOO_LARGE');
    expect(await t.prisma.forwarderRateTable.count()).toBe(0);
  });

  it('.txt → 422 UNSUPPORTED_FILE_TYPE(가능: CSV), 바이너리(.csv 이름의 xlsx)도 같다', async () => {
    const res = await importFile('rate-table.txt').expect(422);
    expect(res.body as ErrorBody).toMatchObject({
      code: 'UNSUPPORTED_FILE_TYPE',
      message: '이 형식의 파일은 받을 수 없습니다(가능: CSV).',
    });
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
    expect(((await importFile('rates.csv', zip).expect(422)).body as ErrorBody).code).toBe(
      'UNSUPPORTED_FILE_TYPE',
    );
  });

  it('IMPORT_PARSE_FAILED(통화·같은 무게·숫자, fieldErrors에 행·열)와 IMPORT_EMPTY(머리행만)', async () => {
    const currency = (await importFile('rate-table-bad-currency.csv').expect(422))
      .body as ErrorBody;
    expect(currency).toMatchObject({
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: [{ field: 'row2.currency', message: '통화는 JPY 또는 KRW여야 합니다.' }],
    });
    const dup = (await importFile('rate-table-dup-weight.csv').expect(422)).body as ErrorBody;
    expect(dup.fieldErrors!.map((e) => e.field)).toEqual(['row4.weight_max_kg']);
    const numbers = (await importFile('rate-table-bad-numbers.csv').expect(422)).body as ErrorBody;
    expect(numbers.fieldErrors!.map((e) => e.field)).toEqual([
      'row2.fee',
      'row2.volumetric_divisor',
    ]);
    const empty = (await importFile('rate-table-header-only.csv').expect(422)).body as ErrorBody;
    expect(empty.code).toBe('IMPORT_EMPTY');
    const cp949 = Buffer.concat([
      file('rate-table-header-only.csv'),
      Buffer.from([0x31, 0x2c, 0xb9, 0xab, 0x0a]),
    ]);
    const notUtf8 = (await importFile('cp949.csv', cp949).expect(422)).body as ErrorBody;
    expect(notUtf8).toMatchObject({
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: [{ field: 'file' }],
    });
    expect(await t.prisma.forwarderRateTable.count()).toBe(0);
  });

  it('파일 없음 → 422 VALIDATION_FAILED(file), 헤더 없음 → 403, 모르는 칸·100자 넘는 이름 → 422', async () => {
    const none = await http()
      .post('/api/v1/forwarder-rate-tables')
      .set('X-AutoStore-Client', '1')
      .field('forwarderName', 'x')
      .expect(422);
    expect(none.body as ErrorBody).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'file' }],
    });
    const noHeader = await http()
      .post('/api/v1/forwarder-rate-tables')
      .attach('file', file('rate-table-v2026-09.csv'), 'rate-table-v2026-09.csv')
      .expect(403);
    expect((noHeader.body as ErrorBody).code).toBe('CLIENT_HEADER_REQUIRED');
    await importFile('rate-table-v2026-09.csv').field('note', 'x').expect(422);
    await importFile('rate-table-v2026-09.csv', undefined, 'x'.repeat(101)).expect(422);
    expect(await t.prisma.forwarderRateTable.count()).toBe(0);
  });

  it('활성 변경 전파: ③이 완료된 후보 → 다른 요금표 → rerunRequiredStepCount 1, PRICING RERUN_REQUIRED', async () => {
    const a = (await importFile('rate-table-v2026-09.csv').expect(201)).body as ImportBody;
    const c = (await createCandidate(t.prisma, { gender: 'MALE' })).candidate;
    await insertStepRun(t.prisma, {
      candidateId: c.id,
      stepCode: 'PRICING',
      status: 'COMPLETED',
      inputs: [
        {
          inputKey: 'forwarder.rateTable',
          sourceType: 'SETTINGS',
          value: { rateTableId: a.rateTable.id },
        },
      ],
    });
    events.length = 0;
    const b = (await importFile('rate-table-v2026-10.csv').expect(201)).body as ImportBody;
    expect(b.rerunRequiredStepCount).toBe(1);
    const step = await t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId: c.id, stepCode: 'PRICING' } },
    });
    expect(step).toMatchObject({ status: 'RERUN_REQUIRED', staleInputs: ['forwarder.rateTable'] });
    expect(events.filter((e) => e.name === 'candidate-step.changed').map((e) => e.data)).toEqual([
      expect.objectContaining({ candidateId: c.id, stepCode: 'PRICING', status: 'RERUN_REQUIRED' }),
    ]);
    // 같은 요금표(b)를 다시 넣으면 활성이 바뀌지 않아 전파도 없다
    expect(
      ((await importFile('rate-table-v2026-10.csv').expect(200)).body as ImportBody)
        .rerunRequiredStepCount,
    ).toBe(0);
  });

  it('요금표 없이 판정한 ③(rateTableId null)은 첫 요금표를 가져오면 재실행 필요가 된다', async () => {
    const c = (await createCandidate(t.prisma, { gender: 'FEMALE' })).candidate;
    await insertStepRun(t.prisma, {
      candidateId: c.id,
      stepCode: 'PRICING',
      status: 'COMPLETED',
      inputs: [
        { inputKey: 'forwarder.rateTable', sourceType: 'SETTINGS', value: { rateTableId: null } },
      ],
    });
    expect(
      ((await importFile('rate-table-v2026-09.csv').expect(201)).body as ImportBody)
        .rerunRequiredStepCount,
    ).toBe(1);
  });

  describe('조회', () => {
    it('GET /forwarder-rate-tables/999 → 404 RATE_TABLE_NOT_FOUND, 숫자가 아닌 id도 404', async () => {
      expect(
        ((await http().get('/api/v1/forwarder-rate-tables/999').expect(404)).body as ErrorBody)
          .code,
      ).toBe('RATE_TABLE_NOT_FOUND');
      await http().get('/api/v1/forwarder-rate-tables/abc').expect(404);
      await http().get('/api/v1/forwarder-rate-tables/0').expect(404);
    });

    it('?active=true → 1개, 기본 정렬 importedAt,desc, 허용 밖 값·정렬은 422 INVALID_QUERY_PARAMETER', async () => {
      await importFile('rate-table-v2026-09.csv').expect(201);
      t.clock.advance(60_000);
      await importFile('rate-table-v2026-10.csv').expect(201);
      const active = (await http().get('/api/v1/forwarder-rate-tables?active=true').expect(200))
        .body as {
        content: TableBody[];
        page: Record<string, number>;
      };
      expect(active.content).toHaveLength(1);
      expect(active.content[0]!.sourceFileName).toBe('rate-table-v2026-10.csv');
      expect(Object.keys(active.content[0]!).sort()).toEqual(SUMMARY_KEYS);
      const all = (await http().get('/api/v1/forwarder-rate-tables').expect(200)).body as {
        content: TableBody[];
      };
      expect(all.content.map((x) => x.sourceFileName)).toEqual([
        'rate-table-v2026-10.csv',
        'rate-table-v2026-09.csv',
      ]);
      const inactive = (
        await http()
          .get('/api/v1/forwarder-rate-tables?active=false&sort=importedAt,asc')
          .expect(200)
      ).body as { content: TableBody[] };
      expect(inactive.content.map((x) => x.sourceFileName)).toEqual(['rate-table-v2026-09.csv']);
      for (const q of ['active=yes', 'sort=foo,asc', 'size=0']) {
        const res = await http().get(`/api/v1/forwarder-rate-tables?${q}`).expect(422);
        expect((res.body as ErrorBody).code).toBe('INVALID_QUERY_PARAMETER');
      }
    });

    it('상세는 구간을 weightMaxKg 오름차순으로 주고, ③ 창구 activeForJudgement도 같은 순서다', async () => {
      const a = (await importFile('rate-table-v2026-09.csv').expect(201)).body as ImportBody;
      const detail = (
        await http().get(`/api/v1/forwarder-rate-tables/${a.rateTable.id}`).expect(200)
      ).body as TableBody;
      expect(detail.tiers!.map((x) => x.weightMaxKg)).toEqual([0.5, 1, 1.2, 2, 3]);
      const active = await t.app.get(ForwarderRateTablesService).activeForJudgement();
      expect(active!.id).toBe(a.rateTable.id);
      expect(active!.tiers.map((x) => x.weightMaxKg.toFixed())).toEqual([
        '0.5',
        '1',
        '1.2',
        '2',
        '3',
      ]);
    });
  });

  it('DB 트리거: forwarder_rate_table DELETE·forwarder_rate_tier UPDATE는 오류로 막힌다', async () => {
    await importFile('rate-table-v2026-09.csv').expect(201);
    await expect(t.prisma.$executeRawUnsafe('DELETE FROM forwarder_rate_table')).rejects.toThrow(
      /never deleted/,
    );
    await expect(
      t.prisma.$executeRawUnsafe('UPDATE forwarder_rate_tier SET fee = 1'),
    ).rejects.toThrow(/append-only/);
    // 활성은 하나뿐(uq_forwarder_rate_table_one_active)
    await expect(
      t.prisma.$executeRawUnsafe(
        `INSERT INTO forwarder_rate_table (source_file_name, source_file_sha256, row_count, is_active, activated_at) VALUES ('x.csv', '${'b'.repeat(64)}', 1, true, now())`,
      ),
    ).rejects.toThrow(/uq_forwarder_rate_table_one_active/);
  });
});
