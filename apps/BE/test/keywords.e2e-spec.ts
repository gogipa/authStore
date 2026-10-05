import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../src/common/events/progress-events.service.js';
import { KeywordCollectionRecovery } from '../src/modules/keywords/keyword-collection.recovery.js';
import { KeywordCollectionService } from '../src/modules/keywords/keyword-collection.service.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';
import { seedUsableAiEngine } from './support/fake-ai-engines.js';
import { DatalabFixtureServer, datalabPasteFixture } from './support/datalab-fixture.adapter.js';

/** setup-env.cjs가 이 파일에 준 임시 데이터 폴더(설정 파일 위치) */
const DATA_DIR = process.env.APP_DATA_DIR!;
const CLIENT = { 'X-AutoStore-Client': '1' };
/** 삭제 금지 트리거가 있어 TRUNCATE로 비운다(P2-01 §6) */
const TABLES = [
  'keyword',
  'keyword_snapshot',
  'call_log',
  'user_action_log',
  'candidate',
  'candidate_step',
  'candidate_status_history',
];
/** 지금 = 2026-09-24 00:30 KST → 요청 기간 2026-08-23 ~ 2026-09-23(fixture range와 같다) */
const NOW = Date.parse('2026-09-24T00:30:00+09:00');

interface SnapshotBody {
  id: number;
  method: string;
  collectedAt: string;
  requestedCids: string[];
  periodStart: string | null;
  periodEnd: string | null;
  rankLimit: number | null;
  responseRange: string | null;
  rangeMatched: boolean | null;
  status: string;
  abortReason: string | null;
  httpStatus: number | null;
  filters: unknown;
  keywordCount: number;
  excludedCount: number;
  structureChangeSuspected?: boolean;
  blockedUntil?: string | null;
  /** 지금 고른 키워드(D-33) — 묶음 한 건 조회에만 있다 */
  selectedKeyword?: KeywordBody | null;
}
interface KeywordBody {
  id: number;
  keywordSnapshotId: number;
  cid: string | null;
  rank: number;
  keyword: string;
  excludedReason: string | null;
  selectedAt: string | null;
  candidateIds: number[];
}
interface PageBody<T> {
  content: T[];
  page: { number: number; size: number; totalElements: number; totalPages: number };
}
interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string }[];
}

/** '순위 한글90자' 줄로 정확히 total자(코드 포인트)인 붙여넣기 글. 남는 몇 자는 마지막 키워드에 붙인다(100자 이내) */
function pasteOfLength(total: number): string {
  const lines: string[] = [];
  let used = 0;
  for (let rank = 1; ; rank += 1) {
    const prefix = `${rank} `;
    const sep = lines.length > 0 ? 1 : 0;
    const room = total - used - sep - prefix.length;
    if (room < 1) break;
    const n = Math.min(90, room);
    lines.push(prefix + '가'.repeat(n));
    used += sep + prefix.length + n;
  }
  lines[lines.length - 1] += '가'.repeat(total - used);
  return lines.join('\n');
}

describe('① 키워드 API(e2e, 가짜 데이터랩, P2-01)', () => {
  let t: TestApp;
  let collection: KeywordCollectionService;
  const server = new DatalabFixtureServer();
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body: object) => http().post(`/api/v1${path}`).set(CLIENT).send(body);
  const button = (body: object = {}) => post('/keyword-snapshots', { method: 'BUTTON', ...body });
  const paste = (text: string, cid: string | null = null) =>
    post('/keyword-snapshots', { method: 'PASTE', text, cid });
  const getSnapshot = (id: number) => http().get(`/api/v1/keyword-snapshots/${id}`);
  const listKeywords = (id: number, query = '') =>
    http().get(`/api/v1/keyword-snapshots/${id}/keywords${query}`);
  const select = (id: number | string) =>
    http().put(`/api/v1/keywords/${id}/selection`).set(CLIENT);
  const unselect = (id: number | string) =>
    http().delete(`/api/v1/keywords/${id}/selection`).set(CLIENT);
  const status = () => http().get('/api/v1/keyword-collection-status');

  async function collectButton(body: object = {}): Promise<SnapshotBody> {
    const res = await button(body).expect(202);
    await collection.whenIdle();
    const got = await getSnapshot((res.body as { keywordSnapshotId: number }).keywordSnapshotId);
    return got.body as SnapshotBody;
  }

  beforeAll(async () => {
    t = await createTestApp({
      // 다른 스위트가 남긴 같은 내용의 설정 스냅샷이 있으면 '새 스냅샷' 검사가 흔들린다(P1-11과 같은 규약)
      beforeInit: (prisma) => truncate(prisma, [...TABLES, 'settings_snapshot']),
    });
    collection = t.app.get(KeywordCollectionService);
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  afterAll(async () => {
    unsubscribe();
    server.release();
    await t.app.close();
  });

  beforeEach(async () => {
    server.release();
    await collection.whenIdle();
    await truncate(t.prisma, TABLES);
    server.reset();
    t.fetch.reset();
    // 가짜 데이터랩을 가짜 fetch(HTTP_FETCH) 뒤에 둔다 → 실제 어댑터·외부 호출 관문(허용 목록·UA·간격·call_log·쉼)을 지난다
    t.fetch.handler = server.fetchHandler;
    t.clock.ms = NOW;
    events.length = 0;
  });

  describe('버튼 수집(BUTTON)', () => {
    it('202 + Location + RUNNING 묶음. 끝나면 COMPLETED·rangeMatched·개수, call_log DATALAB 10행(item_count)', async () => {
      const res = await button().expect(202);
      const accepted = res.body as { keywordSnapshotId: number };
      expect(res.body).toEqual({
        keywordSnapshotId: accepted.keywordSnapshotId,
        status: 'RUNNING',
        rankLimit: 100,
        requestedCids: ['50000173', '50000174'],
      });
      expect(res.headers.location).toBe(`/api/v1/keyword-snapshots/${accepted.keywordSnapshotId}`);
      await collection.whenIdle();

      const got = (await getSnapshot(accepted.keywordSnapshotId).expect(200)).body as SnapshotBody;
      expect(got).toMatchObject({
        method: 'BUTTON',
        status: 'COMPLETED',
        requestedCids: ['50000173', '50000174'],
        periodStart: '2026-08-23',
        periodEnd: '2026-09-23',
        rankLimit: 100,
        responseRange: '2026.08.23. ~ 2026.09.23.',
        rangeMatched: true,
        abortReason: null,
        httpStatus: null,
        filters: null,
        keywordCount: 200,
        excludedCount: 3,
        structureChangeSuspected: false,
        blockedUntil: null,
        selectedKeyword: null,
      });

      const logs = await t.prisma.callLog.findMany({ orderBy: { id: 'asc' } });
      expect(logs).toHaveLength(10);
      expect(logs.every((l) => l.target === 'DATALAB' && l.itemCount === 20)).toBe(true);
      expect(logs.every((l) => l.httpStatus === 200 && l.errorCode === null)).toBe(true);

      // 요청 조립: 한 요청에 cid 하나, 순서 173 p1~p5 → 174 p1~p5, 앱 UA·Referer, count=20, 2초 이상 간격
      expect(server.callKeys).toEqual([
        '50000173:p1',
        '50000173:p2',
        '50000173:p3',
        '50000173:p4',
        '50000173:p5',
        '50000174:p1',
        '50000174:p2',
        '50000174:p3',
        '50000174:p4',
        '50000174:p5',
      ]);
      const first = server.calls[0]!;
      expect(first.headers?.Referer).toBe(
        'https://datalab.naver.com/shoppingInsight/sCategory.naver',
      );
      expect(first.headers?.['User-Agent']).toMatch(/^autoStore\//);
      expect(first.headers?.['User-Agent']).not.toMatch(/Mozilla/);
      expect(Object.fromEntries(first.form!)).toMatchObject({
        cid: '50000173',
        timeUnit: 'date',
        startDate: '2026-08-23',
        endDate: '2026-09-23',
        age: '',
        gender: '',
        device: '',
        page: '1',
        count: '20',
      });
      const starts = t.fetch.calls.map((c) => c.startedAt);
      for (let i = 1; i < starts.length; i += 1) {
        expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(2000);
      }
      expect(t.fetch.maxInFlight).toBe(1);

      // 진행 알림: 페이지마다 progress 10개 + completed 1개
      expect(events.filter((e) => e.name === 'keyword-collection.progress')).toHaveLength(10);
      const done = events.filter((e) => e.name === 'keyword-collection.completed');
      expect(done.map((e) => e.data)).toEqual([
        {
          keywordSnapshotId: accepted.keywordSnapshotId,
          keywordCount: 200,
          excludedCount: 3,
          rangeMatched: true,
        },
      ]);

      // 수집 상태: 마지막 수집·요청 간격·이상 없음
      const st = (await status().expect(200)).body as Record<string, unknown>;
      expect(st).toEqual({
        collecting: false,
        runningKeywordSnapshotId: null,
        lastKeywordSnapshotId: accepted.keywordSnapshotId,
        lastCollectedAt: new Date(NOW).toISOString(),
        lastStatus: 'COMPLETED',
        lastAbortReason: null,
        blockedUntil: null,
        requestIntervalSeconds: 2,
        disabledReasonCode: null,
      });
    });

    it('수집 중 두 번째 BUTTON → 409 ALREADY_IN_PROGRESS(details.job=KEYWORD_COLLECTION), 상태 collecting', async () => {
      server.hold();
      const first = await button().expect(202);
      const id = (first.body as { keywordSnapshotId: number }).keywordSnapshotId;
      const second = await button({ rankLimit: 500 }).expect(409);
      expect(second.body).toMatchObject({
        code: 'ALREADY_IN_PROGRESS',
        message: '데이터랩 수집이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
        details: { job: 'KEYWORD_COLLECTION', keywordSnapshotId: id },
      });
      const st = (await status().expect(200)).body as Record<string, unknown>;
      expect(st).toMatchObject({
        collecting: true,
        runningKeywordSnapshotId: id,
        disabledReasonCode: 'ALREADY_IN_PROGRESS',
      });
      // 붙여넣기는 수집 중에도 된다
      await paste('1 뉴발란스 530').expect(201);
      server.release();
      await collection.whenIdle();
      expect(((await getSnapshot(id)).body as SnapshotBody).status).toBe('COMPLETED');
      expect(await t.prisma.keywordSnapshot.count({ where: { method: 'BUTTON' } })).toBe(1);
    });

    it('429 → ABORTED·HTTP_429, 구조 변경 의심 아님, blockedUntil ≈ +24h. 다시 BUTTON → 409 EXTERNAL_CALL_COOLDOWN + Retry-After, PASTE → 201', async () => {
      server.answer('50000173', 3, { statusCase: 429 });
      const got = await collectButton();
      expect(server.calls).toHaveLength(3);
      expect(got).toMatchObject({
        status: 'ABORTED',
        abortReason: 'HTTP_429',
        httpStatus: 429,
        structureChangeSuspected: false,
        keywordCount: 40,
      });
      const log429 = await t.prisma.callLog.findFirstOrThrow({ where: { httpStatus: 429 } });
      const expectedUntil = log429.calledAt.getTime() + 24 * 3600 * 1000;
      expect(Date.parse(got.blockedUntil!)).toBe(expectedUntil);
      const aborted = events.filter((e) => e.name === 'keyword-collection.aborted');
      expect(aborted.map((e) => e.data)).toEqual([
        {
          keywordSnapshotId: got.id,
          abortReason: 'HTTP_429',
          httpStatus: 429,
          structureChangeSuspected: false,
          blockedUntil: new Date(expectedUntil).toISOString(),
        },
      ]);

      const again = await button().expect(409);
      expect(again.body).toMatchObject({
        code: 'EXTERNAL_CALL_COOLDOWN',
        details: {
          target: 'DATALAB',
          blockedUntil: new Date(expectedUntil).toISOString(),
          httpStatus: 429,
        },
      });
      expect(Number(again.headers['retry-after'])).toBeGreaterThan(23 * 3600);
      expect(server.calls).toHaveLength(3);

      const st = (await status().expect(200)).body as Record<string, unknown>;
      expect(st).toMatchObject({
        collecting: false,
        lastStatus: 'ABORTED',
        lastAbortReason: 'HTTP_429',
        blockedUntil: new Date(expectedUntil).toISOString(),
        disabledReasonCode: 'EXTERNAL_CALL_COOLDOWN',
      });
      await paste(datalabPasteFixture('ok.txt')).expect(201);
    });

    it('no-ranks-key → structureChangeSuspected:true, SSE keyword-collection.aborted 1건, call_log error_code', async () => {
      server.answer('50000173', 1, { file: 'no-ranks-key.json' });
      const got = await collectButton();
      expect(got).toMatchObject({
        status: 'ABORTED',
        abortReason: 'NO_RANKS_KEY',
        httpStatus: null,
        structureChangeSuspected: true,
        blockedUntil: null,
      });
      expect(events.filter((e) => e.name === 'keyword-collection.aborted')).toHaveLength(1);
      const log = await t.prisma.callLog.findFirstOrThrow();
      expect(log).toMatchObject({ errorCode: 'NO_RANKS_KEY', httpStatus: 200, itemCount: null });
    });

    it('rankLimit 500 → cid당 25페이지(fixture 없는 6페이지는 빈 ranks라 cid마다 6요청), M2 칸·잘못된 값은 422', async () => {
      const got = await collectButton({ rankLimit: 500 });
      expect(got).toMatchObject({ status: 'COMPLETED', rankLimit: 500, keywordCount: 200 });
      expect(server.calls).toHaveLength(12);
      const m2 = await button({ requestedCids: ['50000173'] }).expect(422);
      expect(m2.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: [{ field: 'requestedCids' }],
      });
      await button({ rankLimit: 200 }).expect(422);
      const text = await button({ text: '1 a' }).expect(422);
      expect((text.body as ErrorBody).fieldErrors?.[0]?.field).toBe('text');
      await post('/keyword-snapshots', { method: 'CRAWL' }).expect(422);
    });
  });

  describe('붙여넣기(PASTE)', () => {
    it('201 + Location, requestedCids [] · 기간·범위 null, 아동 단어는 제외 표시', async () => {
      const res = await paste(datalabPasteFixture('with-child-terms.txt')).expect(201);
      const body = res.body as SnapshotBody;
      expect(res.headers.location).toBe(`/api/v1/keyword-snapshots/${body.id}`);
      expect(body).toMatchObject({
        method: 'PASTE',
        status: 'COMPLETED',
        requestedCids: [],
        periodStart: null,
        periodEnd: null,
        rankLimit: null,
        responseRange: null,
        rangeMatched: null,
        abortReason: null,
        keywordCount: 7,
        excludedCount: 3,
      });
      const withCid = await paste(datalabPasteFixture('ok.txt'), '50000174').expect(201);
      expect((withCid.body as SnapshotBody).requestedCids).toEqual(['50000174']);
      const rows = await t.prisma.keyword.findMany({
        where: { keywordSnapshotId: (withCid.body as SnapshotBody).id },
      });
      expect(rows.every((r) => r.cid === '50000174')).toBe(true);
    });

    it('100,000자(한글 약 300KB)는 받고, 100,001자 → 413 PAYLOAD_TOO_LARGE', async () => {
      const text = pasteOfLength(100_000);
      expect([...text].length).toBe(100_000);
      await paste(text).expect(201);
      const tooLong = await paste(`${text}가`).expect(413);
      expect(tooLong.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
      // JSON 본문 상한(1MB, app.setup.ts JSON_BODY_LIMIT)을 넘는 본문도 같은 봉투(413)다 — 컨트롤러에 닿기 전에 막힌다
      const huge = await paste('가'.repeat(400_000)).expect(413);
      expect(huge.body).toMatchObject({ code: 'PAYLOAD_TOO_LARGE', status: 413 });
      expect(await t.prisma.keywordSnapshot.count()).toBe(1);
    });

    it('중복 순위 → 422 IMPORT_PARSE_FAILED(fieldErrors에 줄), 빈 줄만 → 422 IMPORT_EMPTY, cid 밖 값 → 422', async () => {
      const dup = await paste(datalabPasteFixture('duplicate-rank.txt')).expect(422);
      expect(dup.body).toMatchObject({
        code: 'IMPORT_PARSE_FAILED',
        fieldErrors: [{ field: 'text[3]', message: '3번째 줄: 2번째 줄과 같은 순위(2)입니다.' }],
      });
      const empty = await paste(datalabPasteFixture('blank-only.txt')).expect(422);
      expect((empty.body as ErrorBody).code).toBe('IMPORT_EMPTY');
      await paste('1 a', '50000175').expect(422);
      await post('/keyword-snapshots', { method: 'PASTE', text: '' }).expect(422);
      await post('/keyword-snapshots', { method: 'PASTE', text: '1 a', rankLimit: 100 }).expect(
        422,
      );
      expect(await t.prisma.keywordSnapshot.count()).toBe(0);
    });
  });

  describe('목록·조회', () => {
    it('GET …/keywords: 기본 → CHILD 없음, excluded=true → CHILD만, cid 필터, 허용 밖 → 422, 없는 묶음 → 404', async () => {
      const snap = await collectButton();
      const all = (await listKeywords(snap.id, '?size=100').expect(200))
        .body as PageBody<KeywordBody>;
      expect(all.page).toEqual({ number: 0, size: 100, totalElements: 197, totalPages: 2 });
      expect(all.content.every((k) => k.excludedReason === null)).toBe(true);
      // 순위순(같은 순위는 cid 순)
      expect(all.content.slice(0, 2).map((k) => [k.rank, k.cid])).toEqual([
        [1, '50000173'],
        [1, '50000174'],
      ]);
      const excluded = (await listKeywords(snap.id, '?excluded=true').expect(200))
        .body as PageBody<KeywordBody>;
      expect(excluded.content.map((k) => [k.keyword, k.excludedReason])).toEqual([
        ['키즈 운동화', 'CHILD'],
        ['주니어 축구화', 'CHILD'],
        ['キッズ スニーカー', 'CHILD'],
      ]);
      const men = (await listKeywords(snap.id, '?cid=50000174&size=10&page=1').expect(200))
        .body as PageBody<KeywordBody>;
      expect(men.page.totalElements).toBe(99);
      expect(men.content[0]).toMatchObject({ cid: '50000174', rank: 11, candidateIds: [] });
      const desc = (await listKeywords(snap.id, '?sort=rank,desc&size=1').expect(200))
        .body as PageBody<KeywordBody>;
      expect(desc.content[0]!.rank).toBe(100);

      for (const q of [
        '?sort=keyword,asc',
        '?size=101',
        '?excluded=yes',
        '?view=EXCLUDED_BRANDS',
      ]) {
        const bad = await listKeywords(snap.id, q).expect(422);
        expect((bad.body as ErrorBody).code).toBe('INVALID_QUERY_PARAMETER');
      }
      await listKeywords(snap.id, '?view=ALL').expect(200);
      await listKeywords(snap.id + 999).expect(404);
      await getSnapshot(snap.id + 999).expect(404);
      const notId = await getSnapshot('abc' as unknown as number).expect(404);
      expect((notId.body as ErrorBody).code).toBe('KEYWORD_SNAPSHOT_NOT_FOUND');
    });

    it('GET /keyword-snapshots: collectedAt 최신순 페이징, method·status 필터, 허용 밖 정렬 422', async () => {
      await paste('1 뉴발란스 530');
      t.clock.advance(60_000);
      await paste('1 아식스');
      t.clock.advance(60_000);
      server.answer('50000173', 1, { file: 'not-json.html' });
      await collectButton();
      const list = (await http().get('/api/v1/keyword-snapshots?size=2').expect(200))
        .body as PageBody<SnapshotBody>;
      expect(list.page.totalElements).toBe(3);
      expect(list.content.map((s) => s.method)).toEqual(['BUTTON', 'PASTE']);
      expect(list.content[0]).toMatchObject({ status: 'ABORTED', abortReason: 'NOT_JSON' });
      const pastes = (
        await http().get('/api/v1/keyword-snapshots?method=PASTE&sort=collectedAt,asc')
      ).body as PageBody<SnapshotBody>;
      expect(pastes.content.map((s) => s.keywordCount)).toEqual([1, 1]);
      const aborted = (await http().get('/api/v1/keyword-snapshots?status=ABORTED'))
        .body as PageBody<SnapshotBody>;
      expect(aborted.page.totalElements).toBe(1);
      for (const q of ['?sort=id,asc', '?method=URL', '?status=DONE']) {
        await http().get(`/api/v1/keyword-snapshots${q}`).expect(422);
      }
    });
  });

  describe('G1 키워드 고르기(D-33 — 한 묶음에 하나)', () => {
    async function pasteKeywords(): Promise<KeywordBody[]> {
      const snap = (await paste(datalabPasteFixture('with-child-terms.txt')).expect(201))
        .body as SnapshotBody;
      const all = await listKeywords(snap.id);
      const excluded = await listKeywords(snap.id, '?excluded=true');
      return [
        ...(all.body as PageBody<KeywordBody>).content,
        ...(excluded.body as PageBody<KeywordBody>).content,
      ];
    }
    const named = (rows: KeywordBody[], keyword: string): KeywordBody =>
      rows.find((k) => k.keyword === keyword)!;
    /** 묶음 조회가 돌려주는 '지금 고른 키워드' */
    const currentOf = async (snapshotId: number): Promise<KeywordBody | null> =>
      ((await getSnapshot(snapshotId).expect(200)).body as SnapshotBody)
        .selectedKeyword as KeywordBody | null;
    const selectedAtOf = async (id: number): Promise<string | null> =>
      (await t.prisma.keyword.findUniqueOrThrow({ where: { id } })).selectedAt?.toISOString() ??
      null;
    const at = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();
    const audit = () => t.prisma.userActionLog.findMany({ orderBy: { id: 'asc' } });

    it('PUT 200 selectedAt · 두 번 → 같은 selectedAt · 제외 → 409 · 없는 id → 404 · 감사 기록 GATE_PASSED·G1 1행 · selectedKeyword', async () => {
      const rows = await pasteKeywords();
      const target = named(rows, '뉴발란스 530');
      const child = rows.find((k) => k.excludedReason === 'CHILD')!;
      expect(await currentOf(target.keywordSnapshotId)).toBeNull();
      const first = (await select(target.id).expect(200)).body as KeywordBody;
      expect(first).toMatchObject({ id: target.id, selectedAt: new Date(NOW).toISOString() });
      t.clock.advance(5_000);
      const second = (await select(target.id).expect(200)).body as KeywordBody;
      expect(second.selectedAt).toBe(first.selectedAt);
      expect(await currentOf(target.keywordSnapshotId)).toEqual(first);

      const excluded = await select(child.id).expect(409);
      expect(excluded.body).toMatchObject({
        code: 'KEYWORD_EXCLUDED',
        message: '아동화로 빠진 키워드는 고를 수 없습니다.',
      });
      expect((await select(999_999).expect(404)).body).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
      await select('x1').expect(404);
      // 막힌 요청은 지금 고른 키워드를 바꾸지 않는다
      expect((await currentOf(target.keywordSnapshotId))?.id).toBe(target.id);

      const logs = await audit();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        eventType: 'GATE_PASSED',
        gate: 'G1',
        candidateId: null,
        detail: { keywordId: target.id, keywordSnapshotId: target.keywordSnapshotId },
      });
    });

    it('아동 제외 줄은 DB도 막는다(ck_keyword_excluded_not_selected) · selectedAt이 비어 있다', async () => {
      const rows = await pasteKeywords();
      const child = rows.find((k) => k.excludedReason === 'CHILD')!;
      await select(child.id).expect(409);
      expect(await selectedAtOf(child.id)).toBeNull();
      await expect(
        t.prisma.keyword.update({ where: { id: child.id }, data: { selectedAt: new Date(NOW) } }),
      ).rejects.toThrow(/ck_keyword_excluded_not_selected/);
      expect(await audit()).toHaveLength(0);
    });

    it('고른 것이 없는 묶음(붙여넣기)은 selectedKeyword null — 필드는 늘 들어 있다', async () => {
      const rows = await pasteKeywords();
      const snapshotId = rows[0]!.keywordSnapshotId;
      const body = (await getSnapshot(snapshotId).expect(200)).body as SnapshotBody;
      expect(body).toHaveProperty('selectedKeyword', null);
      expect(await audit()).toHaveLength(0);
    });

    it('A → B: selectedKeyword가 B · A의 selectedAt은 그대로(null 아님) · 감사 2행', async () => {
      const rows = await pasteKeywords();
      const a = named(rows, '뉴발란스 530');
      const b = named(rows, '아식스 젤카야노14');
      const snapshotId = a.keywordSnapshotId;
      await select(a.id).expect(200);
      expect((await currentOf(snapshotId))?.id).toBe(a.id);
      t.clock.advance(5_000);
      const pickedB = (await select(b.id).expect(200)).body as KeywordBody;
      expect(pickedB).toMatchObject({ id: b.id, selectedAt: at(5_000) });

      expect(await currentOf(snapshotId)).toEqual(pickedB);
      // 앞서 고른 A의 승인 이력(후보 G1 통과 시각)은 지우지 않는다
      expect(await selectedAtOf(a.id)).toBe(at(0));
      const logs = await audit();
      expect(logs.map((l) => l.detail)).toEqual([
        { keywordId: a.id, keywordSnapshotId: snapshotId },
        { keywordId: b.id, keywordSnapshotId: snapshotId },
      ]);
      expect(logs.map((l) => l.occurredAt.toISOString())).toEqual([at(0), at(5_000)]);
      expect(logs.every((l) => l.eventType === 'GATE_PASSED' && l.gate === 'G1')).toBe(true);
    });

    it('A → B → A: 앞서 고른 A를 다시 고르면 A가 지금 고른 키워드 · 고정 시계(NOW)여도 1ms씩 늦춰 순서가 선다 · 같은 키워드를 또 고르면 멱등 · 감사 3행', async () => {
      const rows = await pasteKeywords();
      const a = named(rows, '뉴발란스 530');
      const b = named(rows, '아식스 젤카야노14');
      const snapshotId = a.keywordSnapshotId;
      // 시계가 움직이지 않는다 — 같은 시각에 세 번 고른다
      expect(((await select(a.id).expect(200)).body as KeywordBody).selectedAt).toBe(at(0));
      expect(((await select(b.id).expect(200)).body as KeywordBody).selectedAt).toBe(at(1));
      const again = (await select(a.id).expect(200)).body as KeywordBody;
      expect(again).toMatchObject({ id: a.id, selectedAt: at(2) });
      expect(await currentOf(snapshotId)).toEqual(again);
      expect(await selectedAtOf(b.id)).toBe(at(1));
      expect((await audit()).map((l) => (l.detail as { keywordId: number }).keywordId)).toEqual([
        a.id,
        b.id,
        a.id,
      ]);

      // 이미 지금 고른 키워드를 또 고르면 그대로(기록 없음)
      t.clock.advance(7_000);
      expect(((await select(a.id).expect(200)).body as KeywordBody).selectedAt).toBe(at(2));
      expect(await audit()).toHaveLength(3);
      // 시계가 앞서가면 지금 시각이 그대로 선다(+1ms 보정은 같거나 거꾸로 갈 때만)
      const later = (await select(b.id).expect(200)).body as KeywordBody;
      expect(later.selectedAt).toBe(at(7_000));
      expect((await currentOf(snapshotId))?.id).toBe(b.id);
      expect(await audit()).toHaveLength(4);
    });

    it('묶음마다 하나: 다른 묶음의 선택은 영향이 없다', async () => {
      const first = await pasteKeywords();
      const second = await pasteKeywords();
      const a = named(first, '뉴발란스 530');
      const b = named(second, '아식스 젤카야노14');
      expect(a.keywordSnapshotId).not.toBe(b.keywordSnapshotId);
      await select(a.id).expect(200);
      t.clock.advance(1_000);
      await select(b.id).expect(200);
      // 뒤에 고른 b가 더 늦지만 a의 묶음에서는 여전히 a
      expect((await currentOf(a.keywordSnapshotId))?.id).toBe(a.id);
      expect((await currentOf(b.keywordSnapshotId))?.id).toBe(b.id);
      expect(await selectedAtOf(a.id)).toBe(at(0));
      expect(await audit()).toHaveLength(2);
    });

    it('한 묶음 안에서는 분야(여/남)·쪽과 관계없이 하나', async () => {
      const snap = await collectButton();
      // 수집 중 요청 간격 기다림이 가짜 시계를 앞으로 보냈다 → 고정 시각으로 되돌린다
      t.clock.ms = NOW;
      const women = (await listKeywords(snap.id, '?cid=50000173&size=10').expect(200))
        .body as PageBody<KeywordBody>;
      const menPage2 = (await listKeywords(snap.id, '?cid=50000174&size=10&page=1').expect(200))
        .body as PageBody<KeywordBody>;
      const a = women.content[0]!;
      const b = menPage2.content[0]!;
      expect([a.cid, b.cid]).toEqual(['50000173', '50000174']);
      expect(await currentOf(snap.id)).toBeNull();
      await select(a.id).expect(200);
      t.clock.advance(1_000);
      await select(b.id).expect(200);
      expect((await currentOf(snap.id))?.id).toBe(b.id);
      // 목록 줄에는 앞서 고른 a의 selectedAt이 그대로 남는다
      const womenAgain = (await listKeywords(snap.id, '?cid=50000173&size=10').expect(200))
        .body as PageBody<KeywordBody>;
      expect(womenAgain.content[0]).toMatchObject({ id: a.id, selectedAt: at(0) });
      expect(await t.prisma.keyword.count({ where: { selectedAt: { not: null } } })).toBe(2);
    });

    it('DELETE: 지금 고른 키워드를 비우면 그다음으로 늦게 고른 것이 지금 고른 키워드 · 지금 고른 것이 아닌 키워드를 비워도 그대로', async () => {
      const rows = await pasteKeywords();
      const a = named(rows, '뉴발란스 530');
      const b = named(rows, '아식스 젤카야노14');
      const c = named(rows, '아디다스 삼바');
      const snapshotId = a.keywordSnapshotId;
      for (const k of [a, b, c]) {
        await select(k.id).expect(200);
        t.clock.advance(1_000);
      }
      expect((await currentOf(snapshotId))?.id).toBe(c.id);

      await unselect(c.id).expect(204);
      expect(await selectedAtOf(c.id)).toBeNull();
      expect(await currentOf(snapshotId)).toMatchObject({ id: b.id, selectedAt: at(1_000) });

      // 지금 고른 b가 아닌 a를 비워도 b는 그대로
      await unselect(a.id).expect(204);
      expect((await currentOf(snapshotId))?.id).toBe(b.id);

      await unselect(b.id).expect(204);
      expect(await currentOf(snapshotId)).toBeNull();
      // 비운 c를 다시 고르면 처음 고르는 것과 같다(감사 기록이 더 남는다)
      await select(c.id).expect(200);
      expect((await currentOf(snapshotId))?.id).toBe(c.id);
      expect(await audit()).toHaveLength(4);
    });

    it('selected_at이 여러 개 이미 있으면(예전 데이터) 가장 늦은 것이 지금 고른 키워드(같으면 id가 큰 쪽) · 새로 고르면 그 가장 늦은 값 뒤 1ms부터', async () => {
      const rows = await pasteKeywords();
      const old = named(rows, '뉴발란스 530');
      const tieA = named(rows, '아식스 젤카야노14');
      const tieB = named(rows, '아디다스 삼바');
      const fresh = named(rows, '나이키 코르테즈');
      const snapshotId = old.keywordSnapshotId;
      // 지금(NOW)보다 앞선 값 하나, 지금보다 뒤(시계가 거꾸로 간 경우)인 같은 값 둘
      await t.prisma.keyword.update({
        where: { id: old.id },
        data: { selectedAt: new Date(NOW - 60_000) },
      });
      for (const k of [tieA, tieB]) {
        await t.prisma.keyword.update({
          where: { id: k.id },
          data: { selectedAt: new Date(NOW + 60_000) },
        });
      }
      const [winner, loser] = tieA.id > tieB.id ? [tieA, tieB] : [tieB, tieA];
      expect(await currentOf(snapshotId)).toMatchObject({ id: winner.id, selectedAt: at(60_000) });

      // 지금 고른 키워드가 아닌 쪽(같은 값의 id 작은 쪽)을 고르면 그 값보다 1ms 뒤
      expect(((await select(loser.id).expect(200)).body as KeywordBody).selectedAt).toBe(
        at(60_001),
      );
      expect((await currentOf(snapshotId))?.id).toBe(loser.id);
      // 처음 고르는 키워드도, 한참 전에 골랐던 키워드도 가장 늦은 값 뒤로 간다
      expect(((await select(fresh.id).expect(200)).body as KeywordBody).selectedAt).toBe(
        at(60_002),
      );
      expect(((await select(old.id).expect(200)).body as KeywordBody).selectedAt).toBe(at(60_003));
      expect((await currentOf(snapshotId))?.id).toBe(old.id);
      expect(await selectedAtOf(winner.id)).toBe(at(60_000));
      expect(await audit()).toHaveLength(3);
    });

    it('DELETE 204(비어 있어도 204) · 그 키워드로 후보를 만든 뒤 → 409 KEYWORD_IN_USE · 고르지 않은 키워드로 후보 → 409 KEYWORD_NOT_SELECTED', async () => {
      const rows = await pasteKeywords();
      const target = named(rows, '아식스 젤카야노14');
      const other = named(rows, '아디다스 삼바');
      const child = rows.find((k) => k.excludedReason === 'CHILD')!;
      await unselect(target.id).expect(204);
      await select(target.id).expect(200);
      await unselect(target.id).expect(204);
      expect(
        (await t.prisma.keyword.findUniqueOrThrow({ where: { id: target.id } })).selectedAt,
      ).toBeNull();
      await unselect(999_999).expect(404);

      const notSelected = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: other.id,
        rakutenQuery: other.keyword,
      }).expect(409);
      expect((notSelected.body as ErrorBody).code).toBe('KEYWORD_NOT_SELECTED');
      const childCandidate = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: child.id,
        rakutenQuery: 'キッズ',
      }).expect(409);
      expect((childCandidate.body as ErrorBody).code).toBe('KEYWORD_EXCLUDED');

      await select(target.id).expect(200);
      const created = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: target.id,
        rakutenQuery: target.keyword,
      }).expect(201);
      const candidateId = (created.body as { id: number }).id;
      const inUse = await unselect(target.id).expect(409);
      expect(inUse.body).toMatchObject({
        code: 'KEYWORD_IN_USE',
        message: '이 키워드로 만든 여정이 있어 선택을 취소할 수 없습니다.',
        details: { keywordId: target.id, candidateIds: [candidateId] },
      });
      const list = (await listKeywords(target.keywordSnapshotId).expect(200))
        .body as PageBody<KeywordBody>;
      expect(list.content.find((k) => k.id === target.id)!.candidateIds).toEqual([candidateId]);
      // 막힌 DELETE는 지금 고른 키워드를 바꾸지 않는다
      expect((await currentOf(target.keywordSnapshotId))?.id).toBe(target.id);
    });

    it('앞서 고른(지금 고른 것이 아닌) 키워드로도 후보를 만들 수 있고, 그 키워드는 KEYWORD_IN_USE로 막힌다 · 지금 고른 키워드는 그대로', async () => {
      const rows = await pasteKeywords();
      const earlier = named(rows, '아식스 젤카야노14');
      const current = named(rows, '아디다스 삼바');
      await select(earlier.id).expect(200);
      t.clock.advance(1_000);
      await select(current.id).expect(200);
      // selected_at이 비어 있지 않으면 후보를 만들 수 있다(화면은 지금 고른 키워드만 보낸다)
      const created = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: earlier.id,
        rakutenQuery: earlier.keyword,
      }).expect(201);
      const candidateId = (created.body as { id: number }).id;
      const inUse = await unselect(earlier.id).expect(409);
      expect(inUse.body).toMatchObject({
        code: 'KEYWORD_IN_USE',
        details: { keywordId: earlier.id, candidateIds: [candidateId] },
      });
      expect((await currentOf(earlier.keywordSnapshotId))?.id).toBe(current.id);
      expect(await selectedAtOf(earlier.id)).toBe(at(0));
    });
  });

  describe('아동 단어', () => {
    it('목록 6개(builtIn) · 더하기 201(새 settingsSnapshotId) · 같은 단어 409 · 빈 값·100자 초과 422 · DELETE 없음(404) · 기존 묶음은 그대로', async () => {
      const list = (await http().get('/api/v1/child-keyword-terms').expect(200)).body as {
        items: { term: string; builtIn: boolean }[];
      };
      expect(list.items).toEqual(
        ['키즈', '주니어', '아동', 'キッズ', 'ジュニア', 'ベビー'].map((term) => ({
          term,
          builtIn: true,
        })),
      );
      const before = await paste('1 유아 샌들\n2 뉴발란스 530').expect(201);
      const beforeId = (before.body as SnapshotBody).id;
      const snapshotBefore = await t.prisma.settingsSnapshot.findFirstOrThrow({
        orderBy: [{ lastLoadedAt: 'desc' }, { id: 'desc' }],
      });

      const added = await post('/child-keyword-terms', { term: ' 유아 ' }).expect(201);
      expect(added.body).toMatchObject({ term: '유아', builtIn: false });
      const snapshotId = (added.body as { settingsSnapshotId: number }).settingsSnapshotId;
      expect(snapshotId).not.toBe(snapshotBefore.id);
      const row = await t.prisma.settingsSnapshot.findUniqueOrThrow({ where: { id: snapshotId } });
      expect(
        (row.content as { safety: { childKeywords: string[] } }).safety.childKeywords,
      ).toContain('유아');
      const file = readFileSync(join(DATA_DIR, 'settings', 'settings.json'), 'utf8');
      expect(file).toContain('"유아"');

      const after = (await http().get('/api/v1/child-keyword-terms')).body as {
        items: { term: string; builtIn: boolean }[];
      };
      expect(after.items.at(-1)).toEqual({ term: '유아', builtIn: false });

      const dup = await post('/child-keyword-terms', { term: '유아' }).expect(409);
      expect(dup.body).toMatchObject({
        code: 'CHILD_TERM_ALREADY_EXISTS',
        message: '이미 있는 아동 단어입니다.',
      });
      await post('/child-keyword-terms', { term: 'ｷｯｽﾞ' }).expect(409);
      await post('/child-keyword-terms', { term: '   ' }).expect(422);
      await post('/child-keyword-terms', { term: '가'.repeat(101) }).expect(422);
      const del = await http()
        .delete(`/api/v1/child-keyword-terms/${encodeURIComponent('유아')}`)
        .set(CLIENT)
        .expect(404);
      expect((del.body as ErrorBody).code).toBe('ROUTE_NOT_FOUND');

      // 이미 수집한 묶음에는 다시 적용하지 않는다. 새 붙여넣기부터 뺀다
      const old = await t.prisma.keyword.findFirstOrThrow({
        where: { keywordSnapshotId: beforeId, rank: 1 },
      });
      expect(old.excludedReason).toBeNull();
      const next = (await paste('1 유아 샌들').expect(201)).body as SnapshotBody;
      expect(next.excludedCount).toBe(1);

      const audit = await t.prisma.userActionLog.findMany({
        where: { eventType: 'SETTING_CHANGED' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.detail).toMatchObject({ setting: 'CHILD_KEYWORD_TERMS', term: '유아' });
      expect(events.some((e) => e.name === 'settings.reloaded')).toBe(true);
    });
  });

  describe('로컬 보안·재시작', () => {
    it('X-AutoStore-Client 없는 POST → 403 CLIENT_HEADER_REQUIRED', async () => {
      const res = await http()
        .post('/api/v1/keyword-snapshots')
        .send({ method: 'BUTTON' })
        .expect(403);
      expect((res.body as ErrorBody).code).toBe('CLIENT_HEADER_REQUIRED');
      await http().put('/api/v1/keywords/1/selection').expect(403);
      await http().post('/api/v1/child-keyword-terms').send({ term: '유아' }).expect(403);
      expect(server.calls).toHaveLength(0);
    });

    it('재시작 정리: RUNNING으로 남은 묶음 → ABORTED·APP_RESTART(구조 변경 의심 아님), 수집 상태가 풀린다', async () => {
      const left = await t.prisma.keywordSnapshot.create({
        data: {
          method: 'BUTTON',
          collectedAt: new Date(NOW),
          requestedCids: ['50000173', '50000174'],
          periodStart: new Date('2026-08-23T00:00:00Z'),
          periodEnd: new Date('2026-09-23T00:00:00Z'),
          rankLimit: 100,
          status: 'RUNNING',
        },
      });
      expect(((await status()).body as { collecting: boolean }).collecting).toBe(true);
      await button().expect(409);
      expect(await t.app.get(KeywordCollectionRecovery).recover()).toBe(1);
      const got = (await getSnapshot(left.id).expect(200)).body as SnapshotBody;
      expect(got).toMatchObject({
        status: 'ABORTED',
        abortReason: 'APP_RESTART',
        httpStatus: null,
        structureChangeSuspected: false,
      });
      expect((await status()).body).toMatchObject({
        collecting: false,
        lastAbortReason: 'APP_RESTART',
        disabledReasonCode: null,
      });
    });
  });

  describe('한글 키워드 → 일본어 검색어(AI, F-BS-70)', () => {
    const convert = (id: number | string) =>
      http().post(`/api/v1/keywords/${id}/rakuten-query-conversions`).set(CLIENT);
    async function keywordRows(): Promise<KeywordBody[]> {
      const snap = (await paste(datalabPasteFixture('with-child-terms.txt')).expect(201))
        .body as SnapshotBody;
      const all = (await listKeywords(snap.id)).body as PageBody<KeywordBody>;
      const excluded = (await listKeywords(snap.id, '?excluded=true'))
        .body as PageBody<KeywordBody>;
      return [...all.content, ...excluded.content];
    }
    const callLogs = () => t.prisma.callLog.findMany({ where: { target: 'AI_CLAUDE_CLI' } });

    beforeEach(async () => {
      await seedUsableAiEngine(t.prisma, 'CLAUDE');
      t.ai.resetCalls();
      t.ai.claude.runImpl = () => ({ query_ja: 'ニューバランス 530' });
    });

    it('200: 고른 키워드 1개만 선택 엔진(CLAUDE)에 보내 바꾼 검색어를 받는다. 저장하지 않고 call_log AI 1행', async () => {
      const target = (await keywordRows()).find((k) => k.keyword === '뉴발란스 530')!;
      const res = await convert(target.id).expect(200);
      expect(res.body).toEqual({
        keywordId: target.id,
        keyword: '뉴발란스 530',
        rakutenQuery: 'ニューバランス 530',
        engineCode: 'CLAUDE',
        model: 'sonnet',
      });
      const calls = t.ai.claude.calls.runStructured;
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ task: 'KW-06' });
      expect(calls[0]!.promptIncludes('뉴발란스 530')).toBe(true);
      expect(await callLogs()).toHaveLength(1);
      // 저장하지 않는다: 키워드·고르기 기록 그대로
      const after = await t.prisma.keyword.findUniqueOrThrow({ where: { id: target.id } });
      expect(after.selectedAt).toBeNull();
    });

    it('가드 헤더가 없으면 403, 없는 id·글자 id는 404, 아동화로 빠진 키워드는 409 KEYWORD_EXCLUDED(AI 호출 없음)', async () => {
      const rows = await keywordRows();
      await http().post(`/api/v1/keywords/${rows[0]!.id}/rakuten-query-conversions`).expect(403);
      expect((await convert(99999).expect(404)).body).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
      await convert('abc').expect(404);
      const child = rows.find((k) => k.excludedReason === 'CHILD')!;
      expect((await convert(child.id).expect(409)).body).toMatchObject({
        code: 'KEYWORD_EXCLUDED',
      });
      expect(t.ai.totalRuns()).toBe(0);
    });

    it('선택 엔진을 쓸 수 없으면 409 AI_ENGINE_UNAVAILABLE(NOT_CHECKED), AI를 부르지 않는다', async () => {
      const target = (await keywordRows())[0]!;
      await t.prisma.$executeRawUnsafe('TRUNCATE TABLE ai_cli_check RESTART IDENTITY');
      const res = await convert(target.id).expect(409);
      expect(res.body).toMatchObject({
        code: 'AI_ENGINE_UNAVAILABLE',
        details: { engineCode: 'CLAUDE', reason: 'NOT_CHECKED' },
      });
      expect(t.ai.totalRuns()).toBe(0);
    });

    it('결과에 한글이 남으면 502 AI_CALL_FAILED(AI_OUTPUT_INVALID)', async () => {
      const target = (await keywordRows())[0]!;
      t.ai.claude.runImpl = () => ({ query_ja: 'ローファー 레이디스' });
      const res = await convert(target.id).expect(502);
      expect(res.body).toMatchObject({
        code: 'AI_CALL_FAILED',
        details: { errorCode: 'AI_OUTPUT_INVALID' },
      });
    });
  });
});
