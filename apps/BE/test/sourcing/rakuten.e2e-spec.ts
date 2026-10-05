import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { SECRET_STORE } from '../../src/common/secrets/secret-store.port.js';
import { toKstDateValue } from '../../src/common/time/kst.js';
import { APP_USER_AGENT } from '../../src/modules/integrations/http/external-http.gateway.js';
import { runPageFetchLoop } from '../../src/modules/sourcing/page-fetch-loop.js';
import { RakutenItemFetcher } from '../../src/modules/sourcing/rakuten-item-fetcher.js';
import { parseRakutenItemUrl } from '../../src/modules/sourcing/rakuten-url.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { StepEngineApi } from '../../src/modules/step-engine/step-engine.api.js';
import { createTestApp, type TestApp, truncate } from '../helpers/test-app.js';
import { seedUsableAiEngine } from '../support/fake-ai-engines.js';
import { FakePricingRunner, FakePricingRunnerModule } from '../support/fake-pricing-runner.js';
import { InMemorySecretStore } from '../support/in-memory-secret-store.js';
import {
  PAGE_URLS,
  RakutenFixtureServer,
  type RakutenPageFixture,
  rakutenPageBytes,
} from '../support/rakuten-fixture.adapters.js';

/**
 * ② 라쿠텐 연동 e2e(P2-02 §6, autostore_test). 가짜 라쿠텐을 가짜 fetch(HTTP_FETCH) 뒤에 둔다 → 실제 어댑터·외부 호출
 * 관문(허용 목록·앱 UA·1.5초/3초 간격·call_log·하루 상한·24시간 쉼)을 지난다. 키는 메모리 비밀 저장소(가짜 값). ③은 가짜
 * PRICING 실행기(재조회 뒤 재판정 확인). 실제 라쿠텐은 부르지 않는다.
 */
const DATA_DIR = process.env.APP_DATA_DIR!;
const CLIENT = { 'X-AutoStore-Client': '1' };
const TABLES = [
  'rakuten_item',
  'rakuten_sku',
  'rakuten_search_cache',
  'rakuten_genre',
  'sourcing_comparison',
  'sourcing_comparison_row',
  'call_log',
  'user_action_log',
  'candidate',
  'candidate_step',
  'candidate_status_history',
  'step_run',
  'step_run_input',
  'gate_pass',
  'step_chain',
];
const KEYS = {
  RAKUTEN_APPLICATION_ID: 'e2e-fixture-app-id-0001',
  RAKUTEN_ACCESS_KEY: 'e2e-fixture-access-key-0001',
} as const;
const CREAM = 'クリーム×ブラック(108)';
const WHITE_RED = 'ホワイト/レッド(101)';
const QUERY = 'アシックス 1201A019';
const DAY = 86_400_000;

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string }[];
}
interface SnapshotBody {
  id: number;
  itemCode: string;
  shopCode: string;
  itemName: string;
  itemUrl: string;
  entrySource: string;
  fetchReason: string;
  genreId: number | null;
  genreSource: string;
  genrePath: string | null;
  manualCheckRequired: boolean;
  skus: {
    variantId: string;
    sizeMm: number | null;
    colorLabel: string | null;
    quantity: number | null;
  }[];
  [key: string]: unknown;
}
interface FetchBody {
  rakutenItem: SnapshotBody;
  checks: {
    excludedWords: string[];
    genreScope: string;
    childSizeSuspect: boolean;
    adultConfirmationRequired: boolean;
  };
}

describe('② 라쿠텐 연동 API(e2e, 가짜 라쿠텐, P2-02)', () => {
  let t: TestApp;
  let server: RakutenFixtureServer;
  let pricing: FakePricingRunner;
  const secrets = new InMemorySecretStore({ initial: { ...KEYS } });
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body?: object) =>
    http().post(`/api/v1${path}`).set(CLIENT).send(body);
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const errorOf = (res: request.Response) => res.body as ErrorBody;

  async function fetchItem(name: RakutenPageFixture): Promise<FetchBody> {
    const res = await post('/rakuten-items', { sourceUrl: PAGE_URLS[name] });
    expect(res.status).toBe(201);
    return res.body as FetchBody;
  }

  async function urlCandidate(name: RakutenPageFixture, color: string) {
    const fetched = await fetchItem(name);
    const res = await post('/candidates', {
      creationPath: 'RAKUTEN_URL',
      rakutenItemId: fetched.rakutenItem.id,
      selectedColor: color,
    });
    return { fetched, res, candidateId: (res.body as { id: number }).id };
  }

  const sourcingStep = (candidateId: number) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode: 'SOURCING' } },
      include: { currentStepRun: { include: { sourcingComparison: true } } },
    });

  /** 입력 대기 이유 코드(DB 열이 없어 SSE step-run.status-changed로 알린다) */
  const waitingReasonOf = (stepRunId: number): unknown =>
    events
      .filter((e) => e.name === 'step-run.status-changed')
      .map((e) => e.data as { stepRunId?: number; status?: string; waitingReasonCode?: string })
      .find((d) => d.stepRunId === stepRunId && d.status === 'WAITING_INPUT')?.waitingReasonCode;

  const pageCalls = () => t.prisma.callLog.count({ where: { target: 'RAKUTEN_PAGE' } });

  async function insertPageLogs(n: number, calledAt: Date): Promise<void> {
    await t.prisma.callLog.createMany({
      data: Array.from({ length: n }, () => ({
        calledAt,
        kstDate: toKstDateValue(calledAt),
        target: 'RAKUTEN_PAGE',
        httpMethod: 'GET',
        host: 'item.rakuten.co.jp',
        urlMasked: PAGE_URLS.normal,
        httpStatus: 200,
        succeeded: true,
        durationMs: 10,
      })),
    });
  }

  beforeAll(async () => {
    t = await createTestApp({
      imports: [FakePricingRunnerModule],
      overrides: [{ provide: SECRET_STORE, useValue: secrets }],
      beforeInit: (prisma) => truncate(prisma, TABLES),
    });
    server = new RakutenFixtureServer(t.clock);
    pricing = t.app.get(FakePricingRunner);
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  afterAll(async () => {
    unsubscribe();
    await idle();
    await t.app.close();
  });

  beforeEach(async () => {
    await idle();
    await truncate(t.prisma, TABLES);
    // ② SOURCING은 AI 단계(P2-03 — F-BS-38)라 선택 엔진을 쓸 수 있는 점검 행이 있어야 시작한다
    await seedUsableAiEngine(t.prisma);
    server.reset();
    pricing.reset();
    t.fetch.reset();
    t.fetch.handler = server.fetchHandler;
    secrets.reset();
    await secrets.set('RAKUTEN_APPLICATION_ID', KEYS.RAKUTEN_APPLICATION_ID);
    await secrets.set('RAKUTEN_ACCESS_KEY', KEYS.RAKUTEN_ACCESS_KEY);
    events.length = 0;
    // 테스트마다 하루를 넘겨 앞 테스트의 쉼·간격이 섞이지 않게 한다(call_log도 비웠다)
    t.clock.advance(DAY);
  });

  // ── 검색어 형식 검사 ─────────────────────────────────────────────────────

  describe('POST /rakuten-query-validations', () => {
    it('200 valid·violations(저장 없음), 규칙 위반도 200', async () => {
      const ok = await post('/rakuten-query-validations', {
        rakutenQuery: 'アシックス ゲルカヤノ',
      });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({
        rakutenQuery: 'アシックス ゲルカヤノ',
        valid: true,
        halfWidthLength: 21,
        maxHalfWidthLength: 128,
        violations: [],
        genreId: 558885,
        ngKeywords: [
          '中古',
          'インソール',
          '靴紐',
          'シューレース',
          '箱のみ',
          'キッズ',
          'ジュニア',
          'ベビー',
        ],
      });
      const bad = await post('/rakuten-query-validations', {
        rakutenQuery: `a ${'b'.repeat(130)}`,
      });
      expect(bad.status).toBe(200);
      expect(bad.body).toMatchObject({
        valid: false,
        violations: [
          { rule: 'TOO_LONG', word: null },
          { rule: 'WORD_TOO_SHORT', word: 'a' },
        ],
      });
      expect(server.calls).toHaveLength(0);
    });

    it('본문 없음 → 422 VALIDATION_FAILED, 가드 헤더 없음 → 403', async () => {
      const missing = await post('/rakuten-query-validations', {});
      expect(missing.status).toBe(422);
      expect(errorOf(missing).code).toBe('VALIDATION_FAILED');
      const noHeader = await http()
        .post('/api/v1/rakuten-query-validations')
        .send({ rakutenQuery: 'asics' });
      expect(noHeader.status).toBe(403);
    });
  });

  // ── URL 입구 ─────────────────────────────────────────────────────────────

  describe('POST /rakuten-items · GET /rakuten-items/{id}', () => {
    it('normal → 201 + Location, itemCode는 페이지 JSON(URL 조각 아님), 입구 검사, call_log RAKUTEN_PAGE +1', async () => {
      const res = await post('/rakuten-items', { sourceUrl: PAGE_URLS.normal });
      expect(res.status).toBe(201);
      const body = res.body as FetchBody;
      expect(res.headers.location).toBe(`/api/v1/rakuten-items/${body.rakutenItem.id}`);
      expect(body.rakutenItem).toMatchObject({
        itemCode: 'shop-a:10000123',
        shopCode: 'shop-a',
        itemUrl: PAGE_URLS.normal,
        itemName: 'アシックス ゲルカヤノ 14 1201A019-108 クリーム×ブラック メンズ スニーカー',
        entrySource: 'MANUAL',
        fetchReason: 'URL_ENTRY',
        genreId: 208025,
        genreSource: 'PAGE_JSON',
        genrePath: '558885:靴 > 110983:メンズ靴 > 208025:スニーカー',
        modelCode: '1201A019-108',
        modelCodeNorm: '1201A019108',
        manualCheckRequired: true,
      });
      expect(body.rakutenItem.itemCode).not.toContain('asics-1201a019-108');
      expect(body.rakutenItem.skus).toHaveLength(9);
      expect(body.rakutenItem).not.toHaveProperty('descriptionHtml');
      expect(body.rakutenItem).not.toHaveProperty('rawFilePath');
      expect(body.checks).toEqual({
        excludedWords: [],
        genreScope: 'IN_SCOPE',
        childSizeSuspect: false,
        adultConfirmationRequired: false,
      });
      expect(await pageCalls()).toBe(1);
      // 앱 고유 UA(브라우저 위장 없음)
      expect(server.callsOf('PAGE')[0]!.headers['User-Agent']).toBe(APP_USER_AGENT);
    });

    it('원본 바이트를 데이터 폴더에 그대로 두고 경로·SHA-256·크기를 남긴다', async () => {
      const { rakutenItem } = await fetchItem('normal');
      const row = await t.prisma.rakutenItem.findUniqueOrThrow({ where: { id: rakutenItem.id } });
      const bytes = rakutenPageBytes('normal');
      const sha = createHash('sha256').update(bytes).digest('hex');
      expect(row).toMatchObject({
        rawFileSha256: sha,
        rawFileBytes: bytes.length,
        rawFilePath: `rakuten/pages/${sha.slice(0, 2)}/${sha}.html`,
      });
      expect(readFileSync(join(DATA_DIR, row.rawFilePath!)).equals(bytes)).toBe(true);
      expect(row.descriptionHtml).toContain('<p>');
      const skus = await t.prisma.rakutenSku.count({ where: { rakutenItemId: row.id } });
      expect(skus).toBe(9);
    });

    it('같은 URL 두 번 → HTTP 2회, rakuten_item 2행(캐시 없음), 두 요청 사이 ≥ 3초', async () => {
      const a = await fetchItem('normal');
      const b = await fetchItem('normal');
      expect(a.rakutenItem.id).not.toBe(b.rakutenItem.id);
      expect(server.callsOf('PAGE')).toHaveLength(2);
      expect(await t.prisma.rakutenItem.count()).toBe(2);
      const [p1, p2] = server.callsOf('PAGE');
      expect(p2!.at - p1!.at).toBeGreaterThanOrEqual(3000);
    });

    it('잘못된 URL → 422 RAKUTEN_URL_INVALID(요청 없음), 점검 페이지 → 502 EXTERNAL_API_ERROR(행 없음, 조회는 센다)', async () => {
      const bad = await post('/rakuten-items', {
        sourceUrl: 'https://search.rakuten.co.jp/search/mall/asics/',
      });
      expect(bad.status).toBe(422);
      expect(errorOf(bad)).toMatchObject({ code: 'RAKUTEN_URL_INVALID' });
      expect(errorOf(bad).fieldErrors?.[0]?.field).toBe('sourceUrl');
      expect(server.calls).toHaveLength(0);

      const down = await post('/rakuten-items', { sourceUrl: PAGE_URLS.maintenance });
      expect(down.status).toBe(502);
      expect(errorOf(down)).toMatchObject({
        code: 'EXTERNAL_API_ERROR',
        details: { target: 'RAKUTEN_PAGE', reason: 'MAINTENANCE_PAGE' },
      });
      expect(await t.prisma.rakutenItem.count()).toBe(0);
      expect(await pageCalls()).toBe(1);
      const log = await t.prisma.callLog.findFirstOrThrow({ where: { target: 'RAKUTEN_PAGE' } });
      expect(log).toMatchObject({ httpStatus: 200, errorCode: 'MAINTENANCE_PAGE' });
    });

    it('오늘(KST) RAKUTEN_PAGE 110행이면 409 DAILY_LIMIT_REACHED + Retry-After. 어제 행은 세지 않는다', async () => {
      const now = t.clock.now();
      await insertPageLogs(5, new Date(now.getTime() - DAY));
      await insertPageLogs(109, now);
      await fetchItem('normal'); // 110번째
      const res = await post('/rakuten-items', { sourceUrl: PAGE_URLS.normal });
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'DAILY_LIMIT_REACHED',
        details: { target: 'RAKUTEN_PAGE', dailyLimit: 110 },
      });
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      expect(server.callsOf('PAGE')).toHaveLength(1);
    });

    it('페이지 403 뒤 다시 POST → 409 EXTERNAL_CALL_COOLDOWN(blockedUntil ≈ +24h)', async () => {
      server.answerPage({ status: 403, body: 'Forbidden' });
      const first = await post('/rakuten-items', { sourceUrl: PAGE_URLS.normal });
      expect(first.status).toBe(409);
      const calledAt = server.callsOf('PAGE')[0]!.at;
      const again = await post('/rakuten-items', { sourceUrl: PAGE_URLS.normal });
      expect(again.status).toBe(409);
      const body = errorOf(again);
      expect(body).toMatchObject({
        code: 'EXTERNAL_CALL_COOLDOWN',
        details: { target: 'RAKUTEN_PAGE', httpStatus: 403 },
      });
      expect(Date.parse(body.details!.blockedUntil as string) - calledAt).toBe(DAY);
      expect(Number(again.headers['retry-after'])).toBeGreaterThan(0);
      // 다시 보내지 않았다
      expect(server.callsOf('PAGE')).toHaveLength(1);
    });

    it('GET 스냅샷: 200(설명 HTML·원본 경로 없음), 없는 id·정수 아님 → 404 RAKUTEN_ITEM_NOT_FOUND', async () => {
      const { rakutenItem } = await fetchItem('normal');
      const res = await http().get(`/api/v1/rakuten-items/${rakutenItem.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: rakutenItem.id, itemCode: 'shop-a:10000123' });
      expect(res.body).not.toHaveProperty('descriptionHtml');
      expect(res.body).not.toHaveProperty('rawFilePath');
      expect(JSON.stringify(res.body)).not.toContain(DATA_DIR);
      expect((res.body as SnapshotBody).variantSelectors).toBeTruthy();
      for (const id of ['999999', 'abc']) {
        const missing = await http().get(`/api/v1/rakuten-items/${id}`);
        expect(missing.status).toBe(404);
        expect(errorOf(missing).code).toBe('RAKUTEN_ITEM_NOT_FOUND');
      }
    });

    it('아동화·장르 신호: child-max-235·out-of-genre는 막지 않고 알린다, 장르 없는 페이지는 itemCode로 Item Search', async () => {
      expect((await fetchItem('child-max-235')).checks).toEqual({
        excludedWords: [],
        genreScope: 'IN_SCOPE',
        childSizeSuspect: true,
        adultConfirmationRequired: true,
      });
      expect((await fetchItem('out-of-genre')).checks).toMatchObject({
        genreScope: 'OUT_OF_SCOPE',
        adultConfirmationRequired: true,
      });
      const noGenre = await fetchItem('no-genre');
      expect(noGenre.rakutenItem).toMatchObject({ genreId: 208025, genreSource: 'ITEM_SEARCH' });
      expect(noGenre.checks.genreScope).toBe('IN_SCOPE');
      const search = server.callsOf('SEARCH');
      expect(search).toHaveLength(1);
      expect(search[0]!.params).toMatchObject({ itemCode: 'shop-g:10000777' });
      // 키는 요청 URL에만 간다
      expect(search[0]!.params.accessKey).toBe(KEYS.RAKUTEN_ACCESS_KEY);
    });

    it('장르를 끝내 못 얻으면(키 없음) genre_source NOT_FOUND(genre_id NULL) → 성인용 확인 필요', async () => {
      secrets.reset();
      const noGenre = await fetchItem('no-genre');
      expect(noGenre.rakutenItem).toMatchObject({ genreId: null, genreSource: 'NOT_FOUND' });
      expect(noGenre.checks).toMatchObject({
        genreScope: 'NOT_FOUND',
        adultConfirmationRequired: true,
      });
    });

    it('제외어 상품: 입구는 201(checks.excludedWords), 후보는 422 RAKUTEN_ITEM_EXCLUDED_WORD', async () => {
      const { fetched, res } = await urlCandidate('excluded-word-chuko', CREAM);
      expect(fetched.checks.excludedWords).toEqual(['中古']);
      expect(res.status).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: 'RAKUTEN_ITEM_EXCLUDED_WORD',
        details: { excludedWords: ['中古'] },
      });
      expect(errorOf(res).message).toContain('中古');
      expect(await t.prisma.candidate.count()).toBe(0);
    });

    it('F-BS-37: 페이지에 관리번호가 없으면 샵 코드 + 型番 Item Search로 itemUrl이 같은 itemCode', async () => {
      const got = await fetchItem('no-item-code');
      expect(got.rakutenItem.itemCode).toBe('shop-e:10000999');
      expect(server.callsOf('SEARCH')[0]!.params).toMatchObject({ shopCode: 'shop-e' });
    });

    it('F-BS-37 보완 실패 → 422 RAKUTEN_ITEM_CODE_UNRESOLVED, 스냅샷을 만들지 않는다', async () => {
      server.answerSearch(
        { status: 200, file: 'by-itemcode-genre.json' },
        { status: 200, file: 'by-itemcode-genre.json' },
      );
      const res = await post('/rakuten-items', { sourceUrl: PAGE_URLS['no-item-code'] });
      expect(res.status).toBe(422);
      expect(errorOf(res).code).toBe('RAKUTEN_ITEM_CODE_UNRESOLVED');
      expect(await t.prisma.rakutenItem.count()).toBe(0);
    });

    it('UPDATE rakuten_item 직접 실행 → DB 오류(추가만 트리거)', async () => {
      const { rakutenItem } = await fetchItem('normal');
      await expect(
        t.prisma.$executeRawUnsafe(
          'UPDATE rakuten_item SET item_name = $1 WHERE id = $2',
          'changed',
          rakutenItem.id,
        ),
      ).rejects.toThrow();
    });
  });

  // ── URL로 바로 후보 만들기·성인용 확인 ───────────────────────────────────────

  describe('POST /candidates RAKUTEN_URL · PUT …/adult-product-confirmation', () => {
    it('normal: 201 WORKING + ② URL_CREATE 완료(비교 안 함·행 0개·앵커 = URL 상품·송료·성별)', async () => {
      const { fetched, res, candidateId } = await urlCandidate('normal', CREAM);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ creationPath: 'RAKUTEN_URL', status: 'WORKING' });
      const step = await sourcingStep(candidateId);
      expect(step.status).toBe('COMPLETED');
      expect(step.currentStepRun?.sourcingComparison).toMatchObject({
        action: 'URL_CREATE',
        comparisonPerformed: false,
        anchorInputMethod: 'URL_ITEM',
        anchorItemCode: 'shop-a:10000123',
        anchorModelCode: '1201A019-108',
        anchorModelCodeNorm: '1201A019108',
        anchorColorCode: '108',
        anchorColorLabel: CREAM,
        selectedRakutenItemId: fetched.rakutenItem.id,
        shippingYen: 0,
        shippingSource: 'FREE',
        childSizeSuspect: false,
        genreScope: 'IN_SCOPE',
        detectedGender: 'MALE',
        genderBasis: 'GENRE_PATH',
        sourceUrl: PAGE_URLS.normal,
      });
      const rows = await t.prisma.sourcingComparisonRow.count();
      expect(rows).toBe(0);
      const candidate = await t.prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
      expect(candidate).toMatchObject({
        itemCode: 'shop-a:10000123',
        selectedColor: CREAM,
        anchorModelCode: '1201A019108',
        anchorColorCode: '108',
        gender: 'MALE',
        genderSource: 'STEP2',
      });
      expect(candidate.anchorFixedAt).not.toBeNull();
      // URL로 만들기는 페이지를 다시 읽지 않는다(스냅샷을 쓴다)
      expect(server.callsOf('PAGE')).toHaveLength(1);
    });

    it('child-max-235: 201 + ② WAITING_INPUT → 성인용 확인 200(멱등) → user_action_log 1행 → ② 완료', async () => {
      const { res, candidateId } = await urlCandidate('child-max-235', WHITE_RED);
      expect(res.status).toBe(201);
      const waiting = await sourcingStep(candidateId);
      expect(waiting.status).toBe('WAITING_INPUT');
      expect(waitingReasonOf(waiting.currentStepRunId!)).toBe(
        'ADULT_PRODUCT_CONFIRMATION_REQUIRED',
      );
      const comparison = await http().get(`/api/v1/candidates/${candidateId}/sourcing-comparison`);
      expect(comparison.status).toBe(200);
      expect(comparison.body).toMatchObject({
        action: 'URL_CREATE',
        comparisonPerformed: false,
        childSizeSuspect: true,
        adultProductConfirmedAt: null,
        stepStatus: 'WAITING_INPUT',
        rows: [],
        creditText: 'Supported by Rakuten Developers',
      });
      const id = (comparison.body as { id: number }).id;

      // 비교를 하지 않은 URL 버전은 입력 대기여도 검색 결과 더 보기를 받지 않는다(D-47)
      const noMore = await http()
        .post(`/api/v1/sourcing-comparisons/${id}/search-more`)
        .set(CLIENT);
      expect(noMore.status).toBe(409);
      expect((noMore.body as { code: string }).code).toBe('STEP_RUN_NOT_WAITING_INPUT');
      expect(server.callsOf('SEARCH')).toHaveLength(0);

      // 웹 화면 요청만 받는다
      const noHeader = await http().put(
        `/api/v1/sourcing-comparisons/${id}/adult-product-confirmation`,
      );
      expect(noHeader.status).toBe(403);

      const first = await http()
        .put(`/api/v1/sourcing-comparisons/${id}/adult-product-confirmation`)
        .set(CLIENT);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        sourcingComparisonId: id,
        stepRunId: waiting.currentStepRunId,
        stepStatus: 'COMPLETED',
      });
      t.clock.advance(60_000);
      const again = await http()
        .put(`/api/v1/sourcing-comparisons/${id}/adult-product-confirmation`)
        .set(CLIENT);
      expect(again.status).toBe(200);
      expect((again.body as { adultProductConfirmedAt: string }).adultProductConfirmedAt).toBe(
        (first.body as { adultProductConfirmedAt: string }).adultProductConfirmedAt,
      );
      const logs = await t.prisma.userActionLog.findMany({
        where: { eventType: 'OWNER_CONFIRMED' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({ candidateId, stepCode: 'SOURCING' });
      expect(logs[0]!.detail).toMatchObject({ confirmation: 'ADULT_PRODUCT' });
      expect((await sourcingStep(candidateId)).status).toBe('COMPLETED');
      const candidate = await t.prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
      expect(candidate).toMatchObject({
        anchorModelCode: 'DN1791100',
        anchorColorCode: '101',
        gender: 'FEMALE',
      });
    });

    it('아동화 의심이 아닌 후보의 성인용 확인 → 409 CONFIRMATION_NOT_APPLICABLE, 없는 비교표 → 404', async () => {
      const { candidateId } = await urlCandidate('normal', CREAM);
      const step = await sourcingStep(candidateId);
      const id = step.currentStepRun!.sourcingComparison!.id;
      const res = await http()
        .put(`/api/v1/sourcing-comparisons/${id}/adult-product-confirmation`)
        .set(CLIENT);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('CONFIRMATION_NOT_APPLICABLE');
      const missing = await http()
        .put('/api/v1/sourcing-comparisons/999999/adult-product-confirmation')
        .set(CLIENT);
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('SOURCING_COMPARISON_NOT_FOUND');
    });

    it('RAKUTEN_URL 같은 itemCode+색상 두 번 → 409 CANDIDATE_DUPLICATE(details.existingCandidateId)', async () => {
      const first = await urlCandidate('normal', CREAM);
      expect(first.res.status).toBe(201);
      const second = await post('/candidates', {
        creationPath: 'RAKUTEN_URL',
        rakutenItemId: first.fetched.rakutenItem.id,
        selectedColor: CREAM,
      });
      expect(second.status).toBe(409);
      expect(errorOf(second)).toMatchObject({
        code: 'CANDIDATE_DUPLICATE',
        details: { existingCandidateId: first.candidateId },
      });
      expect(await t.prisma.candidate.count()).toBe(1);
      expect(await t.prisma.sourcingComparison.count()).toBe(1);
    });
  });

  // ── ② 검색·비교 ───────────────────────────────────────────────────────────

  describe('② 검색·비교(SOURCING 실행기)', () => {
    async function searchCandidate(query = QUERY): Promise<number> {
      const res = await post('/candidates', { creationPath: 'SEARCH_QUERY', rakutenQuery: query });
      expect(res.status).toBe(201);
      return (res.body as { id: number }).id;
    }
    const startSourcing = (candidateId: number, body: object = {}) =>
      post(`/candidates/${candidateId}/steps/SOURCING/runs`, body);

    it('검색 → 아동 단어 2건 뺀 28행 + SSE sourcing.search-completed → 앵커 입력 대기(탐색 모드)', async () => {
      const candidateId = await searchCandidate();
      const res = await startSourcing(candidateId);
      expect(res.status).toBe(202);
      await idle();
      const step = await sourcingStep(candidateId);
      expect(step.status).toBe('WAITING_INPUT');
      expect(waitingReasonOf(step.currentStepRunId!)).toBe('SOURCING_ANCHOR_REQUIRED');
      const head = step.currentStepRun!.sourcingComparison!;
      expect(head).toMatchObject({
        action: 'SEARCH_COMPARE',
        searchKeyword: QUERY,
        comparisonPerformed: true,
        anchorInputMethod: null,
      });
      const rows = await t.prisma.sourcingComparisonRow.findMany({
        where: { sourcingComparisonId: head.id },
      });
      expect(rows).toHaveLength(28);
      expect(rows.some((r) => r.itemName.includes('キッズ'))).toBe(false);
      expect(rows.every((r) => r.rowSource === 'API' && r.isVerified === false)).toBe(true);
      const completed = events.find((e) => e.name === 'sourcing.search-completed');
      expect(completed?.data).toEqual({
        candidateId,
        sourcingComparisonId: head.id,
        stepRunId: step.currentStepRunId,
        rowCount: 28,
        exploreMode: true,
      });
      expect(completed?.candidateId).toBe(candidateId);

      // 요청: 규칙 1 파라미터 + 키(URL에만), 호스트 openapi.rakuten.co.jp. ② 첫 검색은 관련도 순(D-47 — 상품 고르기 목록)
      const call = server.callsOf('SEARCH')[0]!;
      expect(new URL(call.url).host).toBe('openapi.rakuten.co.jp');
      expect(call.params).toMatchObject({
        keyword: QUERY,
        genreId: '558885',
        sort: 'standard',
        hits: '30',
        availability: '1',
        imageFlag: '1',
        field: '1',
        formatVersion: '2',
        purchaseType: '0',
        carrier: '0',
        minPrice: '3000',
        NGKeyword: '中古 インソール 靴紐 シューレース 箱のみ キッズ ジュニア ベビー',
        applicationId: KEYS.RAKUTEN_APPLICATION_ID,
        accessKey: KEYS.RAKUTEN_ACCESS_KEY,
      });
      // 기록·캐시에는 키 원문이 없다
      const log = await t.prisma.callLog.findFirstOrThrow({ where: { target: 'RAKUTEN_API' } });
      expect(log.urlMasked).toContain('accessKey=***');
      expect(log.urlMasked).not.toContain(KEYS.RAKUTEN_ACCESS_KEY);
      expect(log.urlMasked).not.toContain(KEYS.RAKUTEN_APPLICATION_ID);
      expect(log.itemCount).toBe(30);
      const cache = await t.prisma.rakutenSearchCache.findFirstOrThrow();
      expect(cache.requestParams).not.toHaveProperty('accessKey');
      expect(cache.requestParams).not.toHaveProperty('applicationId');
      expect(cache.expiresAt.getTime() - cache.fetchedAt.getTime()).toBe(6 * 3_600_000);
    });

    it('같은 검색(다른 후보·다시 실행)은 6시간 캐시를 쓴다(API 0회 더)', async () => {
      const a = await searchCandidate();
      await startSourcing(a).expect(202);
      await idle();
      const b = await searchCandidate();
      await startSourcing(b).expect(202);
      await idle();
      expect(server.callsOf('SEARCH')).toHaveLength(1);
      const step = await sourcingStep(b);
      const rows = await t.prisma.sourcingComparisonRow.count({
        where: { sourcingComparisonId: step.currentStepRun!.sourcingComparison!.id },
      });
      expect(rows).toBe(28);
    });

    it('429·429·200 → 호출 3회(백오프), 호출 사이 ≥ 1.5초', async () => {
      server.answerSearch(
        { status: 429, file: 'status-429.json' },
        { status: 429, file: 'status-429.json' },
      );
      const candidateId = await searchCandidate();
      await startSourcing(candidateId).expect(202);
      await idle();
      const calls = server.callsOf('SEARCH');
      expect(calls).toHaveLength(3);
      for (let i = 1; i < calls.length; i += 1) {
        expect(calls[i]!.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(1500);
      }
      expect((await sourcingStep(candidateId)).status).toBe('WAITING_INPUT');
    });

    it('API 오류는 HTTP 오류가 아니라 ② FAILED(EXTERNAL_API, 원래 코드, 한국어 문구)', async () => {
      server.answerSearch({ status: 403, file: 'err-403-client-ip.json' });
      const candidateId = await searchCandidate();
      await startSourcing(candidateId).expect(202);
      await idle();
      const step = await sourcingStep(candidateId);
      expect(step.status).toBe('FAILED');
      expect(step.currentStepRun).toMatchObject({
        failureKind: 'EXTERNAL_API',
        errorCode: 'CLIENT_IP_NOT_ALLOWED',
      });
      expect(step.currentStepRun?.errorMessage).toContain('허용 IP');
      expect(server.callsOf('SEARCH')).toHaveLength(1);
    });

    it('키가 없으면 ② 시작 전 409 SECRET_NOT_CONFIGURED(실행을 만들지 않는다)', async () => {
      const candidateId = await searchCandidate();
      secrets.reset();
      const res = await startSourcing(candidateId);
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'SECRET_NOT_CONFIGURED',
        details: { secretKeys: ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'] },
      });
      expect(await t.prisma.stepRun.count({ where: { candidateId } })).toBe(0);
    });

    it('검색어 형식: 후보 만들기·② 시작(실행 중 입력) 모두 422 RAKUTEN_QUERY_INVALID', async () => {
      const create = await post('/candidates', { creationPath: 'SEARCH_QUERY', rakutenQuery: 'a' });
      expect(create.status).toBe(422);
      expect(errorOf(create).code).toBe('RAKUTEN_QUERY_INVALID');
      const candidateId = await searchCandidate();
      const start = await startSourcing(candidateId, { ownerInputs: { searchKeyword: 'あ' } });
      expect(start.status).toBe(422);
      expect(errorOf(start)).toMatchObject({ code: 'RAKUTEN_QUERY_INVALID' });
      expect(errorOf(start).fieldErrors?.[0]?.field).toBe('ownerInputs.searchKeyword');
      expect(await t.prisma.stepRun.count({ where: { candidateId } })).toBe(0);
    });

    it('실행 중 입력한 검색어로 검색하고 그 버전의 검색어로 남긴다', async () => {
      const candidateId = await searchCandidate();
      await startSourcing(candidateId, {
        ownerInputs: { searchKeyword: 'アシックス ゲルカヤノ' },
      }).expect(202);
      await idle();
      expect(server.callsOf('SEARCH')[0]!.params.keyword).toBe('アシックス ゲルカヤノ');
      const head = (await sourcingStep(candidateId)).currentStepRun!.sourcingComparison!;
      expect(head.searchKeyword).toBe('アシックス ゲルカヤノ');
    });
  });

  // ── 재조회 ───────────────────────────────────────────────────────────────

  describe('POST /candidates/{id}/refetch', () => {
    it('소싱 선택이 없으면 409 SOURCING_SELECTION_REQUIRED, 없는 후보 404', async () => {
      const created = await post('/candidates', {
        creationPath: 'SEARCH_QUERY',
        rakutenQuery: QUERY,
      });
      const id = (created.body as { id: number }).id;
      const res = await post(`/candidates/${id}/refetch`);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('SOURCING_SELECTION_REQUIRED');
      expect(await t.prisma.stepRun.count({ where: { candidateId: id } })).toBe(0);
      const missing = await post('/candidates/999999/refetch');
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('CANDIDATE_NOT_FOUND');
    });

    it('URL 후보: 202 → ② REFETCH 새 버전(페이지 1건 새로, fetch_reason=REFETCH). ③ 이력이 없으면 ③은 돌지 않는다', async () => {
      const { candidateId, fetched } = await urlCandidate('normal', CREAM);
      const before = await sourcingStep(candidateId);
      const res = await post(`/candidates/${candidateId}/refetch`);
      expect(res.status).toBe(202);
      const accepted = res.body as { stepRunId: number; stepCode: string };
      expect(accepted.stepCode).toBe('SOURCING');
      expect(res.headers.location).toBe(`/api/v1/step-runs/${accepted.stepRunId}`);
      await idle();
      const after = await sourcingStep(candidateId);
      expect(after.currentStepRunId).toBe(accepted.stepRunId);
      expect(after.status).toBe('COMPLETED');
      const head = after.currentStepRun!.sourcingComparison!;
      expect(head).toMatchObject({
        action: 'REFETCH',
        baseSourcingComparisonId: before.currentStepRun!.sourcingComparison!.id,
        comparisonPerformed: false,
        anchorInputMethod: 'URL_ITEM',
        shippingSource: 'FREE',
      });
      expect(head.selectedRakutenItemId).not.toBe(fetched.rakutenItem.id);
      const item = await t.prisma.rakutenItem.findUniqueOrThrow({
        where: { id: head.selectedRakutenItemId! },
      });
      expect(item).toMatchObject({ fetchReason: 'REFETCH', itemCode: 'shop-a:10000123' });
      expect(await pageCalls()).toBe(2);
      expect(pricing.calls).toHaveLength(0);
    });

    it('③ 이력이 있으면 ② 뒤 ③을 이어서 실행(execution_mode=STEP) — 재판정이 재고 부족이면 후보 제외', async () => {
      const { candidateId } = await urlCandidate('normal', CREAM);
      await post(`/candidates/${candidateId}/steps/PRICING/runs`).expect(202);
      await idle();
      expect(pricing.calls).toHaveLength(1);

      pricing.next = {
        kind: 'COMPLETED',
        output: {},
        candidateEffects: { exclusion: 'INSUFFICIENT_STOCK' },
      };
      await post(`/candidates/${candidateId}/refetch`).expect(202);
      await idle();
      expect(pricing.calls).toHaveLength(2);
      const second = pricing.calls[1]!;
      expect(second.executionMode).toBe('STEP');
      const current = (await sourcingStep(candidateId)).currentStepRun!.sourcingComparison!;
      // 재판정은 새로 읽은 페이지로
      expect(second.rakutenItemId).toBe(current.selectedRakutenItemId);
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: second.stepRunId } });
      expect(run).toMatchObject({ executionMode: 'STEP', stepChainId: null });
      const candidate = await t.prisma.candidate.findUniqueOrThrow({ where: { id: candidateId } });
      expect(candidate).toMatchObject({ status: 'EXCLUDED', excludedReason: 'INSUFFICIENT_STOCK' });
    });

    it('비교한 버전: 행과 행별 쿠폰·배율을 복사하고 고른 행만 새 스냅샷으로', async () => {
      const created = await post('/candidates', {
        creationPath: 'SEARCH_QUERY',
        rakutenQuery: QUERY,
      });
      const candidateId = (created.body as { id: number }).id;
      await post(`/candidates/${candidateId}/steps/SOURCING/runs`).expect(202);
      await idle();
      const waiting = await sourcingStep(candidateId);
      const head = waiting.currentStepRun!.sourcingComparison!;
      const { rakutenItem } = await fetchItem('normal');
      // P2-03의 앵커·선택 흉내: 입력 대기 중인 버전의 행을 고친 뒤 ②를 완료로 닫는다
      await t.prisma.sourcingComparisonRow.updateMany({
        where: { sourcingComparisonId: head.id, itemCode: 'shop-a:10000123' },
        data: {
          isVerified: true,
          rakutenItemId: rakutenItem.id,
          isSelected: true,
          couponYen: 300,
          shopEventMultiplier: 2,
          shippingYen: 0,
          shippingSource: 'FREE',
        },
      });
      await t.prisma.sourcingComparisonRow.updateMany({
        where: { sourcingComparisonId: head.id, itemCode: 'shop-b:20000456' },
        data: { couponYen: 150 },
      });
      await t.app.get(StepEngineApi).resumeWaiting(waiting.currentStepRunId!, {
        outcome: { kind: 'COMPLETED', output: { action: 'RESUMED' } },
      });
      expect((await sourcingStep(candidateId)).status).toBe('COMPLETED');

      await post(`/candidates/${candidateId}/refetch`).expect(202);
      await idle();
      const after = await sourcingStep(candidateId);
      const next = after.currentStepRun!.sourcingComparison!;
      expect(next).toMatchObject({
        action: 'REFETCH',
        baseSourcingComparisonId: head.id,
        comparisonPerformed: true,
        searchKeyword: QUERY,
      });
      const rows = await t.prisma.sourcingComparisonRow.findMany({
        where: { sourcingComparisonId: next.id },
      });
      expect(rows).toHaveLength(28);
      const selected = rows.find((r) => r.isSelected)!;
      expect(selected).toMatchObject({
        itemCode: 'shop-a:10000123',
        couponYen: 300,
        isVerified: true,
      });
      // 사진 주소(D-47)도 행 복사에 따라온다
      expect(selected.imageUrl).toContain('/shop-a/cabinet/asics-1201a019-108_1.jpg');
      expect(rows.every((r) => r.imageUrl !== null && r.imageUrl.startsWith('https://'))).toBe(
        true,
      );
      expect(selected.shopEventMultiplier.toNumber()).toBe(2);
      expect(selected.rakutenItemId).not.toBe(rakutenItem.id);
      const refetched = await t.prisma.rakutenItem.findUniqueOrThrow({
        where: { id: selected.rakutenItemId! },
      });
      expect(refetched.fetchReason).toBe('REFETCH');
      expect(rows.find((r) => r.itemCode === 'shop-b:20000456')?.couponYen).toBe(150);
      // 앞 버전의 행은 그대로(버전마다 자기완결)
      const oldSelected = await t.prisma.sourcingComparisonRow.findFirstOrThrow({
        where: { sourcingComparisonId: head.id, isSelected: true },
      });
      expect(oldSelected.rakutenItemId).toBe(rakutenItem.id);
    });

    it('하루 상한·24시간 쉼이면 202 전에 409(새 버전을 만들지 않는다)', async () => {
      const { candidateId } = await urlCandidate('normal', CREAM);
      await insertPageLogs(109, t.clock.now());
      const limited = await post(`/candidates/${candidateId}/refetch`);
      expect(limited.status).toBe(409);
      expect(errorOf(limited)).toMatchObject({
        code: 'DAILY_LIMIT_REACHED',
        details: { target: 'RAKUTEN_PAGE' },
      });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      expect(await t.prisma.stepRun.count({ where: { candidateId, stepCode: 'SOURCING' } })).toBe(
        1,
      );

      await truncate(t.prisma, ['call_log']);
      server.answerPage({ status: 429, body: 'Too Many Requests' });
      await post('/rakuten-items', { sourceUrl: PAGE_URLS.normal }).expect(409);
      const blocked = await post(`/candidates/${candidateId}/refetch`);
      expect(blocked.status).toBe(409);
      expect(errorOf(blocked).code).toBe('EXTERNAL_CALL_COOLDOWN');
    });
  });

  // ── 페이지 조회 반복(F-SO-12) ────────────────────────────────────────────

  describe('페이지 조회 반복(관문 RAKUTEN_PAGE 직렬 큐)', () => {
    const LOOP_PAGES: RakutenPageFixture[] = [
      'normal',
      'out-of-genre',
      'no-genre',
      'child-max-235',
    ];

    it('통과 3개면 ENOUGH_CANDIDATES, 읽기 사이 ≥ 3초, 스냅샷은 fetch_reason=SOURCING', async () => {
      const fetcher = t.app.get(RakutenItemFetcher);
      const urls = LOOP_PAGES.map((name) => parseRakutenItemUrl(PAGE_URLS[name])!);
      const result = await runPageFetchLoop({
        rows: urls.map((_, i) => ({
          rowId: i + 1,
          anchorMatch: 'MATCH',
          apiItemPriceMin3Yen: 10_000 + i,
          apiItemPriceYen: 10_000 + i,
          apiPostageFlag: 0,
          searchRank: i + 1,
        })),
        targetPassed: 3,
        maxPages: 10,
        defaultShippingYen: 800,
        fetchPage: async (row) => ({
          kind: 'FETCHED',
          snapshot: await fetcher.fetchSnapshot(urls[row.rowId - 1]!, {
            entrySource: 'API',
            fetchReason: 'SOURCING',
          }),
        }),
        judgeStock: () => true,
      });
      expect(result).toMatchObject({
        fetchedCount: 3,
        passedCount: 3,
        stopReason: 'ENOUGH_CANDIDATES',
      });
      const pages = server.callsOf('PAGE');
      expect(pages).toHaveLength(3);
      for (let i = 1; i < pages.length; i += 1) {
        expect(pages[i]!.at - pages[i - 1]!.at).toBeGreaterThanOrEqual(3000);
      }
      const reasons = await t.prisma.rakutenItem.findMany({
        select: { fetchReason: true, entrySource: true },
      });
      expect(reasons.every((r) => r.fetchReason === 'SOURCING' && r.entrySource === 'API')).toBe(
        true,
      );
    });

    it('두 번째 페이지가 403이면 BLOCKED로 멈추고 더 보내지 않는다', async () => {
      const fetcher = t.app.get(RakutenItemFetcher);
      const urls = LOOP_PAGES.map((name) => parseRakutenItemUrl(PAGE_URLS[name])!);
      server.answerPageAt(PAGE_URLS['out-of-genre'], { status: 403, body: 'Forbidden' });
      const result = await runPageFetchLoop({
        rows: urls.map((_, i) => ({
          rowId: i + 1,
          anchorMatch: 'MATCH',
          apiItemPriceMin3Yen: 10_000 + i,
          apiItemPriceYen: null,
          apiPostageFlag: 0,
          searchRank: i + 1,
        })),
        targetPassed: 3,
        maxPages: 10,
        defaultShippingYen: 800,
        fetchPage: async (row) => ({
          kind: 'FETCHED',
          snapshot: await fetcher.fetchSnapshot(urls[row.rowId - 1]!, {
            entrySource: 'API',
            fetchReason: 'SOURCING',
          }),
        }),
        judgeStock: () => false,
      });
      expect(result).toMatchObject({ fetchedCount: 1, stopReason: 'BLOCKED' });
      expect(server.callsOf('PAGE')).toHaveLength(2);
    });
  });
});
