import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { writeSettingsFileAtomically } from '../../src/modules/settings/settings-file.loader.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import {
  LEAF,
  RUNNING_GENRE,
  SNEAKER_GENRE_ID,
  seedCategoryCandidate,
  seedCommerceCategories,
  settingsWithMapping,
  truncateCategory,
  type CategorySeedInput,
} from '../fixtures/category/seed-candidate.js';
import { insertStepRun } from '../fixtures/step-engine/step-run.factory.js';
import { createTestApp, truncate, type TestApp } from '../helpers/test-app.js';
import { FakeTagsRunnerModule } from '../support/fake-tags-runner.js';

const DATA_DIR = process.env.APP_DATA_DIR!;

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

interface OptionBody {
  leafCategoryId: string;
  wholeCategoryName: string;
  kcExemptionRequired: boolean;
  blocked: boolean;
  blockReason: string | null;
}

interface DecisionBody {
  id: number;
  stepRunId: number;
  candidateId: number;
  version: number;
  stepStatus: string;
  isCurrent: boolean;
  inputGenreId: number | null;
  inputProductType: string | null;
  gender: string;
  genderChangedInRun: boolean;
  candidateSource: string;
  categoryOptions: OptionBody[];
  leafCategoryId: string | null;
  wholeCategoryName: string | null;
  genderPathMatch: boolean | null;
  exceptionalCategories: unknown;
  exceptionDecision: string | null;
  blockReason: string | null;
  kcExemptAdultConfirmedAt: string | null;
  certificationExcludeContent: unknown;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SelectionBody {
  categoryDecisionId: number;
  stepRunId: number;
  candidateId: number;
  stepStatus: string;
  leafCategoryId: string;
  wholeCategoryName: string;
  exceptionDecision: string;
  kcExemptAdultConfirmedAt: string | null;
  decidedAt: string;
  staleDownstreamSteps: string[];
}

/** 05-2 CategoryDecisionDetail required + 선택 칸(P2-06이 늘 주는 것) */
const DETAIL_KEYS = [
  'id',
  'stepRunId',
  'candidateId',
  'version',
  'stepStatus',
  'isCurrent',
  'inputGenreId',
  'inputProductType',
  'gender',
  'genderChangedInRun',
  'candidateSource',
  'categoryOptions',
  'leafCategoryId',
  'wholeCategoryName',
  'genderPathMatch',
  'exceptionalCategories',
  'exceptionDecision',
  'blockReason',
  'kcExemptAdultConfirmedAt',
  'certificationExcludeContent',
  'decidedAt',
  'createdAt',
  'updatedAt',
].sort();

describe('④ 카테고리(P2-06) e2e — autostore_test·실제 CATEGORY 실행기(메타 캐시 fixture, 가짜 ⑦)', () => {
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
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const runCategory = (candidateId: number) =>
    post(`/candidates/${candidateId}/steps/CATEGORY/runs`, {});
  const decisionOf = async (candidateId: number, query = ''): Promise<DecisionBody> => {
    const res = await get(`/candidates/${candidateId}/category-decision${query}`);
    expect(res.status).toBe(200);
    return res.body as DecisionBody;
  };
  const select = (decisionId: number, body: object) =>
    put(`/category-decisions/${decisionId}/selection`, body);
  const stepRow = (candidateId: number, stepCode: string) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode } },
    });
  const categoryAudit = (candidateId: number) =>
    t.prisma.userActionLog.findMany({
      where: { candidateId, eventType: 'CATEGORY_DECISION' },
      orderBy: { id: 'asc' },
    });
  /** ② 완료 후보 → ④ 실행 → 입력 대기까지 */
  const waitingDecision = async (input: CategorySeedInput = {}) => {
    const seed = await seedCategoryCandidate(t.prisma, input);
    const res = await runCategory(seed.candidate.id);
    expect(res.status).toBe(202);
    await idle();
    const decision = await decisionOf(seed.candidate.id);
    expect(decision.stepStatus).toBe('WAITING_INPUT');
    return { seed, decision, runId: (res.body as { stepRunId: number }).stepRunId };
  };

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, settingsWithMapping());
    t = await createTestApp({ imports: [FakeTagsRunnerModule] });
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await idle();
    await truncateCategory(t.prisma);
    await seedCommerceCategories(t.prisma);
    events.length = 0;
  });

  afterAll(async () => {
    await idle();
    await truncateCategory(t.prisma);
    unsubscribe();
    await t.app.close();
  });

  describe('POST …/steps/CATEGORY/runs — 시작 조건(규칙 1·2)', () => {
    it('리프 캐시가 비었으면 409 COMMERCE_META_NOT_SYNCED(details.target=CATEGORY) — 실행을 만들지 않는다', async () => {
      await truncate(t.prisma, ['commerce_category']);
      const seed = await seedCategoryCandidate(t.prisma);
      const res = await runCategory(seed.candidate.id);
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'COMMERCE_META_NOT_SYNCED',
        message:
          "네이버 카테고리 정보가 아직 없습니다. 시스템 상태에서 '지금 동기화'를 눌러 주세요.",
        details: { target: 'CATEGORY' },
      });
      expect(await t.prisma.stepRun.count({ where: { stepCode: 'CATEGORY' } })).toBe(0);
    });

    it('성별 없는 후보 → 409 STEP_START_CONDITION_UNMET(fieldErrors candidate.gender). ③ 완료는 필요 없다', async () => {
      const seed = await seedCategoryCandidate(t.prisma, { gender: null });
      const res = await runCategory(seed.candidate.id);
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('STEP_START_CONDITION_UNMET');
      expect(errorOf(res).fieldErrors?.map((f) => f.field)).toEqual(['candidate.gender']);
      // 성별이 있으면 ③ 없이도 돈다(PRICING NOT_RUN)
      const male = await seedCategoryCandidate(t.prisma);
      expect((await runCategory(male.candidate.id)).status).toBe(202);
      await idle();
      expect((await stepRow(male.candidate.id, 'PRICING')).status).toBe('NOT_RUN');
    });
  });

  describe('GET …/category-decision — 조회(규칙 5·15)', () => {
    it('실행 전 404 STEP_OUTPUT_NOT_FOUND(details.stepCode=CATEGORY) · stepRunId 형식 422 · 없는 후보 404 · ③ 실행 id 422', async () => {
      const seed = await seedCategoryCandidate(t.prisma, { steps: { PRICING: 'COMPLETED' } });
      const before = await get(`/candidates/${seed.candidate.id}/category-decision`);
      expect(before.status).toBe(404);
      expect(errorOf(before)).toMatchObject({
        code: 'STEP_OUTPUT_NOT_FOUND',
        message: '아직 ④ 카테고리를 실행하지 않았습니다.',
        details: { stepCode: 'CATEGORY' },
      });
      expect(
        (await get(`/candidates/${seed.candidate.id}/category-decision?stepRunId=abc`)).status,
      ).toBe(422);
      expect((await get(`/candidates/${seed.candidate.id}/category-decision?sort=x`)).status).toBe(
        422,
      );
      expect((await get('/candidates/999999/category-decision')).status).toBe(404);
      const pricingRunId = seed.stepRunIds.PRICING!;
      const wrong = await get(
        `/candidates/${seed.candidate.id}/category-decision?stepRunId=${pricingRunId}`,
      );
      expect(wrong.status).toBe(422);
      expect(errorOf(wrong).code).toBe('INVALID_QUERY_PARAMETER');
      expect(
        (await get(`/candidates/${seed.candidate.id}/category-decision?stepRunId=999999`)).status,
      ).toBe(404);
    });

    it('실행 → 202 → SSE 입력 대기(CATEGORY_SELECTION_REQUIRED) · categoryOptions 2개(KC 리프 kcExemptionRequired, 아동 리프 없음)', async () => {
      const { seed, decision, runId } = await waitingDecision();
      const waiting = events.find(
        (e) =>
          e.name === 'step-run.status-changed' &&
          (e.data as { status?: string; stepCode?: string }).stepCode === 'CATEGORY' &&
          (e.data as { status?: string }).status === 'WAITING_INPUT',
      );
      expect(waiting?.data).toMatchObject({
        stepRunId: runId,
        waitingReasonCode: 'CATEGORY_SELECTION_REQUIRED',
        pendingInputs: ['owner.categorySelection'],
      });
      expect(Object.keys(decision).sort()).toEqual(DETAIL_KEYS);
      expect(decision).toMatchObject({
        stepRunId: runId,
        candidateId: seed.candidate.id,
        version: 1,
        isCurrent: true,
        inputGenreId: RUNNING_GENRE.genreId,
        inputProductType: null,
        gender: 'MALE',
        genderChangedInRun: false,
        candidateSource: 'MAPPING',
        leafCategoryId: null,
        wholeCategoryName: null,
        exceptionDecision: null,
        decidedAt: null,
      });
      expect(decision.categoryOptions).toEqual([
        {
          leafCategoryId: LEAF.MALE_RUNNING,
          wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
          kcExemptionRequired: false,
          blocked: false,
          blockReason: null,
        },
        {
          leafCategoryId: LEAF.MALE_WALKING_KC,
          wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
          kcExemptionRequired: true,
          blocked: false,
          blockReason: null,
        },
      ]);
      // jsonb에는 id·이름만(예외 표시는 조회 때 계산)
      const row = await t.prisma.categoryDecision.findUniqueOrThrow({ where: { id: decision.id } });
      expect(row.categoryOptions).toEqual([
        { leafCategoryId: LEAF.MALE_RUNNING, wholeCategoryName: '패션잡화>남성신발>운동화>러닝화' },
        {
          leafCategoryId: LEAF.MALE_WALKING_KC,
          wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
        },
      ]);
    });

    it('장르 없는 URL 후보 → GENDER_PATH_ALL(성별 경로 리프 전체, 아동 없음, 제외 품목은 blocked·CON08_EXCLUDED)', async () => {
      const { decision } = await waitingDecision({ genre: null });
      expect(decision.candidateSource).toBe('GENDER_PATH_ALL');
      expect(decision.inputGenreId).toBeNull();
      const ids = decision.categoryOptions.map((o) => o.leafCategoryId);
      expect(ids.sort()).toEqual(
        [
          LEAF.MALE_RUNNING,
          LEAF.MALE_WALKING_KC,
          LEAF.MALE_SNEAKERS,
          LEAF.MALE_WHEELED_EXCLUDED,
        ].sort(),
      );
      expect(
        decision.categoryOptions.find((o) => o.leafCategoryId === LEAF.MALE_WHEELED_EXCLUDED),
      ).toMatchObject({ blocked: true, blockReason: 'CON08_EXCLUDED' });
    });
  });

  describe('PUT /category-decisions/{id}/selection — 고르기(규칙 7·10·12·13)', () => {
    it('목록 밖 422 → KC 리프 확인 없음 409 → 확인 true 200 KC_EXEMPT(후보 리프·감사·DB 조각) → 다시 PUT 409', async () => {
      const { seed, decision, runId } = await waitingDecision();
      const outside = await select(decision.id, { leafCategoryId: LEAF.MALE_SNEAKERS });
      expect(outside.status).toBe(422);
      expect(errorOf(outside)).toMatchObject({
        code: 'CATEGORY_NOT_IN_OPTIONS',
        message: '보여 드린 목록에 없는 카테고리입니다.',
      });

      const noKc = await select(decision.id, { leafCategoryId: LEAF.MALE_WALKING_KC });
      expect(noKc.status).toBe(409);
      expect(errorOf(noKc)).toMatchObject({
        code: 'KC_EXEMPT_CONFIRMATION_REQUIRED',
        message: "KC 인증 예외 카테고리입니다. 'KC 면제 성인용 확인'을 체크해 주세요.",
      });
      expect(await categoryAudit(seed.candidate.id)).toHaveLength(0);

      const ok = await select(decision.id, {
        leafCategoryId: LEAF.MALE_WALKING_KC,
        kcExemptAdultConfirmed: true,
      });
      expect(ok.status).toBe(200);
      const body = ok.body as SelectionBody;
      expect(body).toMatchObject({
        categoryDecisionId: decision.id,
        stepRunId: runId,
        candidateId: seed.candidate.id,
        stepStatus: 'COMPLETED',
        leafCategoryId: LEAF.MALE_WALKING_KC,
        wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
        exceptionDecision: 'KC_EXEMPT',
        staleDownstreamSteps: [],
      });
      expect(body.kcExemptAdultConfirmedAt).not.toBeNull();
      expect(body.decidedAt).toBe(body.kcExemptAdultConfirmedAt);

      const row = await t.prisma.categoryDecision.findUniqueOrThrow({ where: { id: decision.id } });
      expect(row).toMatchObject({
        leafCategoryId: LEAF.MALE_WALKING_KC,
        genderPathMatch: true,
        exceptionDecision: 'KC_EXEMPT',
        exceptionalCategories: ['KC_CERTIFICATION'],
        certificationExcludeContent: {
          kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
          kcExemptionType: 'OVERSEAS',
        },
      });
      const candidate = await t.prisma.candidate.findUniqueOrThrow({
        where: { id: seed.candidate.id },
      });
      expect(candidate).toMatchObject({
        leafCategoryId: LEAF.MALE_WALKING_KC,
        wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
      });
      expect((await stepRow(seed.candidate.id, 'CATEGORY')).status).toBe('COMPLETED');
      const audit = await categoryAudit(seed.candidate.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        stepRunId: runId,
        stepCode: 'CATEGORY',
        detail: {
          decision: 'KC_EXEMPT',
          leafCategoryId: LEAF.MALE_WALKING_KC,
          kcExemptAdultConfirmed: true,
        },
      });

      const after = await decisionOf(seed.candidate.id);
      expect(after).toMatchObject({
        stepStatus: 'COMPLETED',
        exceptionDecision: 'KC_EXEMPT',
        kcExemptAdultConfirmedAt: body.kcExemptAdultConfirmedAt,
      });

      const again = await select(decision.id, { leafCategoryId: LEAF.MALE_RUNNING });
      expect(again.status).toBe(409);
      expect(errorOf(again).code).toBe('STEP_RUN_NOT_WAITING_INPUT');
    });

    it('통과(PASS): 성별 경로 전체 목록에서 스니커즈 → 200 PASS, KC 칸 null', async () => {
      const { seed, decision } = await waitingDecision({ genre: null });
      const res = await select(decision.id, {
        leafCategoryId: LEAF.MALE_SNEAKERS,
        kcExemptAdultConfirmed: true,
      });
      expect(res.status).toBe(200);
      expect(res.body as SelectionBody).toMatchObject({
        exceptionDecision: 'PASS',
        kcExemptAdultConfirmedAt: null,
      });
      const row = await t.prisma.categoryDecision.findUniqueOrThrow({ where: { id: decision.id } });
      expect(row.certificationExcludeContent).toBeNull();
      expect(row.kcExemptAdultConfirmedAt).toBeNull();
      expect((await categoryAudit(seed.candidate.id))[0]?.detail).toMatchObject({
        decision: 'PASS',
        candidateSource: 'GENDER_PATH_ALL',
      });
    });

    it('막힌 리프를 넣은 결정 fixture: 아동·어린이 인증·제외 품목·반대 성별 → 409 각각, 감사(BLOCKED) 1행씩, 결정은 입력 대기 그대로', async () => {
      const seed = await seedCategoryCandidate(t.prisma);
      const run = await insertStepRun(t.prisma, {
        candidateId: seed.candidate.id,
        stepCode: 'CATEGORY',
        status: 'WAITING_INPUT',
      });
      const fixture = await t.prisma.categoryDecision.create({
        data: {
          stepRunId: run.id,
          inputGenreId: RUNNING_GENRE.genreId,
          gender: 'MALE',
          candidateSource: 'MAPPING',
          categoryOptions: [
            LEAF.MALE_JUNIOR_CHILD_PATH,
            LEAF.MALE_CHILD_CERTIFICATION,
            LEAF.MALE_WHEELED_EXCLUDED,
            LEAF.FEMALE_RUNNING,
          ].map((id) => ({ leafCategoryId: id, wholeCategoryName: `fixture ${id}` })),
        },
      });
      const view = await decisionOf(seed.candidate.id);
      expect(view.categoryOptions.map((o) => [o.blocked, o.blockReason])).toEqual([
        [true, 'CHILD_CATEGORY'],
        [true, 'CHILD_CERTIFICATION'],
        [true, 'CON08_EXCLUDED'],
        [true, 'GENDER_MISMATCH'],
      ]);
      const cases: [string, string, string][] = [
        [
          LEAF.MALE_JUNIOR_CHILD_PATH,
          'CATEGORY_CHILD_BLOCKED',
          '아동 카테고리는 고를 수 없습니다.',
        ],
        [
          LEAF.MALE_CHILD_CERTIFICATION,
          'CATEGORY_CHILD_BLOCKED',
          '아동 카테고리는 고를 수 없습니다.',
        ],
        [LEAF.MALE_WHEELED_EXCLUDED, 'CATEGORY_EXCLUDED_ITEM', '판매 제외 품목 카테고리입니다.'],
        [
          LEAF.FEMALE_RUNNING,
          'CATEGORY_GENDER_MISMATCH',
          '후보 성별과 카테고리(남성·여성)가 맞지 않습니다.',
        ],
      ];
      for (const [leafCategoryId, code, message] of cases) {
        const res = await select(fixture.id, { leafCategoryId, kcExemptAdultConfirmed: true });
        expect([leafCategoryId, res.status, errorOf(res).code, errorOf(res).message]).toEqual([
          leafCategoryId,
          409,
          code,
          message,
        ]);
      }
      const audit = await categoryAudit(seed.candidate.id);
      expect(audit.map((a) => (a.detail as { blockReason: string }).blockReason)).toEqual([
        'CHILD_CATEGORY',
        'CHILD_CERTIFICATION',
        'CON08_EXCLUDED',
        'GENDER_MISMATCH',
      ]);
      for (const a of audit) {
        expect(a).toMatchObject({ stepRunId: run.id, stepCode: 'CATEGORY' });
        expect(a.detail).toMatchObject({ decision: 'BLOCKED' });
        expect((a.detail as { reason: string }).reason.length).toBeGreaterThan(0);
      }
      const row = await t.prisma.categoryDecision.findUniqueOrThrow({ where: { id: fixture.id } });
      expect(row).toMatchObject({
        leafCategoryId: null,
        exceptionDecision: null,
        decidedAt: null,
      });
      expect((await t.prisma.stepRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe(
        'WAITING_INPUT',
      );
      expect(
        (await t.prisma.candidate.findUniqueOrThrow({ where: { id: seed.candidate.id } }))
          .leafCategoryId,
      ).toBeNull();
    });

    it('형식: 없는 결정 404 · 경로 id 형식 404 · leafCategoryId 없음 422 · candidateSource SEARCH(M2) 422 · 헤더 없음 403 · 제외 후보 409', async () => {
      const { seed, decision } = await waitingDecision();
      expect((await select(999999, { leafCategoryId: LEAF.MALE_RUNNING })).status).toBe(404);
      const badId = await put('/category-decisions/abc/selection', {
        leafCategoryId: LEAF.MALE_RUNNING,
      });
      expect(badId.status).toBe(404);
      expect(errorOf(badId).code).toBe('CATEGORY_DECISION_NOT_FOUND');
      const missing = await select(decision.id, {});
      expect(missing.status).toBe(422);
      expect(errorOf(missing).code).toBe('VALIDATION_FAILED');
      const search = await select(decision.id, {
        leafCategoryId: LEAF.MALE_RUNNING,
        candidateSource: 'SEARCH',
      });
      expect(search.status).toBe(422);
      expect(errorOf(search).fieldErrors?.[0]?.field).toBe('candidateSource');
      const noHeader = await http()
        .put(`/api/v1/category-decisions/${decision.id}/selection`)
        .send({ leafCategoryId: LEAF.MALE_RUNNING });
      expect(noHeader.status).toBe(403);

      await t.prisma.candidate.update({
        where: { id: seed.candidate.id },
        data: { status: 'EXCLUDED', excludedReason: 'OWNER_EXCLUDED' },
      });
      const excluded = await select(decision.id, { leafCategoryId: LEAF.MALE_RUNNING });
      expect(excluded.status).toBe(409);
      expect(errorOf(excluded).code).toBe('CANDIDATE_EXCLUDED');
    });

    it('⑦을 먼저 완료한 후보 → staleDownstreamSteps=["TAGS"], ⑦ RERUN_REQUIRED(category.leafPath), ③은 그대로', async () => {
      const { seed, decision } = await waitingDecision({
        steps: { PRICING: 'COMPLETED', TAGS: 'COMPLETED' },
      });
      const res = await select(decision.id, { leafCategoryId: LEAF.MALE_RUNNING });
      expect(res.status).toBe(200);
      expect((res.body as SelectionBody).staleDownstreamSteps).toEqual(['TAGS']);
      expect(await stepRow(seed.candidate.id, 'TAGS')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['category.leafPath'],
      });
      expect((await stepRow(seed.candidate.id, 'PRICING')).status).toBe('COMPLETED');
      expect((await stepRow(seed.candidate.id, 'CATEGORY')).status).toBe('COMPLETED');
    });

    it('후보가 하나이고 막힘·KC가 없으면 곧바로 완료(Proposed) — 후보 리프·감사(PASS, auto)', async () => {
      const seed = await seedCategoryCandidate(t.prisma, {
        genre: {
          genreId: SNEAKER_GENRE_ID,
          genrePath: `558885:靴 > 110983:メンズ靴 > ${SNEAKER_GENRE_ID}:スニーカー`,
        },
      });
      expect((await runCategory(seed.candidate.id)).status).toBe(202);
      await idle();
      const decision = await decisionOf(seed.candidate.id);
      expect(decision).toMatchObject({
        stepStatus: 'COMPLETED',
        candidateSource: 'MAPPING',
        leafCategoryId: LEAF.MALE_SNEAKERS,
        exceptionDecision: 'PASS',
        genderPathMatch: true,
      });
      expect(decision.categoryOptions).toHaveLength(1);
      expect(
        (await t.prisma.candidate.findUniqueOrThrow({ where: { id: seed.candidate.id } }))
          .leafCategoryId,
      ).toBe(LEAF.MALE_SNEAKERS);
      const audit = await categoryAudit(seed.candidate.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]?.detail).toMatchObject({ decision: 'PASS', auto: true });
    });
  });

  describe('성별 재확인(F-CA-05, 규칙 14) — PUT /candidates/{id}/gender', () => {
    it('④ 입력 대기 중 FEMALE → 같은 실행 결정 gender·genderChangedInRun·여성 후보, ③·⑥-3·⑦ 재실행 필요, ④는 입력 대기 → 고르면 COMPLETED', async () => {
      const { seed, decision, runId } = await waitingDecision({
        steps: { PRICING: 'COMPLETED', NOTICE_HTML: 'COMPLETED', TAGS: 'COMPLETED' },
      });
      // 같은 성별은 아무것도 하지 않는다(출처만 OWNER로)
      const same = await put(`/candidates/${seed.candidate.id}/gender`, { gender: 'MALE' });
      expect(same.status).toBe(200);
      expect((await decisionOf(seed.candidate.id)).genderChangedInRun).toBe(false);

      const res = await put(`/candidates/${seed.candidate.id}/gender`, { gender: 'FEMALE' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        changed: true,
        genderSource: 'OWNER',
        affectedSteps: ['PRICING', 'NOTICE_HTML', 'TAGS'],
      });
      expect((res.body as { resumedStepRunIds: number[] }).resumedStepRunIds).toContain(runId);

      const rechecked = await decisionOf(seed.candidate.id);
      expect(rechecked).toMatchObject({
        id: decision.id,
        stepRunId: runId,
        stepStatus: 'WAITING_INPUT',
        gender: 'FEMALE',
        genderChangedInRun: true,
        candidateSource: 'MAPPING',
      });
      expect(rechecked.categoryOptions.map((o) => o.leafCategoryId)).toEqual([
        LEAF.FEMALE_RUNNING,
        LEAF.FEMALE_WALKING,
      ]);
      for (const code of ['PRICING', 'NOTICE_HTML', 'TAGS']) {
        expect((await stepRow(seed.candidate.id, code)).status).toBe('RERUN_REQUIRED');
      }
      expect((await stepRow(seed.candidate.id, 'CATEGORY')).status).toBe('WAITING_INPUT');
      // 이 실행의 입력 기록(candidate.gender)이 새 값·오너 출처로 바뀌었다
      const genderInput = await t.prisma.stepRunInput.findFirstOrThrow({
        where: { stepRunId: runId, inputKey: 'candidate.gender' },
      });
      expect(genderInput).toMatchObject({ sourceType: 'OWNER_INPUT', sourceStepRunId: null });

      const picked = await select(decision.id, { leafCategoryId: LEAF.FEMALE_RUNNING });
      expect(picked.status).toBe(200);
      expect(picked.body as SelectionBody).toMatchObject({
        stepStatus: 'COMPLETED',
        exceptionDecision: 'PASS',
      });
      expect(await stepRow(seed.candidate.id, 'CATEGORY')).toMatchObject({
        status: 'COMPLETED',
        staleInputs: [],
      });
      expect(
        (await t.prisma.stepRun.findUniqueOrThrow({ where: { id: runId } })).rerunReasonInputs,
      ).toEqual([]);
    });
  });

  describe('완료 뒤 바꾸기(규칙 15)', () => {
    it('완료된 category_decision UPDATE → 트리거 오류(category_decision_frozen) · 이전 버전은 ?stepRunId=로 본다', async () => {
      const { seed, decision, runId } = await waitingDecision();
      expect((await select(decision.id, { leafCategoryId: LEAF.MALE_RUNNING })).status).toBe(200);
      await expect(
        t.prisma.$executeRawUnsafe(
          `UPDATE category_decision SET leaf_category_id = '${LEAF.MALE_SNEAKERS}' WHERE id = ${decision.id}`,
        ),
      ).rejects.toThrow(/cannot change/);

      // 다시 실행하면 새 버전(v2, 입력 대기) — 이전 버전은 ?stepRunId=로 그대로
      expect((await runCategory(seed.candidate.id)).status).toBe(202);
      await idle();
      const current = await decisionOf(seed.candidate.id);
      expect(current).toMatchObject({ version: 2, stepStatus: 'WAITING_INPUT', isCurrent: true });
      const previous = await decisionOf(seed.candidate.id, `?stepRunId=${runId}`);
      expect(previous).toMatchObject({
        version: 1,
        isCurrent: false,
        stepStatus: 'COMPLETED',
        leafCategoryId: LEAF.MALE_RUNNING,
      });
    });
  });
});
