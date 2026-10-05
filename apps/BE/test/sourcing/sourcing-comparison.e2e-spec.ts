import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { SECRET_STORE } from '../../src/common/secrets/secret-store.port.js';
import { toKstDateValue } from '../../src/common/time/kst.js';
import { AnchorService } from '../../src/modules/sourcing/anchor.service.js';
import { StockCheckService } from '../../src/modules/sourcing/stock-check.service.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { FakeGateBasisModule, recordGatePass } from '../fixtures/step-engine/gate-basis.fakes.js';
import { createTestApp, type TestApp, truncate } from '../helpers/test-app.js';
import { FAKE_AI_MATCH, useFakeAiMatch } from '../support/fake-ai-engine.adapter.js';
import { seedUsableAiEngine } from '../support/fake-ai-engines.js';
import { FakePricingRunnerModule } from '../support/fake-pricing-runner.js';
import { InMemorySecretStore } from '../support/in-memory-secret-store.js';
import {
  PAGE_URLS,
  RakutenFixtureServer,
  type RakutenPageFixture,
  rakutenSearchFixture,
} from '../support/rakuten-fixture.adapters.js';

/**
 * ② 소싱 비교표 e2e(P2-03 §6, autostore_test). 가짜 라쿠텐(가짜 fetch 뒤 — 실제 어댑터·외부 호출 관문을 지난다)과 가짜 AI
 * 어댑터(F-BS-38 고정 결과), 가짜 ③ 실행기·G2 공급자를 쓴다. 실제 라쿠텐·AI CLI는 부르지 않는다.
 * 검색 fixture: anchor-match12-p1(MATCH 12 + NEEDS_REVIEW 1 + NO_MATCH 16 + 아동 1) → 둘째 답 anchor-match12-p2(MATCH 2)는
 * 검색 결과 더 보기(관련도 page 2) 또는 앵커 뒤 같은 상품 검색(모델 번호 가격순 page 1 — D-47)이 받는다.
 * 페이지 조회 순서(앵커 샵 A 먼저): 샵 A ✓ → 재고 2/9 ✗ → JAN 불일치 ✗ → 폭 2E ✓ → hidden ✓ = K=3 → ENOUGH_CANDIDATES.
 */
const CLIENT = { 'X-AutoStore-Client': '1' };
const TABLES = [
  'sourcing_comparison_row',
  'sourcing_comparison',
  'rakuten_sku',
  'rakuten_item',
  'rakuten_search_cache',
  'rakuten_genre',
  'call_log',
  'user_action_log',
  'gate_pass',
  'step_run_input',
  'step_run',
  'step_chain',
  'candidate_step',
  'candidate_status_history',
  'candidate',
];
const KEYS = {
  RAKUTEN_APPLICATION_ID: 'e2e-fixture-app-id-0001',
  RAKUTEN_ACCESS_KEY: 'e2e-fixture-access-key-0001',
} as const;
const QUERY = 'アシックス ゲルカヤノ14 1201A019';
const CREAM = 'クリーム×ブラック(108)';
const SHOP_A = 'shop-a:10000123';
const SHOP_B = 'shop-b:20000456';
const DAY = 86_400_000;

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string }[];
}
interface RowBody {
  id: number;
  itemCode: string;
  rowSource: string;
  searchRank: number | null;
  imageUrl: string | null;
  anchorMatch: string | null;
  isVerified: boolean;
  inStockSizeCount: number | null;
  stockPass: boolean | null;
  effectivePriceYen: number | null;
  pointsTotalPt: number | null;
  couponYen: number;
  aiMatch: unknown;
  janMatch: boolean | null;
  isSelected: boolean;
  [key: string]: unknown;
}
interface DetailBody {
  id: number;
  stepRunId: number;
  stepStatus: string;
  exploreMode: boolean;
  creditText: string;
  baseSourcingComparisonId: number | null;
  detectedGender: string | null;
  rows: RowBody[];
  [key: string]: unknown;
}

describe('② 소싱 비교표 API(e2e, 가짜 라쿠텐·AI, P2-03)', () => {
  let t: TestApp;
  let server: RakutenFixtureServer;
  const secrets = new InMemorySecretStore({ initial: { ...KEYS } });
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body?: object) =>
    http().post(`/api/v1${path}`).set(CLIENT).send(body);
  const put = (path: string, body?: object) => http().put(`/api/v1${path}`).set(CLIENT).send(body);
  const patch = (path: string, body?: object) =>
    http().patch(`/api/v1${path}`).set(CLIENT).send(body);
  const errorOf = (res: request.Response) => res.body as ErrorBody;

  /** ② 실행·앵커 뒤 작업·재고 확인이 모두 끝날 때까지 */
  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i += 1) {
      await t.app.get(StepExecutor).whenIdle();
      await t.app.get(AnchorService).whenIdle();
      await t.app.get(StockCheckService).whenIdle();
    }
  }

  async function searchCandidate(): Promise<number> {
    const res = await post('/candidates', { creationPath: 'SEARCH_QUERY', rakutenQuery: QUERY });
    expect(res.status).toBe(201);
    return (res.body as { id: number }).id;
  }

  /** 검색 후보 + ② 실행(검색 1페이지 = anchor-match12-p1) → 앵커 입력 대기 */
  async function sourcedCandidate(): Promise<{ candidateId: number; head: DetailBody }> {
    const candidateId = await searchCandidate();
    server.answerSearch(
      { status: 200, file: 'anchor-match12-p1.json' },
      { status: 200, file: 'anchor-match12-p2.json' },
    );
    await post(`/candidates/${candidateId}/steps/SOURCING/runs`).expect(202);
    await settle();
    return { candidateId, head: await comparison(candidateId) };
  }

  async function comparison(candidateId: number, query = ''): Promise<DetailBody> {
    const res = await http().get(`/api/v1/candidates/${candidateId}/sourcing-comparison${query}`);
    expect(res.status).toBe(200);
    return res.body as DetailBody;
  }

  /** 샵 A를 앵커로(SEARCH_PICK) 정하고 뒤 작업까지 */
  async function anchoredCandidate() {
    const { candidateId, head } = await sourcedCandidate();
    await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: SHOP_A,
      anchorColorLabel: CREAM,
    }).expect(202);
    await settle();
    return { candidateId, head: await comparison(candidateId, '?includeNoMatch=true') };
  }

  const rowOf = (head: DetailBody, itemCode: string) =>
    head.rows.find((r) => r.itemCode === itemCode)!;

  async function stockCheck(rowId: number): Promise<void> {
    await post(`/sourcing-comparison-rows/${rowId}/stock-checks`).expect(202);
    await settle();
  }

  async function fetchItem(name: RakutenPageFixture): Promise<number> {
    const res = await post('/rakuten-items', { sourceUrl: PAGE_URLS[name] });
    expect(res.status).toBe(201);
    return (res.body as { rakutenItem: { id: number } }).rakutenItem.id;
  }

  const candidateRow = (id: number) => t.prisma.candidate.findUniqueOrThrow({ where: { id } });

  /** 오늘(KST) RAKUTEN_PAGE 호출 기록 n행(하루 상한 110을 채운다) */
  async function insertPageLogs(n: number): Promise<void> {
    const calledAt = t.clock.now();
    await t.prisma.callLog.createMany({
      data: Array.from({ length: n }, () => ({
        calledAt,
        kstDate: toKstDateValue(calledAt),
        target: 'RAKUTEN_PAGE',
        httpMethod: 'GET',
        host: 'item.rakuten.co.jp',
        urlMasked: PAGE_URLS['shop-a'],
        httpStatus: 200,
        succeeded: true,
        durationMs: 10,
      })),
    });
  }

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FakePricingRunnerModule, FakeGateBasisModule],
      overrides: [{ provide: SECRET_STORE, useValue: secrets }],
      beforeInit: (prisma) => truncate(prisma, TABLES),
    });
    server = new RakutenFixtureServer(t.clock);
    useFakeAiMatch(t.ai);
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  afterAll(async () => {
    unsubscribe();
    await settle();
    await t.app.close();
  });

  beforeEach(async () => {
    await settle();
    await truncate(t.prisma, TABLES);
    await seedUsableAiEngine(t.prisma);
    server.reset();
    t.fetch.reset();
    t.fetch.handler = server.fetchHandler;
    t.ai.resetCalls();
    secrets.reset();
    await secrets.set('RAKUTEN_APPLICATION_ID', KEYS.RAKUTEN_APPLICATION_ID);
    await secrets.set('RAKUTEN_ACCESS_KEY', KEYS.RAKUTEN_ACCESS_KEY);
    events.length = 0;
    t.clock.advance(DAY);
  });

  // ── 조회·탐색 모드 ────────────────────────────────────────────────────────

  it('② 실행 뒤 GET: 200 exploreMode, anchorMatch 모두 null, creditText. ② 미실행 404, sort=shopName 422', async () => {
    const { candidateId, head } = await sourcedCandidate();
    expect(head.exploreMode).toBe(true);
    expect(head.creditText).toBe('Supported by Rakuten Developers');
    expect(head.rows).toHaveLength(29);
    expect(head.rows.every((r) => r.anchorMatch === null && !r.isVerified)).toBe(true);
    // 행마다 사진 주소(D-47): Item Search mediumImageUrls의 첫 값
    expect(
      head.rows.every((r) => r.imageUrl?.startsWith('https://thumbnail.image.rakuten.co.jp/')),
    ).toBe(true);
    expect(rowOf(head, SHOP_A).imageUrl).toBe(
      'https://thumbnail.image.rakuten.co.jp/@0_mall/shop-a/cabinet/shop-a_1.jpg?_ex=128x128',
    );
    expect(head.params).toMatchObject({
      kRank: 0.5,
      spuMultiplier: 0,
      pointRounding: 'PER_PROGRAM',
    });

    const fresh = await searchCandidate();
    const none = await http().get(`/api/v1/candidates/${fresh}/sourcing-comparison`);
    expect(none.status).toBe(404);
    expect(errorOf(none).code).toBe('STEP_OUTPUT_NOT_FOUND');
    const sort = await http().get(
      `/api/v1/candidates/${candidateId}/sourcing-comparison?sort=shopName,asc`,
    );
    expect(sort.status).toBe(422);
    expect(errorOf(sort).code).toBe('INVALID_QUERY_PARAMETER');
  });

  it('GET 정렬·버전: sort=searchRank·fetchOrder, ?stepRunId= 앞 버전, 다른 후보의 stepRunId는 422', async () => {
    const { candidateId, head } = await anchoredCandidate();
    // 어느 정렬이든 미검증 행은 뒤(검증 행 안·미검증 행 안에서 각각 정렬)
    const byRank = await comparison(candidateId, '?includeNoMatch=true&sort=searchRank,asc');
    // 검색 순위가 없는 행(앵커 뒤 같은 상품 검색으로 더한 행·수동 행)은 가장 뒤
    const sorted = (xs: (number | null)[]) =>
      [...xs].sort((a, b) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b));
    const ranksOf = (verified: boolean) =>
      byRank.rows.filter((r) => r.isVerified === verified).map((r) => r.searchRank);
    expect(byRank.rows.some((r) => r.searchRank === null)).toBe(true);
    expect(ranksOf(true)).toEqual(sorted(ranksOf(true)));
    expect(ranksOf(false)).toEqual(sorted(ranksOf(false)));
    expect(byRank.rows.findIndex((r) => !r.isVerified)).toBe(ranksOf(true).length);
    const desc = await comparison(candidateId, '?includeNoMatch=true&sort=searchRank,desc');
    expect(desc.rows[0]!.searchRank).toBe(Math.max(...ranksOf(true).map((r) => r ?? 0)));
    const byFetch = await comparison(candidateId, '?sort=fetchOrder,asc');
    const fetched = byFetch.rows.filter((r) => r.isVerified).map((r) => r.fetchOrder as number);
    expect(fetched).toEqual([1, 2, 3, 4, 5]);
    expect(byFetch.rows[0]!.itemCode).toBe(SHOP_A);
    const pinned = await comparison(candidateId, `?stepRunId=${head.stepRunId}`);
    expect(pinned).toMatchObject({ id: head.id, isCurrent: true });

    const { head: other } = await sourcedCandidate();
    const foreign = await http().get(
      `/api/v1/candidates/${candidateId}/sourcing-comparison?stepRunId=${other.stepRunId}`,
    );
    expect(foreign.status).toBe(422);
    expect(errorOf(foreign)).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
      fieldErrors: [{ field: 'stepRunId' }],
    });
  });

  it('AI 엔진을 쓸 수 없으면 ② 시작이 409 AI_ENGINE_UNAVAILABLE(SOURCING은 AI 단계)', async () => {
    const candidateId = await searchCandidate();
    await t.prisma.$executeRawUnsafe('TRUNCATE TABLE ai_cli_check RESTART IDENTITY');
    const res = await post(`/candidates/${candidateId}/steps/SOURCING/runs`);
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('AI_ENGINE_UNAVAILABLE');
    expect(await t.prisma.stepRun.count({ where: { candidateId } })).toBe(0);
  });

  // ── 검색 결과 더 보기(D-47) ────────────────────────────────────────────────

  it('POST search-more: 관련도 순 다음 페이지를 받아 새 행만 더한다(검색 순위 이어붙임·분류 없음·페이지 조회 없음), 거듭하면 page 3', async () => {
    const { candidateId, head } = await sourcedCandidate();
    expect(head.rows).toHaveLength(29);
    const res = await post(`/sourcing-comparisons/${head.id}/search-more`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ addedRowCount: 30, hasMore: true });
    const calls = server.callsOf('SEARCH');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.params).toMatchObject({
      keyword: QUERY,
      page: '2',
      sort: 'standard',
      hits: '30',
      genreId: '558885',
      imageFlag: '1',
    });
    const after = await comparison(candidateId);
    expect(after.exploreMode).toBe(true);
    expect(after.rows).toHaveLength(59);
    const added = after.rows.filter((r) => (r.searchRank ?? 0) > 30);
    expect(added).toHaveLength(30);
    // 검색 순위 = (page − 1) × hits + 그 페이지 안 순번(첫 검색 page 1 뒤로 이어 붙는다)
    expect(added.map((r) => r.searchRank).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 30 }, (_, i) => 31 + i),
    );
    expect(rowOf(after, 'shop-d:40005')).toMatchObject({ searchRank: 35, rowSource: 'API' });
    // 탐색 모드라 분류·재고·AI·페이지 조회는 하지 않는다
    expect(added.every((r) => r.anchorMatch === null && !r.isVerified && r.aiMatch === null)).toBe(
      true,
    );
    expect(added.every((r) => r.imageUrl?.startsWith('https://'))).toBe(true);
    expect(server.callsOf('PAGE')).toHaveLength(0);

    // 거듭하면 page 3(순위 최댓값 60 → ceil(60/30)+1). 빈 페이지면 0건·hasMore=false
    server.answerSearch({
      status: 200,
      body: JSON.stringify({ count: 60, page: 3, hits: 30, Items: [] }),
    });
    const third = await post(`/sourcing-comparisons/${head.id}/search-more`);
    expect(third.status).toBe(200);
    expect(third.body).toEqual({ addedRowCount: 0, hasMore: false });
    expect(server.callsOf('SEARCH')[2]!.params.page).toBe('3');
    // 같은 페이지를 되풀이해도 6시간 캐시라 다시 부르지 않는다
    expect((await post(`/sourcing-comparisons/${head.id}/search-more`)).body).toEqual({
      addedRowCount: 0,
      hasMore: false,
    });
    expect(server.callsOf('SEARCH')).toHaveLength(3);
  });

  it('POST search-more: 받은 행이 모두 이미 있는 상품이면 0건·hasMore=false(같은 페이지를 되풀이 요청하지 않게)', async () => {
    const candidateId = await searchCandidate();
    server.answerSearch(
      { status: 200, file: 'anchor-match12-p1.json' },
      { status: 200, file: 'anchor-match12-p1.json' },
    );
    await post(`/candidates/${candidateId}/steps/SOURCING/runs`).expect(202);
    await settle();
    const head = await comparison(candidateId);
    const res = await post(`/sourcing-comparisons/${head.id}/search-more`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ addedRowCount: 0, hasMore: false });
    expect((await comparison(candidateId)).rows).toHaveLength(29);
  });

  it('POST search-more: 받은 페이지가 hits건보다 적으면 hasMore=false', async () => {
    const { head } = await sourcedCandidate();
    const body = JSON.parse(rakutenSearchFixture('anchor-match12-p2.json')) as {
      Items: unknown[];
    };
    body.Items = body.Items.slice(0, 7);
    server.reset();
    server.answerSearch({ status: 200, body: JSON.stringify(body) });
    const res = await post(`/sourcing-comparisons/${head.id}/search-more`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ addedRowCount: 7, hasMore: false });
  });

  it('POST search-more 막힘: 없는 비교표 404 · 기준 상품을 정한 뒤 409 ANCHOR_ALREADY_FIXED(검색 안 함) · 완료된 버전 409 STEP_RUN_NOT_WAITING_INPUT · 검색어 없음 422', async () => {
    const noHead = await post('/sourcing-comparisons/99999/search-more');
    expect(noHead.status).toBe(404);
    expect(errorOf(noHead).code).toBe('SOURCING_COMPARISON_NOT_FOUND');
    expect((await post('/sourcing-comparisons/abc/search-more')).status).toBe(404);

    const { head: anchored } = await anchoredCandidate();
    const searches = server.callsOf('SEARCH').length;
    const fixed = await post(`/sourcing-comparisons/${anchored.id}/search-more`);
    expect(fixed.status).toBe(409);
    expect(errorOf(fixed)).toMatchObject({
      code: 'ANCHOR_ALREADY_FIXED',
      message:
        '기준 상품을 이미 정했습니다. 상품을 더 찾으려면 ② 다시 실행으로 새로 검색해 주세요.',
    });
    expect(server.callsOf('SEARCH')).toHaveLength(searches);
    // 클라이언트 표시 없는 요청은 403(로컬 보안 검사)
    expect(
      (await http().post(`/api/v1/sourcing-comparisons/${anchored.id}/search-more`)).status,
    ).toBe(403);

    await put(`/sourcing-comparisons/${anchored.id}/selection`, {
      rowId: rowOf(anchored, SHOP_A).id,
    }).expect(200);
    const done = await post(`/sourcing-comparisons/${anchored.id}/search-more`);
    expect(done.status).toBe(409);
    expect(errorOf(done).code).toBe('STEP_RUN_NOT_WAITING_INPUT');

    // 검색어가 비었거나(공백뿐) 형식에 맞지 않으면(단어가 너무 짧음) 422. 검색은 하지 않는다
    const { head } = await sourcedCandidate();
    const searchesBefore = server.callsOf('SEARCH').length;
    for (const searchKeyword of ['  ', 'あ']) {
      await t.prisma.sourcingComparison.update({ where: { id: head.id }, data: { searchKeyword } });
      const invalid = await post(`/sourcing-comparisons/${head.id}/search-more`);
      expect(invalid.status).toBe(422);
      expect(errorOf(invalid)).toMatchObject({
        code: 'RAKUTEN_QUERY_INVALID',
        fieldErrors: [{ field: 'searchKeyword' }],
      });
    }
    expect(server.callsOf('SEARCH')).toHaveLength(searchesBefore);
  });

  it('POST search-more: 여정이 제외된 뒤 409 CANDIDATE_EXCLUDED, 라쿠텐 오류는 502 EXTERNAL_API_ERROR(키 값 없음)', async () => {
    const { candidateId, head } = await sourcedCandidate();
    server.reset();
    server.answerSearch({ status: 403, file: 'err-403-invalid-access-key.json' });
    const failed = await post(`/sourcing-comparisons/${head.id}/search-more`);
    expect(failed.status).toBe(502);
    expect(errorOf(failed)).toMatchObject({
      code: 'EXTERNAL_API_ERROR',
      details: { target: 'RAKUTEN_API', reason: 'RAKUTEN_INVALID_ACCESS_KEY' },
    });
    expect(JSON.stringify(failed.body)).not.toContain(KEYS.RAKUTEN_ACCESS_KEY);
    expect((await comparison(candidateId)).rows).toHaveLength(29);

    await t.prisma.candidate.update({
      where: { id: candidateId },
      data: { status: 'EXCLUDED', excludedReason: 'ANCHOR_NO_MATCH' },
    });
    const excluded = await post(`/sourcing-comparisons/${head.id}/search-more`);
    expect(excluded.status).toBe(409);
    expect(errorOf(excluded).code).toBe('CANDIDATE_EXCLUDED');
  });

  // ── 앵커 ──────────────────────────────────────────────────────────────────

  it('앵커 상품에 모델 번호가 없으면 같은 상품 검색을 하지 않는다(새 검색 없음 — 키워드 page 2도 없다)', async () => {
    const candidateId = await searchCandidate();
    const body = JSON.parse(rakutenSearchFixture('anchor-match12-p1.json')) as {
      Items: { itemCode: string; itemName: string }[];
    };
    body.Items = body.Items.slice(0, 30).map((item, i) => ({
      ...item,
      itemName: i === 0 ? 'アシックス ゲルカヤノ クリーム メンズ' : item.itemName,
    }));
    server.answerSearch({ status: 200, body: JSON.stringify(body) });
    await post(`/candidates/${candidateId}/steps/SOURCING/runs`).expect(202);
    await settle();
    const head = await comparison(candidateId);
    const first = head.rows.find((r) => r.itemName === 'アシックス ゲルカヤノ クリーム メンズ')!;
    await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: first.itemCode,
      anchorColorCode: '108',
    }).expect(202);
    await settle();
    expect(await comparison(candidateId)).toMatchObject({
      anchorInputMethod: 'SEARCH_PICK',
      anchorModelCode: null,
    });
    expect(server.callsOf('SEARCH')).toHaveLength(1);
  });

  it('PUT anchor(SEARCH_PICK): 202 → 분류·같은 상품 검색(모델 번호 가격순 page 1·2)·K=3에서 멈춤(ENOUGH_CANDIDATES)·재고·실질가·AI 보조', async () => {
    const { candidateId, head } = await sourcedCandidate();
    const res = await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: SHOP_A,
      anchorColorLabel: CREAM,
    });
    expect(res.status).toBe(202);
    expect(res.headers.location).toBe(`/api/v1/candidates/${candidateId}/sourcing-comparison`);
    expect(res.body).toEqual({
      candidateId,
      sourcingComparisonId: head.id,
      stepRunId: head.stepRunId,
      stepStatus: 'WAITING_INPUT',
      rowId: null,
    });
    await settle();
    const after = await comparison(candidateId, '?includeNoMatch=true');
    expect(after).toMatchObject({
      exploreMode: false,
      anchorInputMethod: 'SEARCH_PICK',
      anchorModelCodeNorm: '1201A019',
      anchorColorCode: '108',
      detectedGender: 'MALE',
      genderBasis: 'ITEM_NAME',
    });
    const count = (m: string) => after.rows.filter((r) => r.anchorMatch === m).length;
    expect(count('MATCH')).toBe(14);
    expect(count('NEEDS_REVIEW')).toBe(1);
    // 검색은 세 번(D-47): ② 첫 검색(관련도 순) → 기준 상품의 모델 번호로 같은 상품 검색 page 1 → 일치 14 < 20이고 1페이지가
    // 가득(30건)이라 page 2(둘 다 가격순). 같은 상품 검색 행은 검색 순위가 없고, item_code가 겹친 행은 기존 행이 남는다
    expect(
      server
        .callsOf('SEARCH')
        .map((c) => ({ q: c.params.keyword, p: c.params.page, s: c.params.sort })),
    ).toEqual([
      { q: QUERY, p: '1', s: 'standard' },
      { q: '1201A019', p: '1', s: '+itemPrice' },
      { q: '1201A019', p: '2', s: '+itemPrice' },
    ]);
    const unranked = after.rows.filter((r) => r.searchRank === null);
    expect(unranked).toHaveLength(30);
    expect(unranked.every((r) => r.rowSource === 'API')).toBe(true);
    expect(rowOf(after, 'shop-d:40005')).toMatchObject({ searchRank: null, anchorMatch: 'MATCH' });
    expect(after.rows.filter((r) => r.searchRank !== null)).toHaveLength(29);
    const finished = events.filter((e) => e.name === 'sourcing.page-fetch-finished');
    expect(finished.map((e) => e.data)).toEqual([
      {
        sourcingComparisonId: head.id,
        fetchedCount: 5,
        passedCount: 3,
        stopReason: 'ENOUGH_CANDIDATES',
      },
    ]);
    expect(finished[0]!.candidateId).toBe(candidateId);
    // 샵 A: 5/9 · ¥12,000 · 송료 0 · 1,090pt · 실질가 11,455, 페이지를 먼저 읽는다(앵커 상품)
    expect(rowOf(after, SHOP_A)).toMatchObject({
      isVerified: true,
      fetchOrder: 1,
      inStockSizeCount: 5,
      stockPass: true,
      representativePriceYen: 12_000,
      shippingYen: 0,
      shippingSource: 'FREE',
      pointsTotalPt: 1_090,
      effectivePriceYen: 11_455,
      janMatch: true,
      makerModelMatch: true,
    });
    expect(rowOf(after, 'shop-l:20101')).toMatchObject({ isVerified: true, stockPass: false });
    expect(rowOf(after, 'shop-j:20102')).toMatchObject({ stockPass: true, janMatch: false });
    expect(rowOf(after, SHOP_B)).toMatchObject({ isVerified: false, effectivePriceYen: null });
    // 검증·재고 통과 행이 실질가 순으로 앞, 재고 부족 검증 행은 그 뒤(실질가가 낮아도), 미검증은 맨 뒤
    const verified = after.rows.filter((r) => r.isVerified);
    const passed = verified.filter((r) => r.stockPass === true);
    expect(verified.slice(0, passed.length).map((r) => r.effectivePriceYen)).toEqual(
      [...passed.map((r) => r.effectivePriceYen)].sort((a, b) => (a ?? 1e9) - (b ?? 1e9)),
    );
    expect(verified.at(-1)?.itemCode).toBe('shop-l:20101');
    expect(after.rows.findIndex((r) => !r.isVerified)).toBe(verified.length);
    // NEEDS_REVIEW 행: 가짜 AI 결과가 aiMatch에, anchorMatch는 그대로
    expect(rowOf(after, 'shop-c:30003')).toMatchObject({
      anchorMatch: 'NEEDS_REVIEW',
      aiMatch: { ...FAKE_AI_MATCH },
    });
    // 페이지 조회는 fetch_reason=SOURCING, 행마다 SSE sourcing.row-updated
    expect(
      await t.prisma.rakutenItem.count({ where: { fetchReason: 'SOURCING', entrySource: 'API' } }),
    ).toBe(5);
    expect(events.filter((e) => e.name === 'sourcing.row-updated').length).toBeGreaterThanOrEqual(
      5,
    );
    // includeNoMatch=false(기본)면 NO_MATCH 행을 뺀다
    const filtered = await comparison(candidateId);
    expect(filtered.rows.some((r) => r.anchorMatch === 'NO_MATCH')).toBe(false);

    // 같은 앵커를 다시 → 같은 202(작업을 다시 돌리지 않는다), 다른 앵커 → 409, 필수값 누락 → 422
    const again = await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: SHOP_A,
    });
    expect(again.status).toBe(202);
    expect(again.body).toEqual(res.body);
    await settle();
    expect(server.callsOf('PAGE')).toHaveLength(5);
    const other = await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '1201A019',
      anchorColorCode: '020',
    });
    expect(other.status).toBe(409);
    expect(errorOf(other).code).toBe('ANCHOR_KEY_MISMATCH');
    const missing = await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
    });
    expect(missing.status).toBe(422);
    expect(errorOf(missing).fieldErrors?.[0]?.field).toBe('anchorItemCode');
    const notRow = await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: 'shop-zz:1',
    });
    expect(notRow.status).toBe(422);
    const noHead = await put('/sourcing-comparisons/99999/anchor', {
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '1201A019',
    });
    expect(noHead.status).toBe(404);
  });

  it('MATCH ≥ 20이면 같은 상품 검색 page 2를 부르지 않는다(page 1은 한다)', async () => {
    const candidateId = await searchCandidate();
    server.answerSearch({ status: 200, file: 'anchor-match20-p1.json' });
    await post(`/candidates/${candidateId}/steps/SOURCING/runs`).expect(202);
    await settle();
    const head = await comparison(candidateId);
    await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '1201a019',
      anchorColorCode: '108',
    }).expect(202);
    await settle();
    // ② 첫 검색 + 같은 상품 검색 page 1뿐(일치가 이미 20개 이상이라 page 2 없음)
    expect(server.callsOf('SEARCH').map((c) => `${c.params.keyword}|${c.params.page}`)).toEqual([
      `${QUERY}|1`,
      '1201a019|1',
    ]);
    const after = await comparison(candidateId);
    expect(after.rows.filter((r) => r.anchorMatch === 'MATCH').length).toBeGreaterThanOrEqual(22);
  });

  it('후보 앵커가 확정된 뒤 새 ② 버전에 다른 型番·색상을 PUT anchor → 409 ANCHOR_KEY_MISMATCH(후보 앵커 키), 같은 키는 202', async () => {
    const { candidateId, head } = await anchoredCandidate();
    await put(`/sourcing-comparisons/${head.id}/selection`, {
      rowId: rowOf(head, SHOP_A).id,
    }).expect(200);
    expect(await candidateRow(candidateId)).toMatchObject({
      anchorModelCode: '1201A019',
      anchorItemCode: null,
      anchorColorCode: '108',
    });
    server.answerSearch(
      { status: 200, file: 'anchor-match12-p1.json' },
      { status: 200, file: 'anchor-match12-p2.json' },
    );
    await post(`/candidates/${candidateId}/steps/SOURCING/runs`).expect(202);
    await settle();
    const v2 = await comparison(candidateId);
    expect(v2.id).not.toBe(head.id);
    expect(v2).toMatchObject({ stepStatus: 'WAITING_INPUT', anchorInputMethod: 'SEARCH_PICK' });
    // 후보에 확정된 앵커 키와 다름 → 409, details는 후보 앵커 키(itemCode 없음 — 버전 앵커 분기라면 샵 A itemCode)
    for (const body of [
      { anchorInputMethod: 'CODE_ENTRY', anchorModelCode: '1201A019', anchorColorCode: '020' },
      { anchorInputMethod: 'CODE_ENTRY', anchorModelCode: '1201A020', anchorColorCode: '108' },
    ]) {
      const res = await put(`/sourcing-comparisons/${v2.id}/anchor`, body);
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'ANCHOR_KEY_MISMATCH',
        details: { anchorModelCode: '1201A019', anchorItemCode: null, anchorColorCode: '108' },
      });
    }
    // 색상 코드를 비우면 후보 색상 코드로 채운다 → 같은 키이고 이 버전 앵커와도 같아 202(작업을 다시 돌리지 않는다)
    const pages = server.callsOf('PAGE').length;
    const same = await put(`/sourcing-comparisons/${v2.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: SHOP_A,
    });
    expect(same.status).toBe(202);
    expect(same.body).toMatchObject({ sourcingComparisonId: v2.id, stepRunId: v2.stepRunId });
    await settle();
    expect(server.callsOf('PAGE')).toHaveLength(pages);
  });

  // ── 행 수정 ────────────────────────────────────────────────────────────────

  it('PATCH 행: {couponYen:500} → 200 실질가·rankedRowIds 재계산, {} · 음수 · M2 칸 → 422, 없는 행 404', async () => {
    const { head } = await anchoredCandidate();
    const a = rowOf(head, SHOP_A);
    const res = await patch(`/sourcing-comparison-rows/${a.id}`, { couponYen: 500 });
    expect(res.status).toBe(200);
    const body = res.body as { row: RowBody; rankedRowIds: number[] };
    // base = floor(11,500 × 10 / 11) = 10,454 → 1,044pt → 12,000 − 500 − 522 = 10,978
    expect(body.row).toMatchObject({
      couponYen: 500,
      pointsTotalPt: 1_044,
      effectivePriceYen: 10_978,
    });
    const verified = head.rows.filter((r) => r.isVerified).map((r) => r.id);
    expect([...body.rankedRowIds].sort()).toEqual([...verified].sort());
    expect(body.rankedRowIds[0]).toBe(a.id);
    const multiplier = await patch(`/sourcing-comparison-rows/${a.id}`, {
      shopEventMultiplier: 1.5,
    });
    expect((multiplier.body as { row: RowBody }).row).toMatchObject({ shopEventMultiplier: 1.5 });
    for (const bad of [{}, { couponYen: -1 }, { shippingYen: 0 }, { couponYen: 1.5 }]) {
      const r = await patch(`/sourcing-comparison-rows/${a.id}`, bad);
      expect(r.status).toBe(422);
      expect(errorOf(r).code).toBe('VALIDATION_FAILED');
    }
    expect((await patch('/sourcing-comparison-rows/99999', { couponYen: 1 })).status).toBe(404);
  });

  it('오너 판단: {ownerMatchDecision:NO_MATCH}인 일치 행은 선택 409, null로 지우고, JAN 불일치 행은 MATCH 뒤 선택 200', async () => {
    const { candidateId, head } = await anchoredCandidate();
    const a = rowOf(head, SHOP_A);
    const j = rowOf(head, 'shop-j:20102');
    expect(j).toMatchObject({
      anchorMatch: 'MATCH',
      janMatch: false,
      stockPass: true,
      ownerMatchDecision: null,
    });
    const select = (rowId: number) => put(`/sourcing-comparisons/${head.id}/selection`, { rowId });

    // 규칙 '일치' 행을 오너가 '다른 상품'으로 → 고를 수 없다. 규칙 분류·재대조 값은 그대로
    const no = await patch(`/sourcing-comparison-rows/${a.id}`, { ownerMatchDecision: 'NO_MATCH' });
    expect(no.status).toBe(200);
    expect((no.body as { row: RowBody }).row).toMatchObject({
      ownerMatchDecision: 'NO_MATCH',
      anchorMatch: 'MATCH',
      janMatch: true,
    });
    const blocked = await select(a.id);
    expect(blocked.status).toBe(409);
    expect(errorOf(blocked)).toMatchObject({
      code: 'ANCHOR_KEY_MISMATCH',
      details: { rowId: a.id, ownerMatchDecision: 'NO_MATCH' },
    });
    // null = 판단 지우기(DB도 NULL). 잘못된 값은 422
    const cleared = await patch(`/sourcing-comparison-rows/${a.id}`, { ownerMatchDecision: null });
    expect(cleared.status).toBe(200);
    expect((cleared.body as { row: RowBody }).row.ownerMatchDecision).toBeNull();
    expect(
      (await t.prisma.sourcingComparisonRow.findUniqueOrThrow({ where: { id: a.id } }))
        .ownerMatchDecision,
    ).toBeNull();
    const bad = await patch(`/sourcing-comparison-rows/${a.id}`, { ownerMatchDecision: 'maybe' });
    expect(bad.status).toBe(422);
    expect(errorOf(bad).fieldErrors?.[0]?.field).toBe('ownerMatchDecision');

    // JAN 불일치 '일치' 행: 판단 전 409 → 오너 '같은 상품' 뒤 200(② 완료, 후보 itemCode)
    const before = await select(j.id);
    expect(errorOf(before)).toMatchObject({
      code: 'ANCHOR_KEY_MISMATCH',
      details: { rowId: j.id, janMatch: false, ownerMatchDecision: null },
    });
    await patch(`/sourcing-comparison-rows/${j.id}`, { ownerMatchDecision: 'MATCH' }).expect(200);
    const ok = await select(j.id);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      stepStatus: 'COMPLETED',
      selectedRowId: j.id,
      itemCode: 'shop-j:20102',
    });
    expect(await candidateRow(candidateId)).toMatchObject({
      itemCode: 'shop-j:20102',
      anchorModelCode: '1201A019',
      anchorColorCode: '108',
    });
  });

  // ── 재고 확인 ──────────────────────────────────────────────────────────────

  it('POST stock-checks: 202 → fetch_reason STOCK_CHECK·검증·SSE, 진행 중 한 번 더 → 409 ALREADY_IN_PROGRESS', async () => {
    const { candidateId, head } = await anchoredCandidate();
    const b = rowOf(head, SHOP_B);
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.fetch.handler = async (url, init) => {
      if (url.includes('item.rakuten.co.jp')) await gate;
      return server.fetchHandler(url, init);
    };
    const first = await post(`/sourcing-comparison-rows/${b.id}/stock-checks`);
    expect(first.status).toBe(202);
    expect(first.headers.location).toBe(`/api/v1/candidates/${candidateId}/sourcing-comparison`);
    expect(first.body).toMatchObject({ rowId: b.id, stepStatus: 'WAITING_INPUT' });
    const second = await post(`/sourcing-comparison-rows/${b.id}/stock-checks`);
    expect(second.status).toBe(409);
    expect(errorOf(second)).toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      details: { job: 'STOCK_CHECK', rowId: b.id },
    });
    release();
    await settle();
    const item = await t.prisma.rakutenItem.findFirstOrThrow({
      where: { fetchReason: 'STOCK_CHECK' },
    });
    expect(item.itemCode).toBe(SHOP_B);
    const after = rowOf(await comparison(candidateId), SHOP_B);
    expect(after).toMatchObject({
      isVerified: true,
      rakutenItemId: item.id,
      inStockSizeCount: 3,
      stockPass: true,
      shippingSource: 'DEFAULT_ESTIMATE',
      pointsTotalPt: 536,
      effectivePriceYen: 12_332,
    });
    const updated = events.filter(
      (e) => e.name === 'sourcing.row-updated' && (e.data as { rowId: number }).rowId === b.id,
    );
    expect(updated.at(-1)?.data).toMatchObject({
      isVerified: true,
      stockPass: true,
      effectivePriceYen: 12_332,
    });
    expect((await post('/sourcing-comparison-rows/99999/stock-checks')).status).toBe(404);
  });

  it('POST stock-checks 막힘: 앵커 전 409 ANCHOR_NOT_FIXED, 오늘 페이지 조회 110건이면 409 DAILY_LIMIT_REACHED(요청 없음)', async () => {
    const { head: explore } = await sourcedCandidate();
    const before = await post(`/sourcing-comparison-rows/${explore.rows[0]!.id}/stock-checks`);
    expect(before.status).toBe(409);
    expect(errorOf(before).code).toBe('ANCHOR_NOT_FIXED');

    const { candidateId, head } = await anchoredCandidate();
    const pagesBefore = server.callsOf('PAGE').length;
    await insertPageLogs(110);
    const res = await post(`/sourcing-comparison-rows/${rowOf(head, SHOP_B).id}/stock-checks`);
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'DAILY_LIMIT_REACHED',
      details: { target: 'RAKUTEN_PAGE', dailyLimit: 110 },
    });
    await settle();
    expect(server.callsOf('PAGE')).toHaveLength(pagesBefore);
    // 막힌 요청은 진행 중 표시를 남기지 않는다(상한이 풀리면 다시 누를 수 있다)
    await t.prisma.$executeRawUnsafe('TRUNCATE TABLE call_log RESTART IDENTITY CASCADE');
    await stockCheck(rowOf(head, SHOP_B).id);
    expect(rowOf(await comparison(candidateId), SHOP_B).isVerified).toBe(true);
  });

  it('POST stock-checks: RAKUTEN_PAGE 24시간 쉼이면 409 EXTERNAL_CALL_COOLDOWN(요청 없음, 진행 중 표시 없음)', async () => {
    const { candidateId, head } = await anchoredCandidate();
    const b = rowOf(head, SHOP_B);
    // 다른 상품 페이지가 403 → 관문이 RAKUTEN_PAGE를 24시간 쉰다
    server.answerPage({ status: 403, body: 'Forbidden' });
    expect((await post('/rakuten-items', { sourceUrl: PAGE_URLS.normal })).status).toBe(409);
    const pagesBefore = server.callsOf('PAGE').length;
    const res = await post(`/sourcing-comparison-rows/${b.id}/stock-checks`);
    expect(res.status).toBe(409);
    expect(errorOf(res)).toMatchObject({
      code: 'EXTERNAL_CALL_COOLDOWN',
      details: { target: 'RAKUTEN_PAGE', httpStatus: 403 },
    });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    await settle();
    expect(server.callsOf('PAGE')).toHaveLength(pagesBefore);
    expect(rowOf(await comparison(candidateId), SHOP_B).isVerified).toBe(false);
    // 쉼이 풀리면 다시 누를 수 있다
    await t.prisma.$executeRawUnsafe('TRUNCATE TABLE call_log RESTART IDENTITY CASCADE');
    await stockCheck(b.id);
    expect(rowOf(await comparison(candidateId), SHOP_B).isVerified).toBe(true);
  });

  // ── 수동 행 ───────────────────────────────────────────────────────────────

  it("POST rows('수동'): 앵커 전 409 ANCHOR_NOT_FIXED, 정상 201 MANUAL 검증 행, 같은 itemCode 409, 中古 422", async () => {
    const { head } = await sourcedCandidate();
    const outOfGenre = await fetchItem('out-of-genre');
    const before = await post(`/sourcing-comparisons/${head.id}/rows`, {
      rakutenItemId: outOfGenre,
    });
    expect(before.status).toBe(409);
    expect(errorOf(before).code).toBe('ANCHOR_NOT_FIXED');
    await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: SHOP_A,
    }).expect(202);
    await settle();
    const created = await post(`/sourcing-comparisons/${head.id}/rows`, {
      rakutenItemId: outOfGenre,
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      rowSource: 'MANUAL',
      searchRank: null,
      imageUrl: null,
      isVerified: true,
      anchorMatch: 'MATCH',
      inStockSizeCount: 5,
      stockPass: true,
      rakutenItemId: outOfGenre,
    });
    const dup = await post(`/sourcing-comparisons/${head.id}/rows`, { rakutenItemId: outOfGenre });
    expect(dup.status).toBe(409);
    expect(errorOf(dup).code).toBe('ROW_ALREADY_EXISTS');
    const used = await fetchItem('excluded-word-chuko');
    const excluded = await post(`/sourcing-comparisons/${head.id}/rows`, { rakutenItemId: used });
    expect(excluded.status).toBe(422);
    expect(errorOf(excluded).code).toBe('RAKUTEN_ITEM_EXCLUDED_WORD');
    expect(
      (await post(`/sourcing-comparisons/${head.id}/rows`, { rakutenItemId: 99999 })).status,
    ).toBe(404);
    expect((await post(`/sourcing-comparisons/${head.id}/rows`, {})).status).toBe(422);
  });

  // ── 선택 ──────────────────────────────────────────────────────────────────

  it('PUT selection 막힘: 미검증 · 재고 부족 · 아동화·대상 외 장르 확인 없음 · 같은 itemCode+색상 진행 중', async () => {
    const { candidateId, head } = await anchoredCandidate();
    const select = (rowId: number) => put(`/sourcing-comparisons/${head.id}/selection`, { rowId });
    const unverified = await select(rowOf(head, 'shop-m1:20106').id);
    expect(errorOf(unverified).code).toBe('ROW_NOT_VERIFIED');
    const lowStock = await select(rowOf(head, 'shop-l:20101').id);
    expect(lowStock.status).toBe(409);
    expect(errorOf(lowStock).code).toBe('ROW_STOCK_INSUFFICIENT');
    const janMismatch = await select(rowOf(head, 'shop-j:20102').id);
    expect(errorOf(janMismatch).code).toBe('ANCHOR_KEY_MISMATCH');
    // 대상 외 장르(수동 행) → 409 ADULT_CONFIRMATION_REQUIRED, 머리 행에 신호가 남아 확인할 수 있다
    const manual = await post(`/sourcing-comparisons/${head.id}/rows`, {
      rakutenItemId: await fetchItem('out-of-genre'),
    });
    const adult = await select((manual.body as RowBody).id);
    expect(adult.status).toBe(409);
    expect(errorOf(adult).code).toBe('ADULT_CONFIRMATION_REQUIRED');
    expect((await comparison(candidateId)).genreScope).toBe('OUT_OF_SCOPE');
    // 다른 후보(URL로 만들기)가 같은 itemCode+색상으로 진행 중 → 409 CANDIDATE_DUPLICATE
    const urlItem = await fetchItem('shop-a');
    const other = await post('/candidates', {
      creationPath: 'RAKUTEN_URL',
      rakutenItemId: urlItem,
      selectedColor: CREAM,
    });
    expect(other.status).toBe(201);
    const dup = await select(rowOf(head, SHOP_A).id);
    expect(dup.status).toBe(409);
    expect(errorOf(dup)).toMatchObject({
      code: 'CANDIDATE_DUPLICATE',
      details: { existingCandidateId: (other.body as { id: number }).id },
    });
    // 다른 비교표의 행 → 422, 없는 행 → 404, 앵커 전(탐색) → 409 ANCHOR_NOT_FIXED
    expect((await put(`/sourcing-comparisons/${head.id}/selection`, { rowId: 99999 })).status).toBe(
      404,
    );
    const { head: explore } = await sourcedCandidate();
    const notMine = await put(`/sourcing-comparisons/${explore.id}/selection`, {
      rowId: rowOf(head, SHOP_A).id,
    });
    expect(notMine.status).toBe(422);
    const noAnchor = await put(`/sourcing-comparisons/${explore.id}/selection`, {
      rowId: explore.rows[0]!.id,
    });
    expect(errorOf(noAnchor).code).toBe('ANCHOR_NOT_FIXED');
  });

  it('성별 신호가 없으면 페이지 조회 전에 멈추고(GENDER_REQUIRED), 오너가 성별을 고르면 이어 간다', async () => {
    const { candidateId, head } = await sourcedCandidate();
    await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: 'shop-h:20104',
    }).expect(202);
    await settle();
    const waiting = await comparison(candidateId);
    expect(waiting.detectedGender).toBeNull();
    expect(server.callsOf('PAGE')).toHaveLength(0);
    const h = rowOf(waiting, 'shop-h:20104');
    await stockCheck(h.id);
    const checked = rowOf(await comparison(candidateId), 'shop-h:20104');
    expect(checked).toMatchObject({ isVerified: true, stockPass: null, inStockSizeCount: null });
    const res = await put(`/sourcing-comparisons/${head.id}/selection`, { rowId: h.id });
    expect(res.status).toBe(409);
    expect(errorOf(res).code).toBe('GENDER_REQUIRED');

    const gender = await put(`/candidates/${candidateId}/gender`, { gender: 'MALE' });
    expect(gender.status).toBe(200);
    expect((gender.body as { resumedStepRunIds: number[] }).resumedStepRunIds).toEqual([
      head.stepRunId,
    ]);
    await settle();
    const resumed = await comparison(candidateId);
    expect(resumed.ownerGender).toBe('MALE');
    expect(rowOf(resumed, 'shop-h:20104')).toMatchObject({ inStockSizeCount: 3, stockPass: true });
    expect(server.callsOf('PAGE').length).toBeGreaterThan(1);
  });

  it('오너 성별은 ②가 덮어쓰지 않는다: 여성 목표 범위로 재고를 보고, 자동 판단(남성)과 다르면 재확인 필요', async () => {
    const { candidateId, head } = await sourcedCandidate();
    const gender = await put(`/candidates/${candidateId}/gender`, { gender: 'FEMALE' });
    expect(gender.status).toBe(200);
    // 앵커 전(탐색)에는 ②가 성별을 기다리지 않아 이어 간 실행이 없다
    expect((gender.body as { resumedStepRunIds: number[] }).resumedStepRunIds).toEqual([]);
    await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: SHOP_A,
    }).expect(202);
    await settle();
    const after = await comparison(candidateId);
    expect(after.detectedGender).toBe('MALE');
    // 샵 A 여성 220~260mm: 250·255·260 재고 = 3 → 통과(남성이면 5)
    expect(rowOf(after, SHOP_A)).toMatchObject({ inStockSizeCount: 3, stockPass: true });
    await put(`/sourcing-comparisons/${head.id}/selection`, {
      rowId: rowOf(after, SHOP_A).id,
    }).expect(200);
    expect(await candidateRow(candidateId)).toMatchObject({
      gender: 'FEMALE',
      genderSource: 'OWNER',
      genderRecheckRequired: true,
    });
  });

  it('정상 선택: 200 COMPLETED, 후보 itemCode·selectedColor·앵커·성별, is_selected 1행, 같은 행 다시 → 같은 응답, 완료 뒤 PATCH·앵커 409, 닫힌 버전 UPDATE는 DB 오류', async () => {
    const { candidateId, head } = await anchoredCandidate();
    const a = rowOf(head, SHOP_A);
    const res = await put(`/sourcing-comparisons/${head.id}/selection`, { rowId: a.id });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      candidateId,
      sourcingComparisonId: head.id,
      stepRunId: head.stepRunId,
      stepStatus: 'COMPLETED',
      selectedRowId: a.id,
      itemCode: SHOP_A,
      selectedColor: CREAM,
      g2Invalidated: false,
      staleDownstreamSteps: [],
    });
    const candidate = await candidateRow(candidateId);
    expect(candidate).toMatchObject({
      itemCode: SHOP_A,
      selectedColor: CREAM,
      anchorModelCode: '1201A019',
      anchorItemCode: null,
      anchorColorCode: '108',
      gender: 'MALE',
      genderSource: 'STEP2',
    });
    expect(candidate.anchorFixedAt).not.toBeNull();
    expect(
      await t.prisma.sourcingComparisonRow.count({
        where: { sourcingComparisonId: head.id, isSelected: true },
      }),
    ).toBe(1);
    const again = await put(`/sourcing-comparisons/${head.id}/selection`, { rowId: a.id });
    expect(again.status).toBe(200);
    expect(again.body).toEqual(res.body);
    const closed = await patch(`/sourcing-comparison-rows/${a.id}`, { couponYen: 100 });
    expect(closed.status).toBe(409);
    expect(errorOf(closed).code).toBe('STEP_RUN_NOT_WAITING_INPUT');
    const anchorAfter = await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: SHOP_A,
    });
    expect(errorOf(anchorAfter).code).toBe('STEP_RUN_NOT_WAITING_INPUT');
    const otherRow = await put(`/sourcing-comparisons/${head.id}/selection`, {
      rowId: rowOf(head, 'shop-w:20103').id,
    });
    expect(errorOf(otherRow).code).toBe('STEP_RUN_NOT_WAITING_INPUT');
    // trg_output_frozen: 닫힌 버전의 행은 DB가 막는다
    await expect(
      t.prisma.$executeRawUnsafe(
        `UPDATE sourcing_comparison_row SET coupon_yen = 1 WHERE id = ${a.id}`,
      ),
    ).rejects.toThrow(/cannot change/);
    // 소싱 선택 읽기(③이 쓴다) = 고른 행
    const selection = await t.prisma.sourcingComparisonRow.findFirstOrThrow({
      where: { sourcingComparisonId: head.id, isSelected: true },
    });
    expect(selection.itemCode).toBe(SHOP_A);
  });

  it('G2 통과 뒤 ② 다시 실행 → 앵커 입력 없이 이어 감, 쿠폰·배율 복사, 다른 샵 선택 → g2Invalidated + SSE gate.invalidated', async () => {
    const { candidateId, head } = await anchoredCandidate();
    await patch(`/sourcing-comparison-rows/${rowOf(head, SHOP_B).id}`, {
      couponYen: 500,
      shopEventMultiplier: 2,
    }).expect(200);
    await put(`/sourcing-comparisons/${head.id}/selection`, {
      rowId: rowOf(head, SHOP_A).id,
    }).expect(200);
    await post(`/candidates/${candidateId}/steps/PRICING/runs`).expect(202);
    await settle();
    await recordGatePass(t.app, t.prisma, candidateId, 'G2');

    await post(`/candidates/${candidateId}/steps/SOURCING/runs`).expect(202);
    await settle();
    const v2 = await comparison(candidateId, '?includeNoMatch=true');
    expect(v2.id).not.toBe(head.id);
    expect(v2.baseSourcingComparisonId).toBe(head.id);
    expect(v2).toMatchObject({
      stepStatus: 'WAITING_INPUT',
      exploreMode: false,
      anchorModelCodeNorm: '1201A019',
    });
    const b = rowOf(v2, SHOP_B);
    expect(b).toMatchObject({ couponYen: 500, shopEventMultiplier: 2 });
    expect(rowOf(v2, SHOP_A).isVerified).toBe(true);
    await stockCheck(b.id);
    events.length = 0;
    const res = await put(`/sourcing-comparisons/${v2.id}/selection`, { rowId: b.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      itemCode: SHOP_B,
      g2Invalidated: true,
      staleDownstreamSteps: ['PRICING'],
    });
    expect(events.some((e) => e.name === 'gate.invalidated')).toBe(true);
    expect((await candidateRow(candidateId)).itemCode).toBe(SHOP_B);
  });

  // ── 제외 ──────────────────────────────────────────────────────────────────

  it('앵커 일치 0건으로 반복 종료 → 후보 EXCLUDED·ANCHOR_NO_MATCH, 재고 통과 0건 → INSUFFICIENT_STOCK', async () => {
    const { candidateId, head } = await sourcedCandidate();
    await put(`/sourcing-comparisons/${head.id}/anchor`, {
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '9999Z999',
      anchorColorCode: '001',
    }).expect(202);
    await settle();
    expect(await candidateRow(candidateId)).toMatchObject({
      status: 'EXCLUDED',
      excludedReason: 'ANCHOR_NO_MATCH',
    });
    const finished = events.find((e) => e.name === 'sourcing.page-fetch-finished');
    expect(finished?.data).toMatchObject({ fetchedCount: 0, stopReason: 'NO_MORE_ROWS' });

    const second = await sourcedCandidate();
    server.answerPage(
      ...Array.from({ length: 10 }, () => ({ status: 200, page: 'shop-low-stock' as const })),
    );
    await put(`/sourcing-comparisons/${second.head.id}/anchor`, {
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '1201A019',
      anchorColorCode: '108',
    }).expect(202);
    await settle();
    expect(await candidateRow(second.candidateId)).toMatchObject({
      status: 'EXCLUDED',
      excludedReason: 'INSUFFICIENT_STOCK',
    });
    const cap = events.filter((e) => e.name === 'sourcing.page-fetch-finished').at(-1);
    expect(cap?.data).toMatchObject({ fetchedCount: 10, passedCount: 0, stopReason: 'PAGE_CAP' });
  });

  it('앵커 뒤 조회가 쉼(BLOCKED)·하루 상한(DAILY_LIMIT)으로 멈추면 재고 통과 0이어도 제외 판단을 하지 않는다', async () => {
    const lastFinished = () =>
      events.filter((e) => e.name === 'sourcing.page-fetch-finished').at(-1)?.data;
    const anchor = {
      anchorInputMethod: 'CODE_ENTRY',
      anchorModelCode: '1201A019',
      anchorColorCode: '108',
    };

    // 첫 페이지 재고 2/9(탈락) → 둘째 페이지 403 → BLOCKED
    const blocked = await sourcedCandidate();
    server.answerPage({ status: 200, page: 'shop-low-stock' }, { status: 403, body: 'Forbidden' });
    await put(`/sourcing-comparisons/${blocked.head.id}/anchor`, anchor).expect(202);
    await settle();
    expect(lastFinished()).toMatchObject({
      fetchedCount: 1,
      passedCount: 0,
      stopReason: 'BLOCKED',
    });
    const b = await candidateRow(blocked.candidateId);
    expect(b.status).not.toBe('EXCLUDED');
    expect(b.excludedReason).toBeNull();

    // 오늘 109건 → 한 페이지(재고 탈락)만 읽고 DAILY_LIMIT
    const limited = await sourcedCandidate();
    await t.prisma.$executeRawUnsafe('TRUNCATE TABLE call_log RESTART IDENTITY CASCADE');
    await insertPageLogs(109);
    server.answerPage({ status: 200, page: 'shop-low-stock' });
    await put(`/sourcing-comparisons/${limited.head.id}/anchor`, anchor).expect(202);
    await settle();
    expect(lastFinished()).toMatchObject({
      fetchedCount: 1,
      passedCount: 0,
      stopReason: 'DAILY_LIMIT',
    });
    const l = await candidateRow(limited.candidateId);
    expect(l.status).not.toBe('EXCLUDED');
    expect(l.excludedReason).toBeNull();
  });
});
