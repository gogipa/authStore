import request from 'supertest';
import {
  type PublishedProgressEvent,
  ProgressEventsService,
} from '../../src/common/events/progress-events.service.js';
import { ImageAssetsService } from '../../src/common/files/image-assets.service.js';
import { writeSettingsFileAtomically } from '../../src/modules/settings/settings-file.loader.js';
import { valueHash } from '../../src/modules/step-engine/domain/fingerprint.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import { StepEngineApi } from '../../src/modules/step-engine/step-engine.api.js';
import { referenceSetSha256 } from '../../src/modules/thumbnails/references/reference-set-hash.js';
import { insertStepRun } from '../fixtures/step-engine/step-run.factory.js';
import {
  seedThumbnailSourcing,
  seedThumbnailWaiting,
  settingsWithThumbnail,
  thumbnailFetchHandler,
  thumbnailImageBytes,
  thumbnailItemFixture,
  truncateThumbnails,
  type ThumbnailWaitingSeed,
} from '../fixtures/thumbnails/seed-thumbnail-waiting.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';

const DATA_DIR = process.env.APP_DATA_DIR!;
const FIXTURE = thumbnailItemFixture();

interface ErrorBody {
  code: string;
  message: string;
  fieldErrors?: { field: string; message: string }[];
  details?: Record<string, unknown>;
}

interface SourceImageBody {
  imageAssetId: number;
  kind: string;
  sourceSection: string | null;
  width: number;
  height: number;
  mimeType: string;
  sha256: string;
  sourceUrl: string | null;
  sourceItemCode: string | null;
  sourceShopCode: string | null;
  usageRight: string;
  fileUrl: string;
  isSameAnchor: boolean;
  personDetected: null;
  autoRecommended: null;
}

interface ReferencesResultBody {
  stepRunId: number;
  inputNo: number;
  references: {
    id: number;
    imageAssetId: number;
    sortOrder: number;
    noPersonConfirmedAt: string;
    createdAt: string;
    isSameAnchor: boolean;
    fileUrl: string;
  }[];
  sameProductColorRequired: boolean;
}

interface PreviewBody {
  prompt: string;
  faceOption: string;
  requestedSizePx: number;
  promptAdjusted: boolean;
  realPersonNameDetected: boolean;
  blockedTerms: string[];
  generationAllowed: boolean;
}

describe('⑤ 썸네일 준비(P3-01) e2e — autostore_test·실제 THUMBNAIL 실행기(가짜 이미지 CDN)', () => {
  let t: TestApp;
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body: object = {}) =>
    http().post(`/api/v1${path}`).set('X-AutoStore-Client', '1').send(body);
  const put = (path: string, body: object) =>
    http().put(`/api/v1${path}`).set('X-AutoStore-Client', '1').send(body);
  const get = (path: string) => http().get(`/api/v1${path}`);
  const idle = () => t.app.get(StepExecutor).whenIdle();
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const saveRefs = (runId: number, ids: number[], noPersonConfirmed: unknown = true) =>
    put(`/step-runs/${runId}/thumbnail-references`, {
      references: ids.map((imageAssetId, i) => ({ imageAssetId, sortOrder: i + 1 })),
      noPersonConfirmed,
    });
  const preview = (body: object) => post('/thumbnail-prompt-previews', body);
  const complete = (runId: number) =>
    t.app.get(StepEngineApi).resumeWaiting(runId, { outcome: { kind: 'COMPLETED', output: null } });
  const waiting = async (): Promise<ThumbnailWaitingSeed> => seedThumbnailWaiting(t);

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, settingsWithThumbnail());
    t = await createTestApp();
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
    events.length = 0;
  });

  afterAll(async () => {
    await idle();
    await truncateThumbnails(t.prisma);
    unsubscribe();
    await t.app.close();
  });

  describe('⑤ 실행 — 원본 받기·입력 대기(규칙 1~6)', () => {
    it('실행 → 202 → WAITING_INPUT(THUMBNAIL_REFERENCE_REQUIRED). 원본 6장·지문은 설정 두 키·ai_* NULL·call_log RAKUTEN_IMAGE', async () => {
      const seed = await seedThumbnailSourcing(t.prisma);
      const res = await post(`/candidates/${seed.candidate.id}/steps/THUMBNAIL/runs`);
      expect(res.status).toBe(202);
      await idle();
      const runId = (res.body as { stepRunId: number }).stepRunId;
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: runId } });
      expect(run).toMatchObject({ status: 'WAITING_INPUT', aiEngine: null, aiModel: null });
      const waitingEvent = events.find(
        (e) =>
          e.name === 'step-run.status-changed' &&
          (e.data as { stepCode?: string; status?: string }).stepCode === 'THUMBNAIL' &&
          (e.data as { status?: string }).status === 'WAITING_INPUT',
      );
      expect(waitingEvent?.data).toMatchObject({
        stepRunId: runId,
        waitingReasonCode: 'THUMBNAIL_REFERENCE_REQUIRED',
        pendingInputs: ['owner.referenceSelection'],
      });
      // 입력 지문: 설정 두 키(SETTINGS 시작 조건) + 실행 중 오너 입력 레퍼런스 선택(지문 밖)
      const inputs = await t.prisma.stepRunInput.findMany({
        where: { stepRunId: runId },
        orderBy: { inputKey: 'asc' },
      });
      expect(inputs.map((i) => [i.inputKey, i.sourceType, i.isStartCondition])).toEqual([
        ['owner.referenceSelection', 'OWNER_INPUT', false],
        ['settings.thumbnail.faceOptionDefault', 'SETTINGS', true],
        ['settings.thumbnail.promptTemplate', 'SETTINGS', true],
      ]);
      // 외부 호출: 이미지 CDN 6번(RAKUTEN_IMAGE), 페이지 상한(RAKUTEN_PAGE)은 쓰지 않는다
      const logs = await t.prisma.callLog.findMany({ orderBy: { id: 'asc' } });
      expect(logs.map((l) => l.target)).toEqual(new Array(6).fill('RAKUTEN_IMAGE'));
      expect(logs.every((l) => l.stepRunId === runId && l.candidateId === seed.candidate.id)).toBe(
        true,
      );
      expect(t.fetch.calls.map((c) => c.url)).toEqual(FIXTURE.rakutenItem.imageUrls);
      const usage = await get('/call-usage');
      const items = (
        usage.body as { items: { target: string; count: number; dailyLimit: number | null }[] }
      ).items;
      expect(items.find((i) => i.target === 'RAKUTEN_IMAGE')).toMatchObject({
        count: 6,
        dailyLimit: null,
      });
      expect(items.find((i) => i.target === 'RAKUTEN_PAGE')).toMatchObject({ count: 0 });
    });

    it('원본 목록 200: 6장 모두 ORIGINAL·REFERENCE_ONLY·PRODUCT_IMAGE, 해상도·출처·같은 앵커, 로컬 경로 없음', async () => {
      const seed = await waiting();
      const res = await get(`/candidates/${seed.candidate.id}/source-images`);
      expect(res.status).toBe(200);
      const body = res.body as { itemCode: string; items: SourceImageBody[] };
      expect(body.itemCode).toBe('shop-a:10000123');
      expect(body.items).toHaveLength(6);
      for (const [i, item] of body.items.entries()) {
        expect(item).toMatchObject({
          kind: 'ORIGINAL',
          sourceSection: 'PRODUCT_IMAGE',
          usageRight: 'REFERENCE_ONLY',
          mimeType: 'image/jpeg',
          sourceUrl: FIXTURE.rakutenItem.imageUrls[i],
          sourceItemCode: 'shop-a:10000123',
          sourceShopCode: 'shop-a',
          fileUrl: `/api/v1/image-assets/${item.imageAssetId}/file`,
          isSameAnchor: true,
          personDetected: null,
          autoRecommended: null,
        });
      }
      expect(body.items[5]).toMatchObject({ width: 320, height: 240 });
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(DATA_DIR);
      expect(text).not.toMatch(/filePath|images\/[0-9a-f]{2}\//);
      // DB 행: candidate_id NULL(원본은 itemCode 단위 공유), sha256 소문자 hex, 수집 시각
      const rows = await t.prisma.imageAsset.findMany({ orderBy: { id: 'asc' } });
      expect(rows).toHaveLength(6);
      for (const row of rows) {
        expect(row.candidateId).toBeNull();
        expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(row.collectedAt).not.toBeNull();
        expect(row).toMatchObject({ sourceModelCodeNorm: '1201A019108', sourceColorCode: '108' });
      }
      // 파일은 fileUrl로 받는다
      const file = await get(body.items[0]!.fileUrl.replace('/api/v1', ''));
      expect(file.status).toBe(200);
      expect(file.headers['content-type']).toContain('image/jpeg');
    });

    it('sourceSection 거르기·틀린 값 422 INVALID_QUERY_PARAMETER·모르는 조건 422', async () => {
      const seed = await waiting();
      const product = await get(
        `/candidates/${seed.candidate.id}/source-images?sourceSection=PRODUCT_IMAGE`,
      );
      expect((product.body as { items: unknown[] }).items).toHaveLength(6);
      const spec = await get(
        `/candidates/${seed.candidate.id}/source-images?sourceSection=DESCRIPTION_IMAGE`,
      );
      expect((spec.body as { items: unknown[] }).items).toEqual([]);
      const bad = await get(`/candidates/${seed.candidate.id}/source-images?sourceSection=FOO`);
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('INVALID_QUERY_PARAMETER');
      expect((await get(`/candidates/${seed.candidate.id}/source-images?sort=x`)).status).toBe(422);
      expect((await get('/candidates/999999/source-images')).status).toBe(404);
    });

    it('② 선택 전: 원본 목록 409 SOURCING_SELECTION_REQUIRED, ⑤ 실행 409 STEP_START_CONDITION_UNMET(sourcing.selection)', async () => {
      const seed = await seedThumbnailSourcing(t.prisma);
      // ② 선택 전(소싱 선택 itemCode 없음) 후보
      await t.prisma.candidate.update({
        where: { id: seed.candidate.id },
        data: { itemCode: null, selectedColor: null },
      });
      const list = await get(`/candidates/${seed.candidate.id}/source-images`);
      expect(list.status).toBe(409);
      expect(errorOf(list)).toMatchObject({
        code: 'SOURCING_SELECTION_REQUIRED',
        message: '② 소싱에서 상품을 먼저 골라 주세요.',
      });
      // ② 현재 버전이 완료가 아님(입력 대기) → ⑤ 시작 조건 없음, 실행을 만들지 않는다
      await insertStepRun(t.prisma, {
        candidateId: seed.candidate.id,
        stepCode: 'SOURCING',
        status: 'WAITING_INPUT',
      });
      const run = await post(`/candidates/${seed.candidate.id}/steps/THUMBNAIL/runs`);
      expect(run.status).toBe(409);
      expect(errorOf(run).code).toBe('STEP_START_CONDITION_UNMET');
      expect(errorOf(run).fieldErrors?.map((f) => f.field)).toEqual(['sourcing.selection']);
      expect(await t.prisma.stepRun.count({ where: { stepCode: 'THUMBNAIL' } })).toBe(0);
    });

    it('원본 받기 실패(이미지 503) → ⑤ FAILED(EXTERNAL_API, RAKUTEN_IMAGE_HTTP_503)', async () => {
      const seed = await seedThumbnailSourcing(t.prisma);
      t.fetch.handler = thumbnailFetchHandler({
        status: { [FIXTURE.rakutenItem.imageUrls[2]!]: 503 },
      });
      const res = await post(`/candidates/${seed.candidate.id}/steps/THUMBNAIL/runs`);
      expect(res.status).toBe(202);
      await idle();
      const run = await t.prisma.stepRun.findUniqueOrThrow({
        where: { id: (res.body as { stepRunId: number }).stepRunId },
      });
      expect(run).toMatchObject({
        status: 'FAILED',
        failureKind: 'EXTERNAL_API',
        errorCode: 'RAKUTEN_IMAGE_HTTP_503',
      });
      expect(run.errorMessage).toContain('HTTP 503');
    });
  });

  describe('PUT /step-runs/{id}/thumbnail-references — 검사(규칙 7·9·10)', () => {
    it('0장·4장 → 422 IMAGE_COUNT_INVALID, noPersonConfirmed=false·빠짐 → 422 NO_PERSON_CONFIRMATION_REQUIRED', async () => {
      const seed = await waiting();
      const ids = seed.originals.map((o) => o.id);
      for (const refs of [[], ids.slice(0, 4)]) {
        const res = await saveRefs(seed.thumbnailStepRunId, refs);
        expect(res.status).toBe(422);
        expect(errorOf(res)).toMatchObject({
          code: 'IMAGE_COUNT_INVALID',
          message: '고른 이미지 수가 맞지 않습니다(레퍼런스 1~3장, 추가이미지 9장까지).',
        });
      }
      const no = await saveRefs(seed.thumbnailStepRunId, ids.slice(0, 2), false);
      expect(no.status).toBe(422);
      expect(errorOf(no)).toMatchObject({
        code: 'NO_PERSON_CONFIRMATION_REQUIRED',
        message: "'사람·얼굴 없음'을 체크해 주세요.",
      });
      const missing = await put(`/step-runs/${seed.thumbnailStepRunId}/thumbnail-references`, {
        references: [{ imageAssetId: ids[0], sortOrder: 1 }],
      });
      expect(errorOf(missing).code).toBe('NO_PERSON_CONFIRMATION_REQUIRED');
      // 같은 이미지·순서 두 번, 순서 4, 문자열 확인 → VALIDATION_FAILED
      const dup = await put(`/step-runs/${seed.thumbnailStepRunId}/thumbnail-references`, {
        references: [
          { imageAssetId: ids[0], sortOrder: 1 },
          { imageAssetId: ids[0], sortOrder: 2 },
        ],
        noPersonConfirmed: true,
      });
      expect(errorOf(dup).code).toBe('VALIDATION_FAILED');
      const order4 = await put(`/step-runs/${seed.thumbnailStepRunId}/thumbnail-references`, {
        references: [{ imageAssetId: ids[0], sortOrder: 4 }],
        noPersonConfirmed: true,
      });
      expect(errorOf(order4).code).toBe('VALIDATION_FAILED');
      expect(await t.prisma.thumbnailReferenceInput.count()).toBe(0);
    });

    it('생성본·설명 스펙 이미지·다른 itemCode 원본 → 422 IMAGE_NOT_ALLOWED(details.reason), 없는 이미지 404', async () => {
      const seed = await waiting();
      const images = t.app.get(ImageAssetsService);
      const generated = await images.saveImage(thumbnailImageBytes('png-named.jpg'), {
        kind: 'GENERATED',
        candidateId: seed.candidate.id,
      });
      const specImage = await images.saveImage(thumbnailImageBytes('original-3.jpg'), {
        kind: 'ORIGINAL',
        sourceSection: 'DESCRIPTION_IMAGE',
        sourceUrl: 'https://tshop.r10s.jp/shop-a/cabinet/spec.jpg',
        sourceItemCode: 'shop-a:10000124',
        collectedAt: new Date(),
      });
      const otherItem = await images.saveImage(thumbnailImageBytes('original-4.jpg'), {
        kind: 'ORIGINAL',
        sourceSection: 'PRODUCT_IMAGE',
        sourceUrl: 'https://tshop.r10s.jp/shop-b/cabinet/x.jpg',
        sourceItemCode: 'shop-b:20000456',
        collectedAt: new Date(),
      });
      const cases: [number, string, string][] = [
        [generated.id, 'NOT_ORIGINAL', '라쿠텐 원본 이미지만 레퍼런스로 고를 수 있습니다'],
        [specImage.id, 'NOT_PRODUCT_IMAGE', '설명 속 스펙표 이미지는 레퍼런스로 쓸 수 없습니다'],
        [otherItem.id, 'OTHER_ITEM', '지금 ② 소싱 선택 상품의 원본이 아닙니다'],
      ];
      for (const [id, reason, text] of cases) {
        const res = await saveRefs(seed.thumbnailStepRunId, [seed.originals[0]!.id, id]);
        expect(res.status).toBe(422);
        expect(errorOf(res)).toMatchObject({
          code: 'IMAGE_NOT_ALLOWED',
          message: `이 이미지는 여기에 쓸 수 없습니다(${text}).`,
          details: { imageAssetId: id, reason },
        });
      }
      const none = await saveRefs(seed.thumbnailStepRunId, [999999]);
      expect(none.status).toBe(404);
      expect(errorOf(none).code).toBe('IMAGE_ASSET_NOT_FOUND');
    });

    it('완료된 ⑤ → 409 STEP_RUN_NOT_WAITING_INPUT, ⑤가 아닌 실행 422 INVALID_STEP_CODE, 없는 실행 404', async () => {
      const seed = await waiting();
      const ids = seed.originals.map((o) => o.id);
      await complete(seed.thumbnailStepRunId);
      const done = await saveRefs(seed.thumbnailStepRunId, ids.slice(0, 1));
      expect(done.status).toBe(409);
      expect(errorOf(done).code).toBe('STEP_RUN_NOT_WAITING_INPUT');
      const notThumb = await saveRefs(seed.sourcingStepRunId, ids.slice(0, 1));
      expect(notThumb.status).toBe(422);
      expect(errorOf(notThumb)).toMatchObject({
        code: 'INVALID_STEP_CODE',
        details: { stepCode: 'SOURCING', reason: 'NOT_THUMBNAIL' },
      });
      expect((await saveRefs(999999, ids.slice(0, 1))).status).toBe(404);
      expect((await saveRefs(0, ids.slice(0, 1))).status).toBe(404);
    });

    it('생성 중 409 ALREADY_IN_PROGRESS(job=GENERATION), 제외 후보 409 CANDIDATE_EXCLUDED', async () => {
      const seed = await waiting();
      const ids = seed.originals.map((o) => o.id);
      await t.prisma.generationRun.create({
        data: {
          stepRunId: seed.thumbnailStepRunId,
          slotNo: 1,
          attemptNo: 1,
          triggerType: 'INITIAL',
          prompt: 'x',
          faceOption: 'FULL_FACE',
          requestedSizePx: 2048,
          provider: 'AGY',
          model: 'fixture',
          referenceSetSha256: 'a'.repeat(64),
          status: 'RUNNING',
        },
      });
      const busy = await saveRefs(seed.thumbnailStepRunId, ids.slice(0, 1));
      expect(busy.status).toBe(409);
      expect(errorOf(busy)).toMatchObject({
        code: 'ALREADY_IN_PROGRESS',
        message: '썸네일 생성이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
        details: { job: 'GENERATION' },
      });
      await t.prisma.candidate.update({
        where: { id: seed.candidate.id },
        data: { status: 'EXCLUDED', excludedReason: 'OWNER_EXCLUDED' },
      });
      const excluded = await saveRefs(seed.thumbnailStepRunId, ids.slice(0, 1));
      expect(excluded.status).toBe(409);
      expect(errorOf(excluded).code).toBe('CANDIDATE_EXCLUDED');
    });

    it('웹 화면 전용: X-AutoStore-Client 없음 → 403 CLIENT_HEADER_REQUIRED, 다른 Origin → 403', async () => {
      const seed = await waiting();
      const body = {
        references: [{ imageAssetId: seed.originals[0]!.id, sortOrder: 1 }],
        noPersonConfirmed: true,
      };
      const noHeader = await http()
        .put(`/api/v1/step-runs/${seed.thumbnailStepRunId}/thumbnail-references`)
        .send(body);
      expect(noHeader.status).toBe(403);
      expect(errorOf(noHeader).code).toBe('CLIENT_HEADER_REQUIRED');
      const foreign = await http()
        .put(`/api/v1/step-runs/${seed.thumbnailStepRunId}/thumbnail-references`)
        .set('X-AutoStore-Client', '1')
        .set('Origin', 'https://evil.example')
        .send(body);
      expect(foreign.status).toBe(403);
      expect(await t.prisma.thumbnailReferenceInput.count()).toBe(0);
    });
  });

  describe('레퍼런스 저장·멱등·다시 실행 기본값(규칙 6·8)', () => {
    it('2장 저장 → 200 inputNo=1(1행씩·확인 시각·버전 레퍼런스·입력 해시·감사). 같은 선택 → inputNo=1·행 수 그대로. 다른 선택 → inputNo=2', async () => {
      const seed = await waiting();
      const [a, b, c] = seed.originals;
      const first = await saveRefs(seed.thumbnailStepRunId, [a!.id, b!.id]);
      expect(first.status).toBe(200);
      const body = first.body as ReferencesResultBody;
      expect(body).toMatchObject({
        stepRunId: seed.thumbnailStepRunId,
        inputNo: 1,
        sameProductColorRequired: false,
      });
      expect(body.references.map((r) => [r.imageAssetId, r.sortOrder, r.isSameAnchor])).toEqual([
        [a!.id, 1, true],
        [b!.id, 2, true],
      ]);
      expect(body.references[0]!.fileUrl).toBe(`/api/v1/image-assets/${a!.id}/file`);
      expect(await t.prisma.thumbnailReferenceInput.count()).toBe(2);
      const refs = await t.prisma.thumbnailReference.findMany({
        where: { stepRunId: seed.thumbnailStepRunId },
      });
      expect(refs.map((r) => r.imageAssetId).sort()).toEqual([a!.id, b!.id].sort());
      // step_run_input owner.referenceSelection = 레퍼런스 해시(정렬해 이은 SHA-256)의 값 해시
      const input = await t.prisma.stepRunInput.findFirstOrThrow({
        where: { stepRunId: seed.thumbnailStepRunId, inputKey: 'owner.referenceSelection' },
      });
      expect(input).toMatchObject({
        sourceType: 'OWNER_INPUT',
        isStartCondition: false,
        valueHash: valueHash(referenceSetSha256([a!.sha256, b!.sha256])),
      });
      const audits = await t.prisma.userActionLog.findMany({
        where: { eventType: 'OWNER_CONFIRMED', stepCode: 'THUMBNAIL' },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0]!.detail).toMatchObject({
        confirmation: 'NO_PERSON_IN_REFERENCES',
        inputNo: 1,
      });

      // 같은 선택(순서 그대로) → inputNo 1, 입력 행·감사 그대로
      const again = await saveRefs(seed.thumbnailStepRunId, [a!.id, b!.id]);
      expect(again.status).toBe(200);
      expect((again.body as ReferencesResultBody).inputNo).toBe(1);
      expect(await t.prisma.thumbnailReferenceInput.count()).toBe(2);
      expect(await t.prisma.userActionLog.count({ where: { eventType: 'OWNER_CONFIRMED' } })).toBe(
        1,
      );

      // 다른 선택 → inputNo 2, 버전 레퍼런스 교체
      const other = await saveRefs(seed.thumbnailStepRunId, [c!.id]);
      expect((other.body as ReferencesResultBody).inputNo).toBe(2);
      expect(await t.prisma.thumbnailReferenceInput.count()).toBe(3);
      const replaced = await t.prisma.thumbnailReference.findMany({
        where: { stepRunId: seed.thumbnailStepRunId },
      });
      expect(replaced.map((r) => r.imageAssetId)).toEqual([c!.id]);
      // ⑤는 여전히 입력 대기(G3 선택까지)
      expect(
        (await t.prisma.stepRun.findUniqueOrThrow({ where: { id: seed.thumbnailStepRunId } }))
          .status,
      ).toBe('WAITING_INPUT');
    });

    it('다시 실행: 새 ⑤ 버전의 thumbnail_reference가 최신 선택으로 미리 채워지고, 같은 원본은 새 행을 만들지 않는다', async () => {
      const seed = await waiting();
      const [a, , c] = seed.originals;
      await saveRefs(seed.thumbnailStepRunId, [a!.id, c!.id]);
      await complete(seed.thumbnailStepRunId);
      const assetsBefore = await t.prisma.imageAsset.count();
      const rerun = await post(`/candidates/${seed.candidate.id}/steps/THUMBNAIL/runs`);
      expect(rerun.status).toBe(202);
      await idle();
      const nextId = (rerun.body as { stepRunId: number }).stepRunId;
      const next = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: nextId } });
      expect(next).toMatchObject({ status: 'WAITING_INPUT', version: 2 });
      expect(await t.prisma.imageAsset.count()).toBe(assetsBefore);
      const refs = await t.prisma.thumbnailReference.findMany({
        where: { stepRunId: nextId },
        orderBy: { sortOrder: 'asc' },
      });
      expect(refs.map((r) => [r.imageAssetId, r.sortOrder])).toEqual([
        [a!.id, 1],
        [c!.id, 2],
      ]);
      // 입력 기록도 최신 선택의 해시
      const input = await t.prisma.stepRunInput.findFirstOrThrow({
        where: { stepRunId: nextId, inputKey: 'owner.referenceSelection' },
      });
      expect(input.valueHash).toBe(valueHash(referenceSetSha256([a!.sha256, c!.sha256])));
      // 앞 버전 레퍼런스는 그대로(닫힌 버전은 바꿀 수 없다 — trg_output_frozen)
      await expect(
        t.prisma.thumbnailReference.deleteMany({ where: { stepRunId: seed.thumbnailStepRunId } }),
      ).rejects.toThrow();
    });
  });

  describe('POST /thumbnail-prompt-previews — 프롬프트·실존 인물 차단어(규칙 11~15)', () => {
    it('기본값 → 2048px·차단어 없음·레퍼런스 확인 전 generationAllowed=false, 확인 뒤 true', async () => {
      const seed = await waiting();
      const before = await preview({ stepRunId: seed.thumbnailStepRunId, faceOption: 'FULL_FACE' });
      expect(before.status).toBe(200);
      const body = before.body as PreviewBody;
      expect(body).toMatchObject({
        faceOption: 'FULL_FACE',
        requestedSizePx: 2048,
        promptAdjusted: false,
        realPersonNameDetected: false,
        blockedTerms: [],
        generationAllowed: false,
      });
      expect(body.prompt).toContain('2048 pixels');
      expect(body.prompt).toContain('Model framing: full face.');
      await saveRefs(seed.thumbnailStepRunId, [seed.originals[1]!.id]);
      const after = await preview({ stepRunId: seed.thumbnailStepRunId, faceOption: 'CHIN_CROP' });
      expect(after.body).toMatchObject({ generationAllowed: true, faceOption: 'CHIN_CROP' });
      expect((after.body as PreviewBody).prompt).toContain('crop at chin (face not shown)');
      // 저장하지 않는다
      expect(await t.prisma.generationRun.count()).toBe(0);
    });

    it('조정 문구에 차단어(내장·설정 추가분) → 200 + realPersonNameDetected + blockedTerms + generationAllowed=false', async () => {
      const seed = await waiting();
      await saveRefs(seed.thumbnailStepRunId, [seed.originals[0]!.id]);
      const res = await preview({
        stepRunId: seed.thumbnailStepRunId,
        faceOption: 'HANDS_UPPER_BODY',
        promptAdjustment: 'Make him look like ＢＴＳ and 가상아이돌테스트.',
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        promptAdjusted: true,
        realPersonNameDetected: true,
        blockedTerms: ['BTS', '가상아이돌테스트'],
        generationAllowed: false,
      });
      expect((res.body as PreviewBody).prompt).toMatch(/\n\nMake him look like/);
    });

    it('얼굴 옵션 3종 밖·조정 2000자 초과 → 422 VALIDATION_FAILED, ⑤ 아님 422 INVALID_STEP_CODE, 없는 실행 404, 헤더 없음 403', async () => {
      const seed = await waiting();
      const bad = await preview({ stepRunId: seed.thumbnailStepRunId, faceOption: 'SIDE' });
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('VALIDATION_FAILED');
      const long = await preview({
        stepRunId: seed.thumbnailStepRunId,
        faceOption: 'FULL_FACE',
        promptAdjustment: 'a'.repeat(2001),
      });
      expect(errorOf(long).code).toBe('VALIDATION_FAILED');
      const ok2000 = await preview({
        stepRunId: seed.thumbnailStepRunId,
        faceOption: 'FULL_FACE',
        promptAdjustment: 'a'.repeat(2000),
      });
      expect(ok2000.status).toBe(200);
      const notThumb = await preview({
        stepRunId: seed.sourcingStepRunId,
        faceOption: 'FULL_FACE',
      });
      expect(notThumb.status).toBe(422);
      expect(errorOf(notThumb).code).toBe('INVALID_STEP_CODE');
      expect((await preview({ stepRunId: 999999, faceOption: 'FULL_FACE' })).status).toBe(404);
      const noHeader = await http()
        .post('/api/v1/thumbnail-prompt-previews')
        .send({ stepRunId: seed.thumbnailStepRunId, faceOption: 'FULL_FACE' });
      expect(noHeader.status).toBe(403);
    });
  });

  describe('DB 트리거(추가만)', () => {
    it('image_asset·thumbnail_reference_input의 UPDATE·DELETE는 트리거로 거부된다', async () => {
      const seed = await waiting();
      const id = seed.originals[0]!.id;
      await expect(
        t.prisma.imageAsset.update({ where: { id }, data: { sourceShopCode: 'x' } }),
      ).rejects.toThrow();
      await expect(
        t.prisma.$executeRawUnsafe(`DELETE FROM image_asset WHERE id = ${id}`),
      ).rejects.toThrow();
      await saveRefs(seed.thumbnailStepRunId, [id]);
      await expect(
        t.prisma.$executeRawUnsafe('UPDATE thumbnail_reference_input SET sort_order = 2'),
      ).rejects.toThrow();
      await expect(
        t.prisma.$executeRawUnsafe('DELETE FROM thumbnail_reference_input'),
      ).rejects.toThrow();
      expect(await t.prisma.imageAsset.count()).toBe(6);
    });
  });
});
