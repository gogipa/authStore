import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { FakeImageGenProvider } from '../../src/modules/integrations/image-gen/fake-image-gen.provider.js';
import { IMAGE_GEN_PROVIDER } from '../../src/modules/integrations/image-gen/image-gen.port.js';
import { writeSettingsFileAtomically } from '../../src/modules/settings/settings-file.loader.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { StepEngineApi } from '../../src/modules/step-engine/step-engine.api.js';
import { GenerationRecovery } from '../../src/modules/thumbnails/generation/generation-recovery.js';
import { GenerationWorker } from '../../src/modules/thumbnails/generation/generation.worker.js';
import { referenceSetSha256 } from '../../src/modules/thumbnails/references/reference-set-hash.js';
import { G3_CHECKLIST_VERSION } from '../../src/modules/thumbnails/selection/thumbnail-selection.js';
import { insertStepRun } from '../fixtures/step-engine/step-run.factory.js';
import {
  addExtraOriginals,
  confirmReferences,
  fakeScenario,
  fullChecklist,
} from '../fixtures/thumbnails/seed-thumbnail-generation.js';
import {
  seedThumbnailSourcing,
  seedThumbnailWaiting,
  settingsWithThumbnail,
  thumbnailFetchHandler,
  truncateThumbnails,
  type ThumbnailWaitingSeed,
} from '../fixtures/thumbnails/seed-thumbnail-waiting.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import { FakeUploadRunnerModule, thumbnailSelectionValue } from '../support/fake-upload-runner.js';

const DATA_DIR = process.env.APP_DATA_DIR!;

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

interface AcceptedBody {
  stepRunId: number;
  candidateId: number;
  generationRuns: {
    generationRunId: number;
    slotNo: number;
    attemptNo: number;
    triggerType: string;
    status: string;
  }[];
}

interface SummaryBody {
  generationRunId: number;
  slotNo: number;
  attemptNo: number;
  triggerType: string;
  status: string;
  faceOption: string;
  resultImageAssetId: number | null;
  refusalReason: string | null;
  errorMessage: string | null;
  adopted: boolean;
  prompt?: string;
}

interface OutputBody {
  stepRunId: number;
  candidateId: number;
  version: number;
  stepRunStatus: string;
  isCurrent: boolean;
  references: { imageAssetId: number; sortOrder: number; isSameAnchor: boolean }[];
  referencesConfirmed: boolean;
  candidateCount: number;
  generationRuns: SummaryBody[];
  selection: {
    thumbnailSelectionId: number;
    checklist: Record<string, unknown>;
    sameProductColorConfirmedAt: string | null;
    images: {
      imageAssetId: number;
      generationRunId: number | null;
      role: string;
      sortOrder: number;
    }[];
  } | null;
  g3: { gatePassId: number | null; valid: boolean; changedBasisKeys: string[] };
  sameProductColorRequired: boolean;
}

interface PassBody {
  gatePassId: number;
  gate: string;
  basisStepRunId: number;
  thumbnailSelectionId: number | null;
  thumbnailStepRunId: number | null;
}

describe('⑤ 썸네일 생성·비교·선택 G3(P3-02) e2e — autostore_test·가짜 이미지 생성 공급자', () => {
  let t: TestApp;
  const fake = new FakeImageGenProvider();
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body: object = {}) =>
    http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1').send(body);
  const get = (path: string) => http().get(`/api/v1${path}`);
  const idle = async () => {
    await t.app.get(StepExecutor).whenIdle();
    await t.app.get(GenerationWorker).whenIdle();
  };
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const generate = (stepRunId: number, body: object) =>
    post(`/step-runs/${stepRunId}/generation-runs`, body);
  const passG3 = (candidateId: number, body: object) =>
    post(`/candidates/${candidateId}/gates/G3/pass`, body);
  const genEvents = () =>
    events
      .filter((e) => e.name === 'generation-run.updated')
      .map((e) => e.data as { generationRunId: number; status: string });

  /** ⑤ 입력 대기 + 원본 1·2를 레퍼런스로 확인 */
  const waitingWithRefs = async (): Promise<ThumbnailWaitingSeed> => {
    const seed = await seedThumbnailWaiting(t);
    await confirmReferences(t, seed.thumbnailStepRunId, [
      seed.originals[0]!.id,
      seed.originals[1]!.id,
    ]);
    return seed;
  };

  /** 생성 [1,2] 성공(slot-1.png·slot-2.jpg)까지 → 번호별 결과 이미지 id */
  const generatedPair = async (seed: ThumbnailWaitingSeed) => {
    fake.enqueue(fakeScenario('success'), fakeScenario('success-png-named-jpg'));
    const res = await generate(seed.thumbnailStepRunId, {
      slotNos: [1, 2],
      faceOption: 'FULL_FACE',
    });
    expect(res.status).toBe(202);
    await idle();
    const rows = await t.prisma.generationRun.findMany({
      where: { stepRunId: seed.thumbnailStepRunId },
      orderBy: [{ slotNo: 'asc' }, { attemptNo: 'asc' }],
    });
    const slot1 = rows.find((r) => r.slotNo === 1)!;
    const slot2 = rows.find((r) => r.slotNo === 2)!;
    return { slot1: slot1.resultImageAssetId!, slot2: slot2.resultImageAssetId!, rows };
  };

  /** 생성 중 행을 직접 넣는다(대기열에 넣지 않는다 — 생성 중 상태 만들기) */
  const insertRunning = (stepRunId: number, slotNo: number, attemptNo = 1) =>
    t.prisma.generationRun.create({
      data: {
        stepRunId,
        slotNo,
        attemptNo,
        triggerType: attemptNo === 1 ? 'INITIAL' : 'OWNER_RETRY',
        prompt: 'fixture prompt',
        faceOption: 'FULL_FACE',
        requestedSizePx: 1024,
        provider: 'AGY',
        model: 'fake-image-gen',
        referenceSetSha256: 'a'.repeat(64),
        status: 'RUNNING',
        startedAt: new Date('2026-09-28T00:00:00Z'),
      },
    });

  beforeAll(async () => {
    await writeSettingsFileAtomically(
      DATA_DIR,
      settingsWithThumbnail({ generationTimeoutSeconds: 1 }),
    );
    t = await createTestApp({
      imports: [FakeUploadRunnerModule],
      overrides: [{ provide: IMAGE_GEN_PROVIDER, useValue: fake }],
    });
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await idle();
    await truncateThumbnails(t.prisma);
    t.fetch.reset();
    t.fetch.handler = thumbnailFetchHandler();
    fake.reset();
    events.length = 0;
  });

  afterAll(async () => {
    await idle();
    await truncateThumbnails(t.prisma);
    unsubscribe();
    await t.app.close();
  });

  describe('생성 요청(규칙 1~7)', () => {
    it('{slotNos:[1,2], FULL_FACE} → 202 + Location, 2행 RUNNING → 가짜가 끝나면 SUCCEEDED·GENERATED·PERMITTED, ⑤는 계속 입력 대기', async () => {
      const seed = await waitingWithRefs();
      fake.enqueue(fakeScenario('success'), fakeScenario('success-png-named-jpg'));
      const release = fake.hold();
      const res = await generate(seed.thumbnailStepRunId, {
        slotNos: [2, 1],
        faceOption: 'FULL_FACE',
      });
      expect(res.status).toBe(202);
      const body = res.body as AcceptedBody;
      expect(body).toMatchObject({
        stepRunId: seed.thumbnailStepRunId,
        candidateId: seed.candidate.id,
        generationRuns: [
          { slotNo: 1, attemptNo: 1, triggerType: 'INITIAL', status: 'RUNNING' },
          { slotNo: 2, attemptNo: 1, triggerType: 'INITIAL', status: 'RUNNING' },
        ],
      });
      expect(res.headers.location).toBe(
        `/api/v1/generation-runs/${body.generationRuns[0]!.generationRunId}`,
      );
      const running = await t.prisma.generationRun.findMany({
        where: { stepRunId: seed.thumbnailStepRunId },
        orderBy: { slotNo: 'asc' },
      });
      expect(running.map((r) => r.status)).toEqual(['RUNNING', 'RUNNING']);
      const refs = await t.prisma.thumbnailReference.findMany({
        where: { stepRunId: seed.thumbnailStepRunId },
        include: { imageAsset: true },
      });
      expect(running[0]).toMatchObject({
        promptAdjusted: false,
        faceOption: 'FULL_FACE',
        requestedSizePx: 1024,
        provider: 'AGY',
        model: 'fake-image-gen',
        providerVersion: 'fake-1',
        referenceSetSha256: referenceSetSha256(refs.map((r) => r.imageAsset.sha256)),
        finishedAt: null,
        resultImageAssetId: null,
      });
      expect(running[0]!.prompt).toContain('square 1:1, 1024 pixels');
      expect(running[0]!.prompt).toContain('Model framing: full face.');

      release();
      await idle();
      const done = await t.prisma.generationRun.findMany({
        where: { stepRunId: seed.thumbnailStepRunId },
        orderBy: { slotNo: 'asc' },
        include: { resultImage: true },
      });
      expect(done.map((r) => r.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
      for (const row of done) {
        expect(row.finishedAt).not.toBeNull();
        expect(row.resultImage).toMatchObject({
          kind: 'GENERATED',
          usageRight: 'PERMITTED',
          candidateId: seed.candidate.id,
        });
      }
      // 번호 2: 공급자가 slot-2.jpg 이름으로 PNG를 줬다 → 내용으로 판별해 image/png
      expect(done[1]!.resultImage).toMatchObject({ mimeType: 'image/png', width: 256 });
      expect(fake.calls).toHaveLength(2);
      expect(fake.calls[0]!.referenceImagePaths).toHaveLength(2);
      const run = await t.prisma.stepRun.findUniqueOrThrow({
        where: { id: seed.thumbnailStepRunId },
      });
      expect(run).toMatchObject({ status: 'WAITING_INPUT', aiEngine: null });
      expect(genEvents().map((e) => e.status)).toEqual([
        'RUNNING',
        'RUNNING',
        'SUCCEEDED',
        'SUCCEEDED',
      ]);
    });

    it('레퍼런스 확인 전 → 409 REFERENCES_NOT_CONFIRMED(generation_run 0행)', async () => {
      const seed = await seedThumbnailWaiting(t);
      const res = await generate(seed.thumbnailStepRunId, {
        slotNos: [1],
        faceOption: 'FULL_FACE',
      });
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'REFERENCES_NOT_CONFIRMED',
        message: "레퍼런스 컷을 고르고 '사람·얼굴 없음'을 체크해 주세요.",
      });
      expect(await t.prisma.generationRun.count()).toBe(0);
    });

    it('N=2에서 slotNos:[3]·중복·얼굴 옵션 밖·조정 2001자 → 422 VALIDATION_FAILED', async () => {
      const seed = await waitingWithRefs();
      for (const body of [
        { slotNos: [3], faceOption: 'FULL_FACE' },
        { slotNos: [1, 1], faceOption: 'FULL_FACE' },
        { slotNos: [], faceOption: 'FULL_FACE' },
        { slotNos: [1], faceOption: 'SIDE' },
        { slotNos: [1], faceOption: 'FULL_FACE', promptAdjustment: 'a'.repeat(2001) },
      ]) {
        const res = await generate(seed.thumbnailStepRunId, body);
        expect(res.status).toBe(422);
        expect(errorOf(res).code).toBe('VALIDATION_FAILED');
      }
      expect(await t.prisma.generationRun.count()).toBe(0);
    });

    it('조정 문구에 차단어 → 422 REAL_PERSON_NAME_BLOCKED(서버 재검사, generation_run 0행)', async () => {
      const seed = await waitingWithRefs();
      const res = await generate(seed.thumbnailStepRunId, {
        slotNos: [1],
        faceOption: 'FULL_FACE',
        promptAdjustment: 'make him look like BTS',
      });
      expect(res.status).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: 'REAL_PERSON_NAME_BLOCKED',
        message: '프롬프트에 실존 인물 이름(BTS)이 있어 만들 수 없습니다.',
        details: { blockedTerms: ['BTS'] },
      });
      // 설정 추가분(테스트용 가상 이름)도 막는다
      const extra = await generate(seed.thumbnailStepRunId, {
        slotNos: [1],
        faceOption: 'FULL_FACE',
        promptAdjustment: 'pose like fixture star',
      });
      expect(errorOf(extra).code).toBe('REAL_PERSON_NAME_BLOCKED');
      expect(await t.prisma.generationRun.count()).toBe(0);
    });

    it('같은 번호 생성 중 → 409 ALREADY_IN_PROGRESS(details.job=GENERATION), 다른 번호는 받는다', async () => {
      const seed = await waitingWithRefs();
      await insertRunning(seed.thumbnailStepRunId, 1);
      const busy = await generate(seed.thumbnailStepRunId, {
        slotNos: [1],
        faceOption: 'FULL_FACE',
      });
      expect(busy.status).toBe(409);
      expect(errorOf(busy)).toMatchObject({
        code: 'ALREADY_IN_PROGRESS',
        message: '썸네일 생성이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
        details: { job: 'GENERATION', slotNos: [1] },
      });
      const other = await generate(seed.thumbnailStepRunId, {
        slotNos: [2],
        faceOption: 'FULL_FACE',
      });
      expect(other.status).toBe(202);
      await idle();
    });

    it('⑤ 실행 아님 422 INVALID_STEP_CODE · 없는 실행 404 · 입력 대기 아님 409 STEP_RUN_NOT_WAITING_INPUT', async () => {
      const seed = await waitingWithRefs();
      const body = { slotNos: [1], faceOption: 'FULL_FACE' };
      expect(errorOf(await generate(seed.sourcingStepRunId, body)).code).toBe('INVALID_STEP_CODE');
      const missing = await generate(999_999, body);
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('STEP_RUN_NOT_FOUND');
      await t.app
        .get(StepEngineApi)
        .resumeWaiting(seed.thumbnailStepRunId, { outcome: { kind: 'COMPLETED', output: null } });
      const closed = await generate(seed.thumbnailStepRunId, body);
      expect(closed.status).toBe(409);
      expect(errorOf(closed).code).toBe('STEP_RUN_NOT_WAITING_INPUT');
    });

    it('거부 → REFUSED + refusal_reason, CHIN_CROP으로 다시 → attempt_no=2·OWNER_RETRY·face_option=CHIN_CROP', async () => {
      const seed = await waitingWithRefs();
      fake.enqueue(fakeScenario('refused'), fakeScenario('success'));
      await generate(seed.thumbnailStepRunId, { slotNos: [1], faceOption: 'FULL_FACE' });
      await idle();
      const refused = await t.prisma.generationRun.findFirstOrThrow({
        where: { stepRunId: seed.thumbnailStepRunId, slotNo: 1, attemptNo: 1 },
      });
      expect(refused).toMatchObject({
        status: 'REFUSED',
        refusalReason: '인물 생성 제한: 실제 사람과 닮은 얼굴은 만들 수 없습니다(가짜 공급자).',
        resultImageAssetId: null,
      });
      expect(refused.finishedAt).not.toBeNull();
      const retry = await generate(seed.thumbnailStepRunId, {
        slotNos: [1],
        faceOption: 'CHIN_CROP',
      });
      expect((retry.body as AcceptedBody).generationRuns[0]).toMatchObject({
        slotNo: 1,
        attemptNo: 2,
        triggerType: 'OWNER_RETRY',
      });
      await idle();
      const second = await t.prisma.generationRun.findFirstOrThrow({
        where: { stepRunId: seed.thumbnailStepRunId, slotNo: 1, attemptNo: 2 },
      });
      expect(second).toMatchObject({
        status: 'SUCCEEDED',
        faceOption: 'CHIN_CROP',
        triggerType: 'OWNER_RETRY',
      });
      expect(second.prompt).toContain('Model framing: crop at chin (face not shown).');
      const refusedEvent = genEvents().find((e) => e.status === 'REFUSED') as
        { refusalReason?: string; slotNo?: number } | undefined;
      expect(refusedEvent).toMatchObject({ slotNo: 1, refusalReason: refused.refusalReason });
      // ⑤는 시도 결과와 관계없이 입력 대기
      expect(
        (await t.prisma.stepRun.findUniqueOrThrow({ where: { id: seed.thumbnailStepRunId } }))
          .status,
      ).toBe('WAITING_INPUT');
    });

    it('타임아웃(테스트 설정 1초) → FAILED + 한국어 error_message, 공급자 실패 → FAILED + 공급자 문구', async () => {
      const seed = await waitingWithRefs();
      fake.enqueue(fakeScenario('timeout'), fakeScenario('failed'));
      await generate(seed.thumbnailStepRunId, { slotNos: [1, 2], faceOption: 'FULL_FACE' });
      await idle();
      const rows = await t.prisma.generationRun.findMany({
        where: { stepRunId: seed.thumbnailStepRunId },
        orderBy: { slotNo: 'asc' },
      });
      expect(rows[0]).toMatchObject({
        status: 'FAILED',
        errorMessage: '이미지 생성이 1초 안에 끝나지 않아 멈췄습니다. 다시 만들어 주세요.',
        resultImageAssetId: null,
      });
      expect(rows[0]!.finishedAt).not.toBeNull();
      expect(rows[1]).toMatchObject({
        status: 'FAILED',
        errorMessage: '이미지 생성 도구가 오류로 끝났습니다(가짜 공급자).',
      });
      expect(await t.prisma.imageAsset.count({ where: { kind: 'GENERATED' } })).toBe(0);
    });

    it('재시작 복구: RUNNING 행 → FAILED + finished_at + 중단 문구, SSE generation-run.updated', async () => {
      const seed = await waitingWithRefs();
      const row = await insertRunning(seed.thumbnailStepRunId, 1);
      const closed = await t.app.get(GenerationRecovery).recover();
      expect(closed).toEqual([row.id]);
      const after = await t.prisma.generationRun.findUniqueOrThrow({ where: { id: row.id } });
      expect(after).toMatchObject({
        status: 'FAILED',
        errorMessage: '앱이 꺼져 이미지 생성이 중단되었습니다. 다시 만들어 주세요.',
      });
      expect(after.finishedAt).not.toBeNull();
      expect(genEvents()).toEqual([
        expect.objectContaining({ generationRunId: row.id, status: 'FAILED' }),
      ]);
      // 다시 불러도 더 닫을 것이 없다
      expect(await t.app.get(GenerationRecovery).recover()).toEqual([]);
    });
  });

  describe('조회(규칙 8)', () => {
    it('GET /generation-runs/{id}: 프롬프트 전문·공급자·레퍼런스 해시, 없으면 404 GENERATION_RUN_NOT_FOUND', async () => {
      const seed = await waitingWithRefs();
      const { rows } = await generatedPair(seed);
      const res = await get(`/generation-runs/${rows[0]!.id}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        generationRunId: rows[0]!.id,
        stepRunId: seed.thumbnailStepRunId,
        candidateId: seed.candidate.id,
        slotNo: 1,
        attemptNo: 1,
        status: 'SUCCEEDED',
        provider: 'AGY',
        model: 'fake-image-gen',
        referenceSetSha256: rows[0]!.referenceSetSha256,
        adopted: false,
        shoeRatio: null,
        detailPass: null,
      });
      expect((res.body as SummaryBody).prompt).toBe(rows[0]!.prompt);
      for (const id of ['9999', 'abc', '0']) {
        const missing = await get(`/generation-runs/${id}`);
        expect(missing.status).toBe(404);
        expect(errorOf(missing).code).toBe('GENERATION_RUN_NOT_FOUND');
      }
    });

    it('GET /candidates/{id}/thumbnail: 레퍼런스·생성 후보(프롬프트 없음)·선택 없음·G3 무효·후보 칸 수', async () => {
      const seed = await waitingWithRefs();
      const { rows } = await generatedPair(seed);
      const res = await get(`/candidates/${seed.candidate.id}/thumbnail`);
      expect(res.status).toBe(200);
      const body = res.body as OutputBody;
      expect(body).toMatchObject({
        stepRunId: seed.thumbnailStepRunId,
        candidateId: seed.candidate.id,
        version: 1,
        stepRunStatus: 'WAITING_INPUT',
        isCurrent: true,
        referencesConfirmed: true,
        candidateCount: 2,
        selection: null,
        g3: { gatePassId: null, valid: false, changedBasisKeys: [] },
        sameProductColorRequired: false,
      });
      expect(body.references.map((r) => r.imageAssetId)).toEqual([
        seed.originals[0]!.id,
        seed.originals[1]!.id,
      ]);
      expect(body.generationRuns.map((r) => r.generationRunId)).toEqual(rows.map((r) => r.id));
      expect(body.generationRuns[0]).not.toHaveProperty('prompt');
    });

    it('⑤ 미실행 404 STEP_OUTPUT_NOT_FOUND · 다른 후보의 실행 id 404 STEP_RUN_NOT_FOUND · 모르는 쿼리 422', async () => {
      const fresh = await seedThumbnailSourcing(t.prisma, { itemCode: 'shop-b:20000001' });
      const none = await get(`/candidates/${fresh.candidate.id}/thumbnail`);
      expect(none.status).toBe(404);
      expect(errorOf(none)).toMatchObject({
        code: 'STEP_OUTPUT_NOT_FOUND',
        message: '아직 ⑤ 썸네일을 실행하지 않았습니다.',
      });
      const seed = await waitingWithRefs();
      const other = await get(
        `/candidates/${fresh.candidate.id}/thumbnail?stepRunId=${seed.thumbnailStepRunId}`,
      );
      expect(other.status).toBe(404);
      expect(errorOf(other).code).toBe('STEP_RUN_NOT_FOUND');
      const notThumbnail = await get(
        `/candidates/${seed.candidate.id}/thumbnail?stepRunId=${seed.sourcingStepRunId}`,
      );
      expect(errorOf(notThumbnail).code).toBe('STEP_RUN_NOT_FOUND');
      const bad = await get(`/candidates/${seed.candidate.id}/thumbnail?foo=1`);
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('G3 썸네일 선택(규칙 9~14)', () => {
    it('7개 모두 true + 대표 1장(+추가 1장) → 201. ⑤ COMPLETED, gate_pass G3 1행, 대표 sort_order 0, 선택본 시도 adopted=true', async () => {
      const seed = await waitingWithRefs();
      const { slot1, slot2, rows } = await generatedPair(seed);
      const res = await passG3(seed.candidate.id, {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: slot1,
        additionalImageAssetIds: [slot2],
        checklist: fullChecklist(),
      });
      expect(res.status).toBe(201);
      const body = res.body as PassBody;
      expect(body).toMatchObject({
        gate: 'G3',
        basisStepRunId: seed.thumbnailStepRunId,
        thumbnailStepRunId: seed.thumbnailStepRunId,
      });
      expect(body.thumbnailSelectionId).toEqual(expect.any(Number));
      const run = await t.prisma.stepRun.findUniqueOrThrow({
        where: { id: seed.thumbnailStepRunId },
      });
      expect(run.status).toBe('COMPLETED');
      expect(await t.prisma.gatePass.count({ where: { gate: 'G3' } })).toBe(1);
      const selection = await t.prisma.thumbnailSelection.findUniqueOrThrow({
        where: { stepRunId: seed.thumbnailStepRunId },
        include: { images: { orderBy: { sortOrder: 'asc' } } },
      });
      expect(selection.checklist).toEqual({ version: G3_CHECKLIST_VERSION, ...fullChecklist() });
      expect(selection.sameProductColorConfirmedAt).toBeNull();
      expect(selection.images.map((i) => [i.imageAssetId, i.role, i.sortOrder])).toEqual([
        [slot1, 'REPRESENTATIVE', 0],
        [slot2, 'ADDITIONAL', 1],
      ]);
      for (const row of rows) {
        expect(((await get(`/generation-runs/${row.id}`)).body as SummaryBody).adopted).toBe(true);
      }
      const output = (await get(`/candidates/${seed.candidate.id}/thumbnail`)).body as OutputBody;
      expect(output.stepRunStatus).toBe('COMPLETED');
      expect(output.g3).toMatchObject({ gatePassId: body.gatePassId, valid: true });
      expect(output.selection?.images.map((i) => i.generationRunId)).toEqual(rows.map((r) => r.id));
      expect(output.generationRuns.every((r) => r.adopted)).toBe(true);
      const gates = (await get(`/candidates/${seed.candidate.id}/gates`)).body as {
        items: { gate: string; passed: boolean }[];
      };
      expect(gates.items.find((g) => g.gate === 'G3')?.passed).toBe(true);
      expect(events.some((e) => e.name === 'gate.passed')).toBe(true);
    });

    it('체크리스트 키 하나 빠짐·false → 422 CHECKLIST_INCOMPLETE, 추가 10장 → 422 IMAGE_COUNT_INVALID, 원본 대표 → 422 IMAGE_NOT_ALLOWED', async () => {
      const seed = await waitingWithRefs();
      const { slot1 } = await generatedPair(seed);
      const base = {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: slot1,
        additionalImageAssetIds: [],
      };
      const partial: Record<string, boolean> = fullChecklist();
      delete partial.detailMatch;
      const missing = await passG3(seed.candidate.id, { ...base, checklist: partial });
      expect(missing.status).toBe(422);
      expect(errorOf(missing)).toMatchObject({
        code: 'CHECKLIST_INCOMPLETE',
        details: { uncheckedKeys: ['detailMatch'] },
      });
      const falsy = await passG3(seed.candidate.id, {
        ...base,
        checklist: { ...fullChecklist(), noTextOrPrice: false },
      });
      expect(errorOf(falsy).code).toBe('CHECKLIST_INCOMPLETE');
      const ten = await passG3(seed.candidate.id, {
        ...base,
        additionalImageAssetIds: Array.from({ length: 10 }, (_, i) => 90_000 + i),
        checklist: fullChecklist(),
      });
      expect(ten.status).toBe(422);
      expect(errorOf(ten).code).toBe('IMAGE_COUNT_INVALID');
      const original = await passG3(seed.candidate.id, {
        ...base,
        representativeImageAssetId: seed.originals[0]!.id,
        checklist: fullChecklist(),
      });
      expect(original.status).toBe(422);
      expect(errorOf(original)).toMatchObject({
        code: 'IMAGE_NOT_ALLOWED',
        details: { reason: 'NOT_GENERATED' },
      });
      expect(await t.prisma.gatePass.count()).toBe(0);
      expect(await t.prisma.thumbnailSelection.count()).toBe(0);
      expect(
        (await t.prisma.stepRun.findUniqueOrThrow({ where: { id: seed.thumbnailStepRunId } }))
          .status,
      ).toBe('WAITING_INPUT');
    });

    it('생성 중 → 409 ALREADY_IN_PROGRESS(게이트 목록 blockedReasons에도)', async () => {
      const seed = await waitingWithRefs();
      const { slot1 } = await generatedPair(seed);
      await insertRunning(seed.thumbnailStepRunId, 2, 2);
      const res = await passG3(seed.candidate.id, {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: slot1,
        additionalImageAssetIds: [],
        checklist: fullChecklist(),
      });
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'ALREADY_IN_PROGRESS',
        details: { job: 'GENERATION' },
      });
      const gates = (await get(`/candidates/${seed.candidate.id}/gates`)).body as {
        items: { gate: string; blockedReasons: { code: string }[] }[];
      };
      expect(gates.items.find((g) => g.gate === 'G3')?.blockedReasons[0]?.code).toBe(
        'ALREADY_IN_PROGRESS',
      );
    });

    it("다른 앵커 키·색상 코드 없는 레퍼런스 → '같은 상품·색상' 확인 없이 422, 확인하면 201 + same_product_color_confirmed_at", async () => {
      const seed = await seedThumbnailWaiting(t);
      const extra = await addExtraOriginals(t, seed);
      await confirmReferences(t, seed.thumbnailStepRunId, [seed.originals[0]!.id, extra.other.id]);
      fake.enqueue(fakeScenario('success'));
      await generate(seed.thumbnailStepRunId, { slotNos: [1], faceOption: 'FULL_FACE' });
      await idle();
      const output = (await get(`/candidates/${seed.candidate.id}/thumbnail`)).body as OutputBody;
      expect(output.sameProductColorRequired).toBe(true);
      expect(output.references.map((r) => r.isSameAnchor)).toEqual([true, false]);
      const image = output.generationRuns[0]!.resultImageAssetId!;
      const body = {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: image,
        additionalImageAssetIds: [],
        checklist: fullChecklist(),
      };
      const blocked = await passG3(seed.candidate.id, body);
      expect(blocked.status).toBe(422);
      expect(errorOf(blocked)).toMatchObject({
        code: 'SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED',
        message: "다른 상품·색상의 레퍼런스를 썼습니다. '같은 상품·색상'을 확인해 주세요.",
      });
      const ok = await passG3(seed.candidate.id, { ...body, sameProductColorConfirmed: true });
      expect(ok.status).toBe(201);
      const selection = await t.prisma.thumbnailSelection.findUniqueOrThrow({
        where: { stepRunId: seed.thumbnailStepRunId },
      });
      expect(selection.sameProductColorConfirmedAt).not.toBeNull();

      // 색상 코드를 모르는 원본만 골라도 확인이 필요하다(ERD source_color_code)
      const second = await seedThumbnailWaiting(t, {
        itemCode: 'shop-c:30000001',
        selectedColor: '크림/블랙 C',
      });
      const extra2 = await addExtraOriginals(t, second);
      const saved = await request(t.app.getHttpServer())
        .put(`/api/v1/step-runs/${second.thumbnailStepRunId}/thumbnail-references`)
        .set('X-AutoStore-Client', '1')
        .send({
          references: [{ imageAssetId: extra2.noColor.id, sortOrder: 1 }],
          noPersonConfirmed: true,
        });
      expect(saved.body).toMatchObject({ sameProductColorRequired: true });
    });

    it('완료 뒤 다른 후보로 다시 고름 → ⑤ OWNER_EDIT 새 버전·새 gate_pass. 완료였던 ⑧만 RERUN_REQUIRED, COPY·TAGS는 COMPLETED(US-33 AC3)', async () => {
      const seed = await waitingWithRefs();
      const { slot1, slot2, rows } = await generatedPair(seed);
      const first = await passG3(seed.candidate.id, {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: slot1,
        additionalImageAssetIds: [],
        checklist: fullChecklist(),
      });
      expect(first.status).toBe(201);
      // 시드: ⑥-1·⑦ 완료(⑤를 읽지 않는다), ⑧ 완료(지금 G3 선택본을 읽은 입력)
      const value = await thumbnailSelectionValue(t.prisma, seed.thumbnailStepRunId);
      await insertStepRun(t.prisma, {
        candidateId: seed.candidate.id,
        stepCode: 'COPY',
        status: 'COMPLETED',
      });
      await insertStepRun(t.prisma, {
        candidateId: seed.candidate.id,
        stepCode: 'TAGS',
        status: 'COMPLETED',
      });
      await insertStepRun(t.prisma, {
        candidateId: seed.candidate.id,
        stepCode: 'UPLOAD',
        status: 'COMPLETED',
        inputs: [
          {
            inputKey: 'thumbnail.selection',
            sourceType: 'PREV_STEP',
            sourceStepRunId: seed.thumbnailStepRunId,
            value,
          },
        ],
      });

      // 같은 선택을 다시 보내면 새 행 없이 200(완료된 ⑤ — 같은 지문)
      const same = await passG3(seed.candidate.id, {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: slot1,
        additionalImageAssetIds: [],
        checklist: fullChecklist(),
      });
      expect(same.status).toBe(200);
      expect((same.body as PassBody).thumbnailSelectionId).toBeNull();

      const again = await passG3(seed.candidate.id, {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: slot2,
        additionalImageAssetIds: [slot1],
        checklist: fullChecklist(),
      });
      expect(again.status).toBe(201);
      const repick = again.body as PassBody;
      expect(repick.thumbnailStepRunId).not.toBe(seed.thumbnailStepRunId);
      const newRun = await t.prisma.stepRun.findUniqueOrThrow({
        where: { id: repick.thumbnailStepRunId! },
      });
      expect(newRun).toMatchObject({
        version: 2,
        executionMode: 'OWNER_EDIT',
        ownerAction: 'EDIT',
        baseStepRunId: seed.thumbnailStepRunId,
        status: 'COMPLETED',
        aiEngine: null,
      });
      expect(await t.prisma.thumbnailReference.count({ where: { stepRunId: newRun.id } })).toBe(2);
      expect(await t.prisma.gatePass.count({ where: { gate: 'G3' } })).toBe(2);
      // 새 버전에는 자기 generation_run이 없다(바탕 버전의 생성본으로 판정)
      expect(await t.prisma.generationRun.count({ where: { stepRunId: newRun.id } })).toBe(0);
      const steps = await t.prisma.candidateStep.findMany({
        where: { candidateId: seed.candidate.id, stepCode: { in: ['COPY', 'TAGS', 'UPLOAD'] } },
      });
      const statusOf = (code: string) => steps.find((s) => s.stepCode === code)!;
      expect(statusOf('UPLOAD')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['thumbnail.selection'],
      });
      expect(statusOf('COPY').status).toBe('COMPLETED');
      expect(statusOf('TAGS').status).toBe('COMPLETED');

      const current = (await get(`/candidates/${seed.candidate.id}/thumbnail`)).body as OutputBody;
      expect(current).toMatchObject({
        stepRunId: newRun.id,
        version: 2,
        isCurrent: true,
        g3: { valid: true },
      });
      expect(current.generationRuns.map((r) => [r.generationRunId, r.adopted])).toEqual([
        [rows[0]!.id, true],
        [rows[1]!.id, true],
      ]);
      expect(current.selection?.images.map((i) => i.imageAssetId)).toEqual([slot2, slot1]);
      const previous = (
        await get(`/candidates/${seed.candidate.id}/thumbnail?stepRunId=${seed.thumbnailStepRunId}`)
      ).body as OutputBody;
      expect(previous).toMatchObject({ isCurrent: false, version: 1 });
      expect(previous.selection?.images.map((i) => i.imageAssetId)).toEqual([slot1]);

      // 이전 버전 다시 고르기(RESTORE_VERSION) → 선택본이 달라져 G3 무효(SSE gate.invalidated)
      events.length = 0;
      const restore = await post(`/candidates/${seed.candidate.id}/steps/THUMBNAIL/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: seed.thumbnailStepRunId,
      });
      expect(restore.status).toBe(201);
      const invalidated = events.find((e) => e.name === 'gate.invalidated');
      expect(invalidated?.data).toMatchObject({ gate: 'G3', changedBasisKeys: ['selectedHash'] });
      const restored = (await get(`/candidates/${seed.candidate.id}/thumbnail`)).body as OutputBody;
      expect(restored.version).toBe(3);
      expect(restored.selection?.images.map((i) => i.imageAssetId)).toEqual([slot1]);
      expect(restored.g3.valid).toBe(false);
      expect(restored.generationRuns).toHaveLength(2);
    });

    it('⑤를 다시 실행하면 이전 버전 생성본을 가져가지 않는다 — 이전 버전 생성본을 고르면 422 IMAGE_NOT_ALLOWED(OTHER_RUN)', async () => {
      const seed = await waitingWithRefs();
      const { slot1 } = await generatedPair(seed);
      await passG3(seed.candidate.id, {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: slot1,
        additionalImageAssetIds: [],
        checklist: fullChecklist(),
      });
      const rerun = await post(`/candidates/${seed.candidate.id}/steps/THUMBNAIL/runs`);
      expect(rerun.status).toBe(202);
      await idle();
      const newRunId = (rerun.body as { stepRunId: number }).stepRunId;
      const output = (await get(`/candidates/${seed.candidate.id}/thumbnail`)).body as OutputBody;
      expect(output).toMatchObject({
        stepRunId: newRunId,
        stepRunStatus: 'WAITING_INPUT',
        generationRuns: [],
        selection: null,
      });
      // 레퍼런스 기본값은 복사된다(P3-01) → 생성은 할 수 있다
      expect(output.referencesConfirmed).toBe(true);
      const res = await passG3(seed.candidate.id, {
        basisStepRunId: newRunId,
        representativeImageAssetId: slot1,
        additionalImageAssetIds: [],
        checklist: fullChecklist(),
      });
      expect(res.status).toBe(422);
      expect(errorOf(res)).toMatchObject({
        code: 'IMAGE_NOT_ALLOWED',
        details: { imageAssetId: slot1, reason: 'OTHER_RUN' },
      });
    });
  });
});
