import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { ApiException } from '../../src/common/errors/api.exception.js';
import { CandidateGenderService } from '../../src/modules/step-engine/candidates/candidate-gender.service.js';
import { CandidateIdentityService } from '../../src/modules/step-engine/candidates/candidate-identity.service.js';
import { CandidateStatusService } from '../../src/modules/step-engine/candidates/candidate-status.service.js';
import { StepEngineTransactions } from '../../src/modules/step-engine/candidates/step-engine-tx.js';
import { STEP_FLOW } from '../../src/modules/step-engine/domain/steps.js';
import {
  allRequiredCompleted,
  attachUrlSelection,
  createCandidate,
  createRakutenItem,
  SAMPLE,
} from '../fixtures/step-engine/candidate.factory.js';
import { createKeyword } from '../fixtures/step-engine/keyword.factory.js';
import { truncateStepEngine } from '../fixtures/step-engine/truncate.js';
import { createTestApp, TEST_START_MS, type TestApp } from '../helpers/test-app.js';

interface ErrorBody {
  code: string;
  message: string;
  status: number;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

/** 05-2 CandidateDetail의 required 전부(+ P1-04에서 더한 resumeStepCode) */
const CANDIDATE_DETAIL_KEYS = [
  'id',
  'creationPath',
  'status',
  'statusChangedAt',
  'excludedReason',
  'displayName',
  'sourceKeywordId',
  'sourceKeyword',
  'rakutenQuery',
  'sourceUrl',
  'anchorModelCode',
  'anchorItemCode',
  'anchorColorCode',
  'anchorFixedAt',
  'itemCode',
  'selectedColor',
  'gender',
  'genderSource',
  'genderRecheckRequired',
  'leafCategoryId',
  'wholeCategoryName',
  'noComparisonConfirmedAt',
  'locked',
  'pageDataCollectedAt',
  'pageDataStale',
  'gates',
  'approvedAt',
  'openContinuousRun',
  'resumeStepCode',
  'createdAt',
  'updatedAt',
].sort();

/** 05-2 CandidateSummary required */
const CANDIDATE_SUMMARY_KEYS = [
  'id',
  'creationPath',
  'status',
  'statusChangedAt',
  'excludedReason',
  'displayName',
  'rakutenQuery',
  'anchorModelCode',
  'itemCode',
  'selectedColor',
  'gender',
  'resumeStepCode',
  'steps',
  'createdAt',
  'updatedAt',
].sort();

describe('후보 API(step-engine, P1-04) e2e — autostore_test', () => {
  let t: TestApp;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body?: object) => {
    const req = http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1');
    return body ? req.send(body) : req;
  };
  const put = (path: string, body: object) =>
    http().put(`/api/v1${path}`).set('X-AutoStore-Client', '1').send(body);
  const get = (path: string) => http().get(`/api/v1${path}`);
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const historyCount = (candidateId: number) =>
    t.prisma.candidateStatusHistory.count({ where: { candidateId } });

  beforeAll(async () => {
    t = await createTestApp();
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await truncateStepEngine(t.prisma);
    t.clock.ms = TEST_START_MS;
    events.length = 0;
  });

  afterAll(async () => {
    unsubscribe();
    await t.app.close();
  });

  // ── 만들기 ──────────────────────────────────────────────────────────────

  describe('POST /candidates', () => {
    it('SEARCH_QUERY → 201 + Location + WORKING. candidate_step 10행 NOT_RUN(last_version 0), 이력 1행(from NULL, CREATED)', async () => {
      const res = await post('/candidates', {
        creationPath: 'SEARCH_QUERY',
        rakutenQuery: '  アシックス ゲルカヤノ14 ',
      });
      expect(res.status).toBe(201);
      const body = res.body as Record<string, unknown> & { id: number };
      expect(res.headers.location).toBe(`/api/v1/candidates/${body.id}`);
      expect(Object.keys(body).sort()).toEqual(CANDIDATE_DETAIL_KEYS);
      expect(body).toMatchObject({
        creationPath: 'SEARCH_QUERY',
        status: 'WORKING',
        rakutenQuery: 'アシックス ゲルカヤノ14',
        displayName: 'アシックス ゲルカヤノ14',
        excludedReason: null,
        locked: false,
        resumeStepCode: 'SOURCING',
        pageDataCollectedAt: null,
        pageDataStale: false,
        approvedAt: null,
        openContinuousRun: null,
        gates: [
          { gate: 'G2', gatePassId: null, passedAt: null, valid: false },
          { gate: 'G3', gatePassId: null, passedAt: null, valid: false },
        ],
      });

      const steps = await t.prisma.candidateStep.findMany({
        where: { candidateId: body.id },
        orderBy: { id: 'asc' },
      });
      expect(steps.map((s) => s.stepCode)).toEqual([...STEP_FLOW]);
      expect(
        steps.every(
          (s) => s.status === 'NOT_RUN' && s.lastVersion === 0 && s.currentStepRunId === null,
        ),
      ).toBe(true);
      const history = await t.prisma.candidateStatusHistory.findMany({
        where: { candidateId: body.id },
      });
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        fromStatus: null,
        toStatus: 'WORKING',
        reason: 'CREATED',
      });
      // 커밋 뒤 SSE
      expect(
        events.filter((e) => e.name === 'candidate.status-changed').map((e) => e.data),
      ).toEqual([
        expect.objectContaining({
          candidateId: body.id,
          fromStatus: null,
          toStatus: 'WORKING',
          reason: 'CREATED',
        }),
      ]);
    });

    it('KEYWORD: 고른 키워드 → 201(출처 키워드), 없는 id 404, 안 고름 409, 아동화 제외 409', async () => {
      const selected = await createKeyword(t.prisma, {
        state: 'SELECTED',
        keyword: '아식스 젤카야노14',
      });
      const ok = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: selected.id,
        rakutenQuery: 'アシックス ゲルカヤノ14',
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        sourceKeywordId: selected.id,
        sourceKeyword: '아식스 젤카야노14',
      });

      const missing = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: 999999,
        rakutenQuery: 'x',
      });
      expect(missing.status).toBe(404);
      expect(errorOf(missing)).toMatchObject({
        code: 'KEYWORD_NOT_FOUND',
        message: '키워드를 찾을 수 없습니다.',
      });

      const notSelected = await createKeyword(t.prisma, { state: 'NOT_SELECTED' });
      const r1 = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: notSelected.id,
        rakutenQuery: 'x',
      });
      expect(r1.status).toBe(409);
      expect(errorOf(r1).code).toBe('KEYWORD_NOT_SELECTED');

      const child = await createKeyword(t.prisma, { state: 'CHILD_EXCLUDED' });
      const r2 = await post('/candidates', {
        creationPath: 'KEYWORD',
        sourceKeywordId: child.id,
        rakutenQuery: 'x',
      });
      expect(r2.status).toBe(409);
      expect(errorOf(r2).code).toBe('KEYWORD_EXCLUDED');
      expect(await t.prisma.candidate.count()).toBe(1);
    });

    it('검색어 129자 → 422 RAKUTEN_QUERY_INVALID, 빠진 값·다른 경로의 값·DIRECT_INPUT → 422 VALIDATION_FAILED', async () => {
      const long = await post('/candidates', {
        creationPath: 'SEARCH_QUERY',
        rakutenQuery: 'a'.repeat(129),
      });
      expect(long.status).toBe(422);
      expect(errorOf(long)).toMatchObject({ code: 'RAKUTEN_QUERY_INVALID' });
      expect(errorOf(long).fieldErrors?.[0]?.field).toBe('rakutenQuery');
      expect(
        (await post('/candidates', { creationPath: 'SEARCH_QUERY', rakutenQuery: 'a'.repeat(128) }))
          .status,
      ).toBe(201);

      const noQuery = await post('/candidates', { creationPath: 'SEARCH_QUERY' });
      expect(noQuery.status).toBe(422);
      expect(errorOf(noQuery)).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: [expect.objectContaining({ field: 'rakutenQuery' })],
      });
      const keywordNoId = await post('/candidates', { creationPath: 'KEYWORD', rakutenQuery: 'x' });
      expect(errorOf(keywordNoId).fieldErrors?.map((f) => f.field)).toEqual(['sourceKeywordId']);
      const extra = await post('/candidates', {
        creationPath: 'SEARCH_QUERY',
        rakutenQuery: 'x',
        rakutenItemId: 3,
      });
      expect(errorOf(extra)).toMatchObject({ code: 'VALIDATION_FAILED' });
      const direct = await post('/candidates', { creationPath: 'DIRECT_INPUT' });
      expect(direct.status).toBe(422);
      expect(errorOf(direct).fieldErrors?.[0]?.field).toBe('creationPath');
      const unknownPath = await post('/candidates', { creationPath: 'NOPE', rakutenQuery: 'x' });
      expect(errorOf(unknownPath).code).toBe('VALIDATION_FAILED');
      const unknownField = await post('/candidates', {
        creationPath: 'SEARCH_QUERY',
        rakutenQuery: 'x',
        foo: 1,
      });
      expect(errorOf(unknownField).code).toBe('VALIDATION_FAILED');
      expect(await t.prisma.candidate.count()).toBe(1);
    });

    it('X-AutoStore-Client 없음 → 403 CLIENT_HEADER_REQUIRED', async () => {
      const res = await http()
        .post('/api/v1/candidates')
        .send({ creationPath: 'SEARCH_QUERY', rakutenQuery: 'x' });
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('CLIENT_HEADER_REQUIRED');
    });

    it('RAKUTEN_URL: 스냅샷 없음 404, 만들면 itemCode·색상·URL, 진행 중 같은 itemCode+색상은 새 행 없이 409 CANDIDATE_DUPLICATE', async () => {
      const missing = await post('/candidates', {
        creationPath: 'RAKUTEN_URL',
        rakutenItemId: 999999,
        selectedColor: '크림/블랙',
      });
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('RAKUTEN_ITEM_NOT_FOUND');

      const item = await createRakutenItem(t.prisma);
      const ok = await post('/candidates', {
        creationPath: 'RAKUTEN_URL',
        rakutenItemId: item.id,
        selectedColor: '크림/블랙',
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({
        creationPath: 'RAKUTEN_URL',
        status: 'WORKING',
        sourceUrl: item.itemUrl,
        itemCode: SAMPLE.itemCode,
        selectedColor: '크림/블랙',
        rakutenQuery: null,
      });
      const dup = await post('/candidates', {
        creationPath: 'RAKUTEN_URL',
        rakutenItemId: item.id,
        selectedColor: '크림/블랙',
      });
      expect(dup.status).toBe(409);
      expect(errorOf(dup)).toMatchObject({
        code: 'CANDIDATE_DUPLICATE',
        details: { existingCandidateId: (ok.body as { id: number }).id },
      });
      expect(await t.prisma.candidate.count()).toBe(1);
      // 다른 색상은 다른 후보다
      expect(
        (
          await post('/candidates', {
            creationPath: 'RAKUTEN_URL',
            rakutenItemId: item.id,
            selectedColor: '화이트',
          })
        ).status,
      ).toBe(201);
    });
  });

  // ── 목록·상세 ───────────────────────────────────────────────────────────

  describe('GET /candidates · status-counts · resume-target · {candidateId}', () => {
    it('기본 목록은 EXCLUDED·REGISTERED를 빼고, 줄마다 steps 10개와 resumeStepCode', async () => {
      const working = await createCandidate(t.prisma, {
        steps: { SOURCING: 'COMPLETED', PRICING: 'WAITING_INPUT' },
      });
      await createCandidate(t.prisma, { status: 'EXCLUDED' });
      await createCandidate(t.prisma, {
        status: 'REGISTERED',
        steps: { ...allRequiredCompleted(), REGISTER: 'COMPLETED' },
      });
      const awaiting = await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        steps: allRequiredCompleted(),
      });

      const res = await get('/candidates');
      expect(res.status).toBe(200);
      const body = res.body as { content: Record<string, unknown>[]; page: unknown };
      expect(body.page).toEqual({ number: 0, size: 20, totalElements: 2, totalPages: 1 });
      expect(body.content.map((c) => c.id).sort()).toEqual(
        [working.candidate.id, awaiting.candidate.id].sort(),
      );
      for (const row of body.content) {
        expect(Object.keys(row).sort()).toEqual(CANDIDATE_SUMMARY_KEYS);
        expect((row.steps as unknown[]).length).toBe(10);
      }
      const w = body.content.find((c) => c.id === working.candidate.id)!;
      expect(w.resumeStepCode).toBe('PRICING');
      expect((w.steps as { stepCode: string; status: string }[]).slice(0, 2)).toEqual([
        { stepCode: 'SOURCING', status: 'COMPLETED' },
        { stepCode: 'PRICING', status: 'WAITING_INPUT' },
      ]);
      expect(body.content.find((c) => c.id === awaiting.candidate.id)!.resumeStepCode).toBe(
        'REGISTER',
      );
    });

    it('status 여러 값·q 부분 일치·페이지·정렬', async () => {
      const a = await createCandidate(t.prisma, {
        statusChangedAt: new Date(TEST_START_MS - 3000),
        rakutenQuery: 'ニューバランス 530',
      });
      const b = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        statusChangedAt: new Date(TEST_START_MS - 2000),
        itemCode: 'shop-b:20000456',
      });
      const c = await createCandidate(t.prisma, {
        status: 'REGISTERED',
        statusChangedAt: new Date(TEST_START_MS - 1000),
      });

      const filtered = await get('/candidates?status=EXCLUDED&status=WORKING');
      expect((filtered.body as { content: { id: number }[] }).content.map((x) => x.id)).toEqual([
        b.candidate.id,
        a.candidate.id,
      ]);
      const registered = await get('/candidates?status=REGISTERED');
      expect((registered.body as { content: { id: number }[] }).content.map((x) => x.id)).toEqual([
        c.candidate.id,
      ]);

      const q = await get('/candidates?q=%E3%83%8B%E3%83%A5%E3%83%BC');
      expect((q.body as { content: { id: number }[] }).content.map((x) => x.id)).toEqual([
        a.candidate.id,
      ]);
      const qItem = await get('/candidates?q=SHOP-B&status=EXCLUDED');
      expect((qItem.body as { content: { id: number }[] }).content.map((x) => x.id)).toEqual([
        b.candidate.id,
      ]);

      const paged = await get(
        '/candidates?status=WORKING&status=EXCLUDED&status=REGISTERED&size=2&page=1&sort=createdAt,asc',
      );
      expect(paged.body).toMatchObject({
        page: { number: 1, size: 2, totalElements: 3, totalPages: 2 },
        content: [expect.objectContaining({ id: c.candidate.id })],
      });
    });

    it('size=101·sort=foo,asc·알 수 없는 상태·빈 q·모르는 필터 → 422 INVALID_QUERY_PARAMETER', async () => {
      for (const qs of [
        'size=101',
        'sort=foo,asc',
        'status=NOPE',
        'q=',
        'runnableStep=NOPE',
        'foo=1',
        'page=-1',
      ]) {
        const res = await get(`/candidates?${qs}`);
        expect({ qs, status: res.status, code: errorOf(res).code }).toEqual({
          qs,
          status: 422,
          code: 'INVALID_QUERY_PARAMETER',
        });
      }
    });

    it('runnableStep: 그 단계를 지금 실행할 수 있는 후보만(입력 고르기)', async () => {
      const fresh = await createCandidate(t.prisma);
      const sourced = await createCandidate(t.prisma, {
        steps: { SOURCING: 'COMPLETED' },
        gender: 'MALE',
      });
      const busy = await createCandidate(t.prisma, {
        steps: { SOURCING: 'COMPLETED', PRICING: 'RUNNING' },
        gender: 'MALE',
      });
      await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        steps: { SOURCING: 'COMPLETED' },
        gender: 'MALE',
      });
      await createCandidate(t.prisma, {
        status: 'REGISTERING',
        steps: allRequiredCompleted({ REGISTER: 'RUNNING' }),
      });

      const ids = async (qs: string) =>
        ((await get(`/candidates?${qs}`)).body as { content: { id: number }[] }).content
          .map((c) => c.id)
          .sort();
      expect(await ids('runnableStep=PRICING')).toEqual([sourced.candidate.id]);
      expect(await ids('runnableStep=SOURCING')).toEqual(
        [fresh.candidate.id, sourced.candidate.id].sort(),
      );
      expect(await ids('runnableStep=THUMBNAIL')).toEqual(
        [sourced.candidate.id, busy.candidate.id].sort(),
      );
      expect(await ids('runnableStep=UPLOAD')).toEqual([]);
      expect(await ids('runnableStep=REGISTER')).toEqual([]);
    });

    it('status-counts: 상태 8개와 합계', async () => {
      await createCandidate(t.prisma);
      await createCandidate(t.prisma);
      await createCandidate(t.prisma, { status: 'EXCLUDED' });
      await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        steps: allRequiredCompleted(),
      });
      const res = await get('/candidates/status-counts');
      expect(res.status).toBe(200);
      const items = (res.body as { items: { status: string; count: number }[] }).items;
      expect(items.map((i) => i.status)).toEqual([
        'TEMP',
        'WORKING',
        'EXCLUDED',
        'AWAITING_APPROVAL',
        'VALIDATED',
        'REGISTERING',
        'RESULT_CHECK_REQUIRED',
        'REGISTERED',
      ]);
      expect(Object.fromEntries(items.map((i) => [i.status, i.count]))).toMatchObject({
        WORKING: 2,
        EXCLUDED: 1,
        AWAITING_APPROVAL: 1,
        TEMP: 0,
      });
      expect(items.reduce((sum, i) => sum + i.count, 0)).toBe(4);
    });

    it('resume-target: 빈 DB 204, 진행 중 후보 중 최근 전이 순 첫 후보의 첫 단계·대기 게이트', async () => {
      const empty = await get('/candidates/resume-target');
      expect(empty.status).toBe(204);
      expect(empty.text).toBe('');

      await createCandidate(t.prisma, { statusChangedAt: new Date(TEST_START_MS - 5000) });
      const latest = await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        steps: allRequiredCompleted(),
        statusChangedAt: new Date(TEST_START_MS - 1000),
      });
      await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        statusChangedAt: new Date(TEST_START_MS),
      });
      const res = await get('/candidates/resume-target');
      expect(res.status).toBe(200);
      // G2·G3 통과 기록이 없어 ③ 뒤 G2가 대기 게이트다(P1-04 기본 게이트 유효성)
      expect(res.body).toEqual({
        candidateId: latest.candidate.id,
        candidateStatus: 'AWAITING_APPROVAL',
        stepCode: null,
        stepStatus: null,
        gate: 'G2',
      });
      // 아무것도 다시 만들지 않는다
      expect(await t.prisma.stepRun.count()).toBe(9);
    });

    it('GET /candidates/999999 · /abc → 404 CANDIDATE_NOT_FOUND', async () => {
      for (const id of ['999999', 'abc', '0', '99999999999']) {
        const res = await get(`/candidates/${id}`);
        expect(res.status).toBe(404);
        expect(errorOf(res)).toMatchObject({
          code: 'CANDIDATE_NOT_FOUND',
          message: '후보를 찾을 수 없습니다.',
        });
      }
    });

    it('상세: 표시명 = ② 선택 상품명 · 색상, 페이지 데이터 수집 시각·오래됨(설정 6시간), 잠금', async () => {
      const item = await createRakutenItem(t.prisma, {
        collectedAt: new Date(TEST_START_MS - 2 * 3_600_000),
      });
      const fx = await createCandidate(t.prisma, {
        creationPath: 'RAKUTEN_URL',
        itemCode: item.itemCode,
        selectedColor: '크림/블랙',
        steps: { SOURCING: 'COMPLETED' },
      });
      await attachUrlSelection(t.prisma, fx.stepRunIds.SOURCING!, item);

      const fresh = (await get(`/candidates/${fx.candidate.id}`)).body as Record<string, unknown>;
      expect(fresh).toMatchObject({
        displayName: `${SAMPLE.itemName} · 크림/블랙`,
        pageDataCollectedAt: new Date(TEST_START_MS - 2 * 3_600_000).toISOString(),
        pageDataStale: false,
        locked: false,
        resumeStepCode: 'PRICING',
      });
      t.clock.advance(5 * 3_600_000); // 수집 뒤 7시간
      const stale = (await get(`/candidates/${fx.candidate.id}`)).body as Record<string, unknown>;
      expect(stale.pageDataStale).toBe(true);
      // 오래됨은 상태를 바꾸지 않는다
      expect(stale.status).toBe('WORKING');
      const list = (await get('/candidates')).body as { content: { displayName: string }[] };
      expect(list.content[0]?.displayName).toBe(`${SAMPLE.itemName} · 크림/블랙`);

      const locked = await createCandidate(t.prisma, {
        status: 'RESULT_CHECK_REQUIRED',
        steps: allRequiredCompleted({ REGISTER: 'FAILED' }),
      });
      expect(
        ((await get(`/candidates/${locked.candidate.id}`)).body as { locked: boolean }).locked,
      ).toBe(true);
    });
  });

  // ── 제외·다시 작업 ──────────────────────────────────────────────────────

  describe('POST …/exclude · …/reopen', () => {
    it('제외: WORKING → 200 EXCLUDED/OWNER_EXCLUDED + 이력. 다시 → 같은 응답, 이력 수 그대로', async () => {
      const { candidate } = await createCandidate(t.prisma);
      const res = await post(`/candidates/${candidate.id}/exclude`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        candidateId: candidate.id,
        status: 'EXCLUDED',
        excludedReason: 'OWNER_EXCLUDED',
        warnings: [],
        history: {
          fromStatus: 'WORKING',
          toStatus: 'EXCLUDED',
          reason: 'OWNER_EXCLUDED',
          candidateId: candidate.id,
        },
      });
      expect(await historyCount(candidate.id)).toBe(2);
      expect(
        events.filter((e) => e.name === 'candidate.status-changed').map((e) => e.data),
      ).toEqual([
        expect.objectContaining({
          candidateId: candidate.id,
          fromStatus: 'WORKING',
          toStatus: 'EXCLUDED',
          excludedReason: 'OWNER_EXCLUDED',
        }),
      ]);

      const again = await post(`/candidates/${candidate.id}/exclude`);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(res.body);
      expect(await historyCount(candidate.id)).toBe(2);
    });

    it('다른 사유로 제외된 후보의 제외 요청 → 200, 사유 그대로·새 이력 없음(Proposed)', async () => {
      const { candidate } = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        excludedReason: 'INSUFFICIENT_STOCK',
      });
      const res = await post(`/candidates/${candidate.id}/exclude`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'EXCLUDED', excludedReason: 'INSUFFICIENT_STOCK' });
      expect(await historyCount(candidate.id)).toBe(1);
    });

    it('제외: REGISTERING 409 CANDIDATE_LOCKED, VALIDATED 409 CANDIDATE_STATUS_INVALID, RUNNING 단계 409 STEP_LOCKED_BY_RUNNING_STEP', async () => {
      const registering = await createCandidate(t.prisma, {
        status: 'REGISTERING',
        steps: allRequiredCompleted({ REGISTER: 'RUNNING' }),
      });
      const r1 = await post(`/candidates/${registering.candidate.id}/exclude`);
      expect(r1.status).toBe(409);
      expect(errorOf(r1)).toMatchObject({
        code: 'CANDIDATE_LOCKED',
        details: { status: 'REGISTERING' },
      });

      const validated = await createCandidate(t.prisma, {
        status: 'VALIDATED',
        steps: allRequiredCompleted(),
      });
      const r2 = await post(`/candidates/${validated.candidate.id}/exclude`);
      expect(r2.status).toBe(409);
      expect(errorOf(r2)).toMatchObject({
        code: 'CANDIDATE_STATUS_INVALID',
        message: '지금 후보 상태(검증완료)에서는 할 수 없습니다.',
        details: { status: 'VALIDATED', allowed: ['TEMP', 'WORKING', 'AWAITING_APPROVAL'] },
      });

      const running = await createCandidate(t.prisma, { steps: { SOURCING: 'RUNNING' } });
      const r3 = await post(`/candidates/${running.candidate.id}/exclude`);
      expect(r3.status).toBe(409);
      expect(errorOf(r3)).toMatchObject({
        code: 'STEP_LOCKED_BY_RUNNING_STEP',
        message: '② 소싱이 실행 중이라 지금은 할 수 없습니다. 끝난 뒤 다시 해 주세요.',
        details: { stepCode: 'SOURCING' },
      });
      for (const c of [registering, validated, running]) {
        expect(
          (await t.prisma.candidate.findUniqueOrThrow({ where: { id: c.candidate.id } })).status,
        ).not.toBe('EXCLUDED');
        expect(await historyCount(c.candidate.id)).toBe(1);
      }
      // 막힌 요청은 SSE를 보내지 않는다(롤백된 전이)
      expect(events.filter((e) => e.name === 'candidate.status-changed')).toHaveLength(0);
      expect((await post('/candidates/999999/exclude')).status).toBe(404);
    });

    it('다시 작업: → 200 WORKING·excludedReason null·이력 REOPENED. 이미 WORKING이면 같은 응답', async () => {
      const { candidate } = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        excludedReason: 'NOT_SALE_CANDIDATE',
      });
      const res = await post(`/candidates/${candidate.id}/reopen`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'WORKING',
        excludedReason: null,
        warnings: [],
        history: { fromStatus: 'EXCLUDED', toStatus: 'WORKING', reason: 'REOPENED' },
      });
      const row = await t.prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
      expect(row).toMatchObject({ status: 'WORKING', excludedReason: null });
      const again = await post(`/candidates/${candidate.id}/reopen`);
      expect(again.status).toBe(200);
      expect(again.body).toEqual(res.body);
      expect(await historyCount(candidate.id)).toBe(2);
    });

    it('다시 작업: 같은 itemCode+색상 진행 중 → 409 CANDIDATE_DUPLICATE(existingCandidateId), 앵커만 같음 → 200 + 경고', async () => {
      const active = await createCandidate(t.prisma, {
        itemCode: 'shop-a:10000123',
        selectedColor: '크림/블랙',
        anchor: { modelCode: '1201A019108', colorCode: '108' },
      });
      const same = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        itemCode: 'shop-a:10000123',
        selectedColor: '크림/블랙',
        anchor: { modelCode: '1201A019108', colorCode: '108' },
      });
      const dup = await post(`/candidates/${same.candidate.id}/reopen`);
      expect(dup.status).toBe(409);
      expect(errorOf(dup)).toMatchObject({
        code: 'CANDIDATE_DUPLICATE',
        details: { existingCandidateId: active.candidate.id },
      });
      expect(
        (await t.prisma.candidate.findUniqueOrThrow({ where: { id: same.candidate.id } })).status,
      ).toBe('EXCLUDED');

      const anchorOnly = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        itemCode: 'shop-b:20000456',
        selectedColor: '크림/블랙',
        anchor: { modelCode: '1201A019108', colorCode: '108' },
      });
      const ok = await post(`/candidates/${anchorOnly.candidate.id}/reopen`);
      expect(ok.status).toBe(200);
      const warnings = (ok.body as { warnings: { code: string; message: string }[] }).warnings;
      expect(warnings[0]?.code).toBe('ANCHOR_KEY_DUPLICATE');
      expect(warnings[0]?.message).toContain(`#${active.candidate.id}`);
    });

    it('다시 작업: AWAITING_APPROVAL → 409 CANDIDATE_STATUS_INVALID, 잠긴 후보 → 409 CANDIDATE_LOCKED', async () => {
      const awaiting = await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        steps: allRequiredCompleted(),
      });
      const r1 = await post(`/candidates/${awaiting.candidate.id}/reopen`);
      expect(r1.status).toBe(409);
      expect(errorOf(r1)).toMatchObject({
        code: 'CANDIDATE_STATUS_INVALID',
        details: { allowed: ['EXCLUDED'] },
      });
      const registered = await createCandidate(t.prisma, {
        status: 'REGISTERED',
        steps: allRequiredCompleted({ REGISTER: 'COMPLETED' }),
      });
      const r2 = await post(`/candidates/${registered.candidate.id}/reopen`);
      expect(errorOf(r2)).toMatchObject({
        code: 'CANDIDATE_LOCKED',
        details: { status: 'REGISTERED' },
      });
    });

    it('앱 검사를 지나 DB 부분 UNIQUE(23505)에 걸려도 409 CANDIDATE_DUPLICATE로 바꾼다(500으로 새지 않는다)', async () => {
      const active = await createCandidate(t.prisma, {
        itemCode: 'shop-a:10000123',
        selectedColor: '크림/블랙',
      });
      const excluded = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        itemCode: 'shop-a:10000123',
        selectedColor: '크림/블랙',
      });
      const identity = t.app.get(CandidateIdentityService);
      const key = { itemCode: 'shop-a:10000123', selectedColor: '크림/블랙' };
      // 앱 검사 없이 바로 쓰기 → DB가 막는다
      const attempt = identity.withDuplicateMapping(
        key,
        () =>
          t.prisma.candidate.update({
            where: { id: excluded.candidate.id },
            data: { status: 'WORKING', excludedReason: null },
          }),
        excluded.candidate.id,
      );
      await expect(attempt).rejects.toBeInstanceOf(ApiException);
      await expect(
        identity.withDuplicateMapping(
          key,
          () =>
            t.prisma.candidate.update({
              where: { id: excluded.candidate.id },
              data: { status: 'WORKING', excludedReason: null },
            }),
          excluded.candidate.id,
        ),
      ).rejects.toMatchObject({
        code: 'CANDIDATE_DUPLICATE',
        details: { existingCandidateId: active.candidate.id },
      });

      // 동시에 두 제외 후보를 다시 작업: 하나만 된다
      const other = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        itemCode: 'shop-c:1',
        selectedColor: '레드',
      });
      const twin = await createCandidate(t.prisma, {
        status: 'EXCLUDED',
        itemCode: 'shop-c:1',
        selectedColor: '레드',
      });
      const results = await Promise.all([
        post(`/candidates/${other.candidate.id}/reopen`),
        post(`/candidates/${twin.candidate.id}/reopen`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(errorOf(conflict).code).toBe('CANDIDATE_DUPLICATE');
    });
  });

  // ── 성별 ────────────────────────────────────────────────────────────────

  describe('PUT …/gender', () => {
    it('다른 값 → 200 changed·affectedSteps(현재 버전이 있는 PRICING·NOTICE_HTML·TAGS), DB·SSE·감사 기록', async () => {
      const { candidate } = await createCandidate(t.prisma, {
        gender: 'MALE',
        steps: {
          SOURCING: 'COMPLETED',
          PRICING: 'COMPLETED',
          CATEGORY: 'COMPLETED',
          TAGS: 'COMPLETED',
        },
      });
      const res = await put(`/candidates/${candidate.id}/gender`, { gender: 'FEMALE' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        candidateId: candidate.id,
        gender: 'FEMALE',
        genderSource: 'OWNER',
        genderRecheckRequired: false,
        changed: true,
        affectedSteps: ['PRICING', 'TAGS'],
        resumedStepRunIds: [],
      });
      const steps = await t.prisma.candidateStep.findMany({ where: { candidateId: candidate.id } });
      const byCode = Object.fromEntries(steps.map((s) => [s.stepCode, s]));
      expect(byCode.PRICING).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['candidate.gender'],
      });
      expect(byCode.PRICING?.staleSince).not.toBeNull();
      expect(byCode.CATEGORY?.status).toBe('COMPLETED');
      expect(
        events
          .filter((e) => e.name === 'candidate-step.changed')
          .map((e) => (e.data as { stepCode: string }).stepCode),
      ).toEqual(['PRICING', 'TAGS']);
      const audit = await t.prisma.userActionLog.findFirstOrThrow({
        where: { candidateId: candidate.id },
      });
      expect(audit.eventType).toBe('OWNER_EDITED');

      const same = await put(`/candidates/${candidate.id}/gender`, { gender: 'FEMALE' });
      expect(same.body).toMatchObject({ changed: false, affectedSteps: [] });
    });

    it('{"gender":"KID"} → 422 VALIDATION_FAILED, 잠긴 후보 → 409 CANDIDATE_LOCKED, 제외 → 409 CANDIDATE_EXCLUDED, 없는 후보 404', async () => {
      const { candidate } = await createCandidate(t.prisma);
      const kid = await put(`/candidates/${candidate.id}/gender`, { gender: 'KID' });
      expect(kid.status).toBe(422);
      expect(errorOf(kid)).toMatchObject({
        code: 'VALIDATION_FAILED',
        fieldErrors: [expect.objectContaining({ field: 'gender' })],
      });
      expect((await put(`/candidates/${candidate.id}/gender`, { gender: null })).status).toBe(422);

      const locked = await createCandidate(t.prisma, {
        status: 'REGISTERING',
        steps: allRequiredCompleted({ REGISTER: 'RUNNING' }),
      });
      const r1 = await put(`/candidates/${locked.candidate.id}/gender`, { gender: 'FEMALE' });
      expect(r1.status).toBe(409);
      expect(errorOf(r1)).toMatchObject({
        code: 'CANDIDATE_LOCKED',
        details: { status: 'REGISTERING' },
      });
      const excluded = await createCandidate(t.prisma, { status: 'EXCLUDED' });
      expect(
        errorOf(await put(`/candidates/${excluded.candidate.id}/gender`, { gender: 'MALE' })).code,
      ).toBe('CANDIDATE_EXCLUDED');
      expect((await put('/candidates/999999/gender', { gender: 'MALE' })).status).toBe(404);
    });

    it('② 판단 불가(null)를 승인대기 후보에 적용 → ck_candidate_ready 위반 없이 작업중(STEP_NOT_CURRENT) + gender NULL(P2-03용)', async () => {
      const fx = await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        gender: 'MALE',
        genderSource: 'STEP2',
        steps: allRequiredCompleted(),
      });
      const result = await t.app
        .get(StepEngineTransactions)
        .run((scope) =>
          t.app.get(CandidateGenderService).applyStep2Gender(scope, fx.candidate.id, null),
        );
      expect(result).toMatchObject({ gender: null, genderSource: null, changed: true });
      expect(
        await t.prisma.candidate.findUniqueOrThrow({ where: { id: fx.candidate.id } }),
      ).toMatchObject({ status: 'WORKING', gender: null, genderSource: null });
      const last = await t.prisma.candidateStatusHistory.findFirstOrThrow({
        where: { candidateId: fx.candidate.id },
        orderBy: { id: 'desc' },
      });
      expect(last).toMatchObject({
        fromStatus: 'AWAITING_APPROVAL',
        toStatus: 'WORKING',
        reason: 'STEP_NOT_CURRENT',
      });
      expect(await historyCount(fx.candidate.id)).toBe(2);
    });
  });

  // ── 상태 이력·재실행 필요 모아 보기 ─────────────────────────────────────

  describe('GET …/status-history · /candidate-steps', () => {
    it('상태 이력: changedAt desc(기본), 페이지 메타, 없는 후보 404, 허용 밖 정렬 422', async () => {
      const { candidate } = await createCandidate(t.prisma);
      t.clock.advance(1000);
      await post(`/candidates/${candidate.id}/exclude`);
      t.clock.advance(1000);
      await post(`/candidates/${candidate.id}/reopen`);
      const res = await get(`/candidates/${candidate.id}/status-history`);
      expect(res.status).toBe(200);
      const body = res.body as {
        content: { reason: string; fromStatus: string | null }[];
        page: unknown;
      };
      expect(body.content.map((h) => h.reason)).toEqual(['REOPENED', 'OWNER_EXCLUDED', 'CREATED']);
      expect(body.page).toEqual({ number: 0, size: 20, totalElements: 3, totalPages: 1 });
      const asc = await get(`/candidates/${candidate.id}/status-history?sort=changedAt,asc&size=1`);
      expect((asc.body as { content: { reason: string }[] }).content.map((h) => h.reason)).toEqual([
        'CREATED',
      ]);
      expect((await get('/candidates/999999/status-history')).status).toBe(404);
      expect(
        errorOf(await get(`/candidates/${candidate.id}/status-history?sort=id,desc`)).code,
      ).toBe('INVALID_QUERY_PARAMETER');
    });

    it('기본은 RERUN_REQUIRED·FAILED·WAITING_INPUT만(진행 중 후보), stepCode 필터, sort=staleSince,asc', async () => {
      const a = await createCandidate(t.prisma, {
        steps: {
          SOURCING: 'COMPLETED',
          PRICING: 'WAITING_INPUT',
          THUMBNAIL: 'RERUN_REQUIRED',
          COPY: 'RUNNING',
        },
        staleInputs: { THUMBNAIL: ['thumbnail.referenceSelection'] },
        statusChangedAt: new Date(TEST_START_MS - 10_000),
      });
      const b = await createCandidate(t.prisma, {
        steps: { SOURCING: 'FAILED' },
      });
      const c = await createCandidate(t.prisma, {
        steps: { SOURCING: 'COMPLETED', TAGS: 'RERUN_REQUIRED' },
        statusChangedAt: new Date(TEST_START_MS - 20_000),
      });
      await createCandidate(t.prisma, { status: 'EXCLUDED', steps: { SOURCING: 'FAILED' } });

      const res = await get('/candidate-steps');
      expect(res.status).toBe(200);
      const body = res.body as {
        content: {
          candidateId: number;
          stepCode: string;
          status: string;
          staleInputs: string[];
          failureKind: string | null;
          errorMessage: string | null;
          waitingSince: string | null;
        }[];
        page: { totalElements: number };
      };
      expect(body.page.totalElements).toBe(4);
      expect(new Set(body.content.map((r) => r.status))).toEqual(
        new Set(['WAITING_INPUT', 'RERUN_REQUIRED', 'FAILED']),
      );
      const failed = body.content.find((r) => r.candidateId === b.candidate.id)!;
      expect(failed).toMatchObject({
        stepCode: 'SOURCING',
        failureKind: 'EXTERNAL_API',
        errorMessage: expect.any(String) as string,
      });
      const waiting = body.content.find((r) => r.status === 'WAITING_INPUT')!;
      expect(waiting.waitingSince).not.toBeNull();
      expect(body.content.find((r) => r.stepCode === 'THUMBNAIL')?.staleInputs).toEqual([
        'thumbnail.referenceSelection',
      ]);

      const tags = await get('/candidate-steps?stepCode=TAGS');
      expect(
        (tags.body as { content: { candidateId: number }[] }).content.map((r) => r.candidateId),
      ).toEqual([c.candidate.id]);

      // staleSince asc: 재실행 필요가 먼저(오래된 것부터), stale_since 없는 행은 뒤
      const bySince = await get('/candidate-steps?sort=staleSince,asc');
      const rows = (bySince.body as { content: { candidateId: number; status: string }[] }).content;
      expect(rows.slice(0, 2).map((r) => r.candidateId)).toEqual([c.candidate.id, a.candidate.id]);
      expect(rows.slice(2).every((r) => r.status !== 'RERUN_REQUIRED')).toBe(true);

      const running = await get('/candidate-steps?status=RUNNING');
      expect(
        (running.body as { content: { stepCode: string }[] }).content.map((r) => r.stepCode),
      ).toEqual(['COPY']);
      expect(errorOf(await get('/candidate-steps?sort=updatedAt,up')).code).toBe(
        'INVALID_QUERY_PARAMETER',
      );
      expect(errorOf(await get('/candidate-steps?stepCode=NOPE')).code).toBe(
        'INVALID_QUERY_PARAMETER',
      );
    });
  });

  // ── 자동 전환(서비스, 같은 트랜잭션) ────────────────────────────────────

  describe('후보 상태 자동 전환(F-CW-05)', () => {
    const passGates = async (candidateId: number, runs: Partial<Record<string, number>>) => {
      await t.prisma.gatePass.create({
        data: {
          candidateId,
          gate: 'G2',
          fingerprint: 'b'.repeat(64),
          fingerprintBasis: {},
          basisStepRunId: runs.PRICING!,
          basisStepCode: 'PRICING',
        },
      });
      await t.prisma.gatePass.create({
        data: {
          candidateId,
          gate: 'G3',
          fingerprint: 'c'.repeat(64),
          fingerprintBasis: {},
          basisStepRunId: runs.THUMBNAIL!,
          basisStepCode: 'THUMBNAIL',
        },
      });
    };

    it('작업중 + 필수 9단계 완료 + G2·G3 통과 → 승인대기(READY_FOR_APPROVAL), 커밋 뒤 SSE', async () => {
      const fx = await createCandidate(t.prisma, {
        steps: allRequiredCompleted(),
        itemCode: SAMPLE.itemCode,
        anchor: { modelCode: SAMPLE.anchorModelCode, colorCode: SAMPLE.anchorColorCode },
        gender: 'MALE',
        leafCategoryId: SAMPLE.leafCategoryId,
      });
      await passGates(fx.candidate.id, fx.stepRunIds);
      const status = t.app.get(CandidateStatusService);
      const record = await t.app
        .get(StepEngineTransactions)
        .run((scope) => status.reevaluate(scope, fx.candidate.id));
      expect(record).toMatchObject({
        fromStatus: 'WORKING',
        toStatus: 'AWAITING_APPROVAL',
        reason: 'READY_FOR_APPROVAL',
      });
      expect(
        (await t.prisma.candidate.findUniqueOrThrow({ where: { id: fx.candidate.id } })).status,
      ).toBe('AWAITING_APPROVAL');
      expect(events.at(-1)).toMatchObject({
        name: 'candidate.status-changed',
        data: { toStatus: 'AWAITING_APPROVAL' },
      });
      const detail = (await get(`/candidates/${fx.candidate.id}`)).body as {
        gates: { valid: boolean }[];
      };
      expect(detail.gates.map((g) => g.valid)).toEqual([true, true]);
    });

    it('ck_candidate_ready 값(리프 카테고리)이 없으면 승인대기로 올리지 않는다(500 없이 작업중 유지)', async () => {
      const fx = await createCandidate(t.prisma, {
        steps: allRequiredCompleted(),
        itemCode: SAMPLE.itemCode,
        anchor: { modelCode: SAMPLE.anchorModelCode, colorCode: SAMPLE.anchorColorCode },
        gender: 'MALE',
        leafCategoryId: null,
      });
      await passGates(fx.candidate.id, fx.stepRunIds);
      const status = t.app.get(CandidateStatusService);
      const record = await t.app
        .get(StepEngineTransactions)
        .run((scope) => status.reevaluate(scope, fx.candidate.id));
      expect(record).toBeNull();
      expect(
        (await t.prisma.candidate.findUniqueOrThrow({ where: { id: fx.candidate.id } })).status,
      ).toBe('WORKING');
    });

    it('승인대기 + 단계 재실행 필요 → 작업중(STEP_NOT_CURRENT). 트랜잭션이 되돌려지면 상태·이력·SSE 모두 없다', async () => {
      const fx = await createCandidate(t.prisma, {
        status: 'AWAITING_APPROVAL',
        steps: allRequiredCompleted({ TAGS: 'RERUN_REQUIRED' }),
      });
      const status = t.app.get(CandidateStatusService);
      const tx = t.app.get(StepEngineTransactions);
      await expect(
        tx.run(async (scope) => {
          await status.reevaluate(scope, fx.candidate.id);
          throw new Error('되돌림');
        }),
      ).rejects.toThrow('되돌림');
      expect(
        (await t.prisma.candidate.findUniqueOrThrow({ where: { id: fx.candidate.id } })).status,
      ).toBe('AWAITING_APPROVAL');
      expect(events.filter((e) => e.name === 'candidate.status-changed')).toHaveLength(0);

      const record = await tx.run((scope) =>
        status.reevaluate(scope, fx.candidate.id, { exclusion: null }),
      );
      expect(record).toMatchObject({ toStatus: 'WORKING', reason: 'STEP_NOT_CURRENT' });
      expect(await historyCount(fx.candidate.id)).toBe(2);
    });

    it('단계 결과 제외 사유 → EXCLUDED + 같은 excluded_reason', async () => {
      const fx = await createCandidate(t.prisma, {
        steps: { SOURCING: 'COMPLETED', PRICING: 'COMPLETED' },
      });
      const status = t.app.get(CandidateStatusService);
      await t.app.get(StepEngineTransactions).run((scope) =>
        status.reevaluate(scope, fx.candidate.id, {
          stepRunId: fx.stepRunIds.PRICING!,
          exclusion: 'INSUFFICIENT_STOCK',
        }),
      );
      const row = await t.prisma.candidate.findUniqueOrThrow({ where: { id: fx.candidate.id } });
      expect(row).toMatchObject({ status: 'EXCLUDED', excludedReason: 'INSUFFICIENT_STOCK' });
      const history = await t.prisma.candidateStatusHistory.findFirstOrThrow({
        where: { candidateId: fx.candidate.id, reason: 'INSUFFICIENT_STOCK' },
      });
      expect(history.stepRunId).toBe(fx.stepRunIds.PRICING);
    });
  });

  // ── DB 규칙 ─────────────────────────────────────────────────────────────

  describe('DB 규칙(트리거)', () => {
    it('앵커 확정 뒤 raw UPDATE anchor_color_code → 트리거 오류', async () => {
      const { candidate } = await createCandidate(t.prisma, {
        anchor: { modelCode: '1201A019108', colorCode: '108' },
      });
      await expect(
        t.prisma.$executeRawUnsafe(
          `UPDATE candidate SET anchor_color_code = '001' WHERE id = ${candidate.id}`,
        ),
      ).rejects.toThrow(/anchor key is fixed/);
    });

    it('DELETE FROM candidate → 오류, 이력 UPDATE → 오류', async () => {
      const { candidate } = await createCandidate(t.prisma);
      await expect(
        t.prisma.$executeRawUnsafe(`DELETE FROM candidate WHERE id = ${candidate.id}`),
      ).rejects.toThrow(/never deleted/);
      await expect(
        t.prisma.$executeRawUnsafe(
          `UPDATE candidate_status_history SET reason = 'REOPENED' WHERE candidate_id = ${candidate.id}`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        t.prisma.$executeRawUnsafe(
          `DELETE FROM candidate_step WHERE candidate_id = ${candidate.id}`,
        ),
      ).rejects.toThrow(/never deleted/);
    });
  });
});
