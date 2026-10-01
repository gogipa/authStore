import request from 'supertest';
import {
  ProgressEventsService,
  type PublishedProgressEvent,
} from '../../src/common/events/progress-events.service.js';
import { clearKnownSecrets } from '../../src/common/secrets/secret-mask.js';
import { SECRET_STORE } from '../../src/common/secrets/secret-store.port.js';
import { CommerceTokenService } from '../../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { UploadQueue } from '../../src/modules/registration/upload/upload-queue.js';
import { StepExecutor } from '../../src/modules/step-engine/execution/step-executor.js';
import {
  insertNoticeHtmlVersion,
  seedUploadReady,
  truncateUpload,
  type UploadReadySeed,
} from '../fixtures/registration/upload/seed-upload-ready.js';
import { createCandidate } from '../fixtures/step-engine/candidate.factory.js';
import { createTestApp, type TestApp } from '../helpers/test-app.js';
import { FakeCommerceImagesServer } from '../support/fake-commerce-images.js';
import {
  FAKE_ACCESS_TOKEN,
  FakeCommerceTransport,
  signatureVector,
} from '../support/fake-commerce-transport.js';
import { InMemorySecretStore } from '../support/in-memory-secret-store.js';

const CLIENT = { 'X-AutoStore-Client': '1' };

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string }[];
}

interface UploadImageBody {
  id: number;
  uploadedImageId: number;
  role: string;
  sortOrder: number;
  url: string;
  sourceSha256: string;
  imageAssetId: number;
  uploadedAt: string;
  traceId: string | null;
  reused: boolean;
}

interface UploadResultBody {
  stepRunId: number;
  candidateId: number;
  version: number;
  stepRunStatus: string;
  isCurrent: boolean;
  uploadResultId: number;
  detailContent: string;
  detailContentSha256: string;
  createdAt: string;
  images: UploadImageBody[];
}

interface StepRunBody {
  id: number;
  status: string;
  failureKind: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  aiEngine: string | null;
  version: number;
}

describe('⑧ 이미지 업로드(P4-01) e2e — autostore_test·실제 UPLOAD 실행기(가짜 커머스 업로드 서버)', () => {
  let t: TestApp;
  const store = new InMemorySecretStore();
  const commerce = new FakeCommerceTransport();
  const server = new FakeCommerceImagesServer().install(commerce);
  const events: PublishedProgressEvent[] = [];
  let unsubscribe: () => void = () => undefined;
  const v = signatureVector();

  const http = () => request(t.app.getHttpServer());
  const post = (path: string, body: object = {}) =>
    http().post(`/api/v1${path}`).set(CLIENT).send(body);
  const get = (path: string) => http().get(`/api/v1${path}`);
  const idle = async () => {
    await t.app.get(StepExecutor).whenIdle();
    await t.app.get(UploadQueue).whenIdle();
  };
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const runUpload = (candidateId: number) => post(`/candidates/${candidateId}/steps/UPLOAD/runs`);
  const runAndWait = async (candidateId: number) => {
    const res = await runUpload(candidateId);
    expect(res.status).toBe(202);
    await idle();
    return res.body as { stepRunId: number; version: number };
  };
  const uploadResult = async (candidateId: number, query = ''): Promise<UploadResultBody> => {
    const res = await get(`/candidates/${candidateId}/upload-result${query}`);
    expect(res.status).toBe(200);
    return res.body as UploadResultBody;
  };
  const stepRun = async (id: number) => (await get(`/step-runs/${id}`)).body as StepRunBody;
  const stepRow = (candidateId: number, stepCode: string) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode } },
    });
  const putKeys = async () => {
    await store.set('COMMERCE_CLIENT_ID', v.clientId);
    await store.set('COMMERCE_CLIENT_SECRET', v.clientSecret);
  };
  const uploadRuns = (candidateId: number) =>
    t.prisma.stepRun.count({ where: { candidateId, stepCode: 'UPLOAD' } });

  beforeAll(async () => {
    t = await createTestApp({ overrides: [{ provide: SECRET_STORE, useValue: store }] });
    const sub = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) => events.push(e));
    unsubscribe = () => sub.unsubscribe();
  });

  beforeEach(async () => {
    await idle();
    await truncateUpload(t.prisma);
    store.reset();
    await putKeys();
    commerce.reset();
    server.reset();
    t.fetch.reset();
    // 가짜 커머스 서버를 가짜 fetch(HTTP_FETCH) 뒤에 둔다 → 실제 관문(허용 목록·UA·call_log)을 지난다
    t.fetch.handler = commerce.fetchHandler;
    t.app.get(CommerceTokenService).invalidate();
    events.length = 0;
  });

  afterAll(async () => {
    await idle();
    await truncateUpload(t.prisma);
    unsubscribe();
    await t.app.close();
    clearKnownSecrets();
  });

  describe('실행(규칙 1·4·6·8·9·14, F-AP-01~06)', () => {
    it('202 + Location → 완료 뒤 upload-result 200: 대표·추가 2장, 가짜 shop-phinf URL, 자리표시자 없는 detailContent, 로컬 경로 없음', async () => {
      const seed = await seedUploadReady(t);
      const res = await runUpload(seed.candidate.id);
      expect(res.status).toBe(202);
      const accepted = res.body as { stepRunId: number; aiEngine: string | null };
      expect(res.headers.location).toBe(`/api/v1/step-runs/${accepted.stepRunId}`);
      expect(accepted.aiEngine).toBeNull();
      await idle();

      const run = await stepRun(accepted.stepRunId);
      expect(run).toMatchObject({ status: 'COMPLETED', aiEngine: null, version: 1 });
      const body = await uploadResult(seed.candidate.id);
      expect(body).toMatchObject({
        stepRunId: accepted.stepRunId,
        candidateId: seed.candidate.id,
        version: 1,
        stepRunStatus: 'COMPLETED',
        isCurrent: true,
      });
      expect(body.images.map((i) => [i.role, i.sortOrder, i.reused])).toEqual([
        ['REPRESENTATIVE', 0, false],
        ['ADDITIONAL', 1, false],
      ]);
      for (const image of body.images) {
        expect(image.url).toMatch(/^https:\/\/shop-phinf\.pstatic\.net\/fake\//);
        expect(image.traceId).toBe('fixture-trace-upload-200');
      }
      expect(body.images.map((i) => i.sourceSha256)).toEqual(seed.images.map((i) => i.sha256));
      expect(body.detailContent).not.toContain('autostore-image:');
      expect(body.detailContent).toContain(`<img src="${body.images[0]!.url}" alt="대표 이미지">`);
      expect(body.detailContent).toContain(
        `<img src="${body.images[1]!.url}" alt="추가 이미지 1">`,
      );
      expect(body.detailContent).not.toContain('data-autostore-image-slot="2"');
      expect(body.detailContentSha256).toMatch(/^[0-9a-f]{64}$/);
      const text = JSON.stringify(body);
      expect(text).not.toContain('filePath');
      expect(text).not.toContain('images/');

      // 정규화본(규칙 6): UPLOAD·PERMITTED·derived_from = 원천·candidate_id, 1000×1000 JPEG
      const uploads = await t.prisma.imageAsset.findMany({
        where: { kind: 'UPLOAD' },
        orderBy: { id: 'asc' },
      });
      expect(
        uploads.map((u) => [
          u.derivedFromImageAssetId,
          u.usageRight,
          u.mimeType,
          u.width,
          u.height,
          u.candidateId,
        ]),
      ).toEqual(
        seed.images.map((i) => [i.id, 'PERMITTED', 'image/jpeg', 1000, 1000, seed.candidate.id]),
      );
      expect(body.images.map((i) => i.imageAssetId)).toEqual(uploads.map((u) => u.id));

      // 가짜 서버(규칙 8·14): 요청 1건·부분 2개·필드 imageFiles·바이트 합 = 정규화본 크기 합, 토큰은 Authorization에만
      expect(server.requestCount).toBe(1);
      const [upload] = server.uploads;
      expect(upload!.partCount).toBe(2);
      expect(upload!.fieldNames).toEqual(['imageFiles', 'imageFiles']);
      expect(upload!.byteSum).toBe(uploads.reduce((sum, u) => sum + u.byteSize, 0));
      expect(upload!.files.map((f) => f.type)).toEqual(['image/jpeg', 'image/jpeg']);
      expect(upload!.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
      expect(upload!.url).not.toContain(FAKE_ACCESS_TOKEN);

      // uploaded_image(Trace-ID)·call_log(COMMERCE_API, 토큰 없음)
      const cached = await t.prisma.uploadedImage.findMany({ orderBy: { id: 'asc' } });
      expect(cached.map((c) => [c.sourceSha256, c.traceId])).toEqual(
        seed.images.map((i) => [i.sha256, 'fixture-trace-upload-200']),
      );
      const logs = await t.prisma.callLog.findMany({ where: { target: 'COMMERCE_API' } });
      const uploadLogs = logs.filter((l) => l.urlMasked?.endsWith('/v1/product-images/upload'));
      expect(uploadLogs).toHaveLength(1);
      expect(uploadLogs[0]).toMatchObject({
        candidateId: seed.candidate.id,
        stepRunId: accepted.stepRunId,
        succeeded: true,
        httpStatus: 200,
        traceId: 'fixture-trace-upload-200',
      });
      expect(JSON.stringify(logs)).not.toContain(FAKE_ACCESS_TOKEN);
      // 업로드만으로는 스토어 등록이 없다(⑧은 '완료', 후보는 작업중)
      expect((await stepRow(seed.candidate.id, 'UPLOAD')).status).toBe('COMPLETED');
    });

    it('입력이 같은 두 번째 실행 → version 2, 업로드 호출 0, images[].reused=true, 본문 해시 같음(F-AP-05·F-BS-19)', async () => {
      const seed = await seedUploadReady(t);
      await runAndWait(seed.candidate.id);
      const first = await uploadResult(seed.candidate.id);
      t.clock.advance(60_000);
      const second = await runAndWait(seed.candidate.id);
      expect(second.version).toBe(2);
      expect(server.requestCount).toBe(1);
      const body = await uploadResult(seed.candidate.id);
      expect(body).toMatchObject({ version: 2, isCurrent: true });
      expect(body.images.every((i) => i.reused)).toBe(true);
      expect(body.images.map((i) => i.url)).toEqual(first.images.map((i) => i.url));
      expect(body.detailContentSha256).toBe(first.detailContentSha256);
      expect(await t.prisma.imageAsset.count({ where: { kind: 'UPLOAD' } })).toBe(2);
      // 이전 버전은 ?stepRunId=로 본다
      const previous = await uploadResult(seed.candidate.id, `?stepRunId=${first.stepRunId}`);
      expect(previous).toMatchObject({ version: 1, isCurrent: false });
      expect(previous.images.every((i) => !i.reused)).toBe(true);
    });

    it('이전 버전 다시 고르기(RESTORE_VERSION) → 산출물을 새 버전으로 복사(업로드 호출 없음)', async () => {
      const seed = await seedUploadReady(t);
      const first = await runAndWait(seed.candidate.id);
      t.clock.advance(60_000);
      await runAndWait(seed.candidate.id);
      const res = await post(`/candidates/${seed.candidate.id}/steps/UPLOAD/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: first.stepRunId,
      });
      expect(res.status).toBe(201);
      const restored = await uploadResult(seed.candidate.id);
      const original = await uploadResult(seed.candidate.id, `?stepRunId=${first.stepRunId}`);
      expect(restored.version).toBe(3);
      expect(restored.detailContentSha256).toBe(original.detailContentSha256);
      expect(restored.images.map((i) => i.uploadedImageId)).toEqual(
        original.images.map((i) => i.uploadedImageId),
      );
      expect(server.requestCount).toBe(1);
      // ⑧에는 '그대로 유지'가 없다
      const keep = await post(`/candidates/${seed.candidate.id}/steps/UPLOAD/owner-edits`, {
        ownerAction: 'KEEP_AS_IS',
        baseStepRunId: restored.stepRunId,
      });
      expect(keep.status).toBe(422);
      expect(errorOf(keep).code).toBe('KEEP_AS_IS_NOT_ALLOWED');
    });
  });

  describe('시작 전 막기(규칙 1·2)', () => {
    it('G3 통과 기록 없음 → 409 GATE_NOT_PASSED(details.gate=G3), 실행을 만들지 않는다', async () => {
      const seed = await seedUploadReady(t, { passG3: false });
      const res = await runUpload(seed.candidate.id);
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'GATE_NOT_PASSED',
        details: { gate: 'G3', stepCode: 'UPLOAD' },
      });
      expect(await uploadRuns(seed.candidate.id)).toBe(0);
    });

    it('가짜 키체인이 비었음 → 409 SECRET_NOT_CONFIGURED(details.secretKeys), 실행·외부 호출 없음', async () => {
      const seed = await seedUploadReady(t);
      store.reset();
      const res = await runUpload(seed.candidate.id);
      expect(res.status).toBe(409);
      expect(errorOf(res)).toMatchObject({
        code: 'SECRET_NOT_CONFIGURED',
        details: { secretKeys: ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'] },
      });
      expect(await uploadRuns(seed.candidate.id)).toBe(0);
      expect(t.fetch.calls).toHaveLength(0);
    });

    it('임시 후보 → 409 TEMP_CANDIDATE_NOT_ALLOWED, 등록요청중 후보 → 409 CANDIDATE_LOCKED', async () => {
      const temp = (await createCandidate(t.prisma, { gender: 'MALE' })).candidate;
      await t.prisma.candidate.update({
        where: { id: temp.id },
        data: { status: 'TEMP', creationPath: 'DIRECT_INPUT', rakutenQuery: null },
      });
      const tempRes = await runUpload(temp.id);
      expect(tempRes.status).toBe(409);
      expect(errorOf(tempRes)).toMatchObject({
        code: 'TEMP_CANDIDATE_NOT_ALLOWED',
        details: { stepCode: 'UPLOAD' },
      });
      const locked = (await createCandidate(t.prisma, { status: 'REGISTERING' })).candidate;
      const lockedRes = await runUpload(locked.id);
      expect(lockedRes.status).toBe(409);
      expect(errorOf(lockedRes).code).toBe('CANDIDATE_LOCKED');
      expect(server.requestCount).toBe(0);
    });
  });

  describe('재실행 필요(규칙 10·11, F-AP-07·US-33 AC3)', () => {
    /** ⑥-3 v1(html A) → v2(html B, 현재)로 두고 ⑧을 v2로 돌린다 */
    const uploadedOnSecondHtml = async (): Promise<
      UploadReadySeed & { firstHtmlRunId: number }
    > => {
      const seed = await seedUploadReady(t);
      const firstHtmlRunId = seed.noticeHtmlStepRunId;
      const htmlB = seed.html.replace(
        '[해외구매대행 상품 안내]',
        '[해외구매대행 상품 안내 · 개정]',
      );
      const second = await insertNoticeHtmlVersion(t, seed.candidate.id, htmlB);
      await runAndWait(seed.candidate.id);
      return { ...seed, html: htmlB, noticeHtmlStepRunId: second, firstHtmlRunId };
    };

    it('⑥-3 새 버전만 생김 → ⑧만 RERUN_REQUIRED(staleInputs noticeHtml.html), ⑥-1·⑦은 완료 그대로, 자동 업로드 없음 → 다시 실행은 업로드 0건·본문만 새로', async () => {
      const seed = await uploadedOnSecondHtml();
      const before = await uploadResult(seed.candidate.id);
      expect(before.detailContent).toContain('개정');
      events.length = 0;
      // ⑥-3 이전 버전 다시 고르기(RESTORE_VERSION) — 엔진이 ⑥-3 새 버전을 닫으며 직접 읽는 ⑧로 전파한다
      const restore = await post(`/candidates/${seed.candidate.id}/steps/NOTICE_HTML/owner-edits`, {
        ownerAction: 'RESTORE_VERSION',
        baseStepRunId: seed.firstHtmlRunId,
      });
      expect(restore.status).toBe(201);
      await idle();
      const upload = await stepRow(seed.candidate.id, 'UPLOAD');
      expect(upload).toMatchObject({ status: 'RERUN_REQUIRED', staleInputs: ['noticeHtml.html'] });
      expect((await stepRow(seed.candidate.id, 'COPY')).status).toBe('COMPLETED');
      expect((await stepRow(seed.candidate.id, 'TAGS')).status).toBe('COMPLETED');
      expect(await uploadRuns(seed.candidate.id)).toBe(1);
      expect(server.requestCount).toBe(1);
      expect(
        events.some(
          (e) =>
            e.name === 'candidate-step.changed' &&
            (e.data as { stepCode: string; status: string }).stepCode === 'UPLOAD' &&
            (e.data as { status: string }).status === 'RERUN_REQUIRED',
        ),
      ).toBe(true);

      t.clock.advance(60_000);
      await runAndWait(seed.candidate.id);
      const after = await uploadResult(seed.candidate.id);
      expect(after.version).toBe(2);
      expect(server.requestCount).toBe(1);
      expect(after.images.every((i) => i.reused)).toBe(true);
      expect(after.detailContent).not.toContain('개정');
      expect(after.detailContentSha256).not.toBe(before.detailContentSha256);
      expect((await stepRow(seed.candidate.id, 'UPLOAD')).status).toBe('COMPLETED');
    });

    it('⑤ 다시 고르기(다른 선택본) → ⑧만 RERUN_REQUIRED(thumbnail.selection), ⑥-3·⑥-1·⑦은 완료 그대로', async () => {
      const seed = await seedUploadReady(t);
      await runAndWait(seed.candidate.id);
      const [rep, add] = seed.images;
      const pass = await post(`/candidates/${seed.candidate.id}/gates/G3/pass`, {
        basisStepRunId: seed.thumbnailStepRunId,
        representativeImageAssetId: add!.id,
        additionalImageAssetIds: [rep!.id],
        checklist: {
          shoeRatioOver70: true,
          detailMatch: true,
          colorMatchesSelectedColor: true,
          referenceNoPerson: true,
          noRealPersonResemblance: true,
          noTextOrPrice: true,
          singleProductSingleModel: true,
        },
      });
      expect(pass.status).toBe(201);
      await idle();
      expect(await stepRow(seed.candidate.id, 'UPLOAD')).toMatchObject({
        status: 'RERUN_REQUIRED',
        staleInputs: ['thumbnail.selection'],
      });
      for (const code of ['NOTICE_HTML', 'COPY', 'TAGS']) {
        expect((await stepRow(seed.candidate.id, code)).status).toBe('COMPLETED');
      }
      expect(server.requestCount).toBe(1);

      t.clock.advance(60_000);
      await runAndWait(seed.candidate.id);
      const after = await uploadResult(seed.candidate.id);
      // 순서만 바뀐 같은 파일이라 다시 올리지 않고 역할·순서만 새로
      expect(server.requestCount).toBe(1);
      expect(after.images.map((i) => [i.role, i.sourceSha256])).toEqual([
        ['REPRESENTATIVE', add!.sha256],
        ['ADDITIONAL', rep!.sha256],
      ]);
    });
  });

  describe('실패(규칙 5·14)', () => {
    it('가짜 서버 500 → 202로 시작, 실행 기록 FAILED·EXTERNAL_API·한국어 문구 + SSE, 산출물 404', async () => {
      const seed = await seedUploadReady(t);
      server.failNext('500');
      const accepted = await runAndWait(seed.candidate.id);
      const run = await stepRun(accepted.stepRunId);
      expect(run).toMatchObject({
        status: 'FAILED',
        failureKind: 'EXTERNAL_API',
        errorCode: 'EXTERNAL_API_ERROR',
      });
      expect(run.errorMessage).toMatch(/^커머스API 이미지 업로드에 실패했습니다\. .*HTTP 500/);
      expect(
        events.some(
          (e) =>
            e.name === 'step-run.status-changed' &&
            (e.data as { stepRunId: number; status: string }).stepRunId === accepted.stepRunId &&
            (e.data as { status: string }).status === 'FAILED',
        ),
      ).toBe(true);
      expect(await t.prisma.uploadedImage.count()).toBe(0);
      const res = await get(`/candidates/${seed.candidate.id}/upload-result`);
      expect(res.status).toBe(404);
      expect(errorOf(res).code).toBe('STEP_OUTPUT_NOT_FOUND');
      const failedLog = await t.prisma.callLog.findFirst({
        where: { target: 'COMMERCE_API', httpStatus: 500 },
      });
      expect(failedLog).toMatchObject({ succeeded: false, stepRunId: accepted.stepRunId });

      // 다시 실행하면 올린다(만들어 둔 정규화본을 다시 쓴다)
      t.clock.advance(60_000);
      await runAndWait(seed.candidate.id);
      expect((await uploadResult(seed.candidate.id)).images).toHaveLength(2);
      expect(await t.prisma.imageAsset.count({ where: { kind: 'UPLOAD' } })).toBe(2);
    });

    it('선택본에 원본(참조 전용)을 억지로 넣은 seed → FAILED·INPUT_VALIDATION·IMAGE_NOT_ALLOWED, 업로드 호출 0', async () => {
      const seed = await seedUploadReady(t, { withOriginal: true });
      const accepted = await runAndWait(seed.candidate.id);
      expect(await stepRun(accepted.stepRunId)).toMatchObject({
        status: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'IMAGE_NOT_ALLOWED',
      });
      expect(server.requestCount).toBe(0);
      expect(await t.prisma.imageAsset.count({ where: { kind: 'UPLOAD' } })).toBe(0);
      expect(t.fetch.calls.filter((c) => c.url.endsWith('/v1/product-images/upload'))).toHaveLength(
        0,
      );
    });
  });

  describe('조회(규칙 13)', () => {
    it('산출물 없음 404 STEP_OUTPUT_NOT_FOUND · ?stepRunId=abc 422 · 모르는 쿼리 422 · 다른 후보의 실행 404 STEP_RUN_NOT_FOUND · 없는 후보 404', async () => {
      const seed = await seedUploadReady(t);
      const none = await get(`/candidates/${seed.candidate.id}/upload-result`);
      expect(none.status).toBe(404);
      expect(errorOf(none)).toMatchObject({
        code: 'STEP_OUTPUT_NOT_FOUND',
        details: { stepCode: 'UPLOAD' },
      });
      const bad = await get(`/candidates/${seed.candidate.id}/upload-result?stepRunId=abc`);
      expect(bad.status).toBe(422);
      expect(errorOf(bad)).toMatchObject({
        code: 'INVALID_QUERY_PARAMETER',
        fieldErrors: [{ field: 'stepRunId' }],
      });
      const unknown = await get(`/candidates/${seed.candidate.id}/upload-result?foo=1`);
      expect(unknown.status).toBe(422);

      const other = await seedUploadReady(t);
      const otherRun = await runAndWait(other.candidate.id);
      const wrong = await get(
        `/candidates/${seed.candidate.id}/upload-result?stepRunId=${otherRun.stepRunId}`,
      );
      expect(wrong.status).toBe(404);
      expect(errorOf(wrong).code).toBe('STEP_RUN_NOT_FOUND');
      // ⑤ 실행 id도 ⑧ 실행이 아니다
      const notUpload = await get(
        `/candidates/${seed.candidate.id}/upload-result?stepRunId=${seed.thumbnailStepRunId}`,
      );
      expect(errorOf(notUpload).code).toBe('STEP_RUN_NOT_FOUND');
      const missing = await get('/candidates/999999/upload-result');
      expect(missing.status).toBe(404);
      expect(errorOf(missing).code).toBe('CANDIDATE_NOT_FOUND');
    });
  });

  describe('DB 규칙(규칙 7·12)', () => {
    it('닫힌 ⑧ 산출물은 고칠 수 없고(trg_output_frozen), uploaded_image는 추가만(trg_append_only)', async () => {
      const seed = await seedUploadReady(t);
      await runAndWait(seed.candidate.id);
      await expect(
        t.prisma.$executeRawUnsafe(`UPDATE upload_result SET detail_content = 'x'`),
      ).rejects.toThrow(/cannot change|closed step_run/);
      await expect(
        t.prisma.$executeRawUnsafe(`UPDATE upload_result_image SET sort_order = sort_order`),
      ).rejects.toThrow(/closed step_run/);
      await expect(
        t.prisma.$executeRawUnsafe(`UPDATE uploaded_image SET trace_id = 'x'`),
      ).rejects.toThrow();
      await expect(t.prisma.$executeRawUnsafe(`DELETE FROM uploaded_image`)).rejects.toThrow();
      // 같은 원천 해시는 한 행(UNIQUE source_sha256)
      expect(await t.prisma.uploadedImage.count()).toBe(2);
    });
  });
});
