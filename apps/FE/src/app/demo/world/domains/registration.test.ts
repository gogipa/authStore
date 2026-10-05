import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../../demoApi';
import { reachThumbnailDone, reachUploadDone, startDemoKit } from '../testkit';

/**
 * G4 최종 승인·⑨ 등록(D-32) — 화면이 보내는 요청 그대로: 승인 미리보기 · 사전 검증 · [승인·등록] · 등록 API 차단 스위치.
 * 지연은 0이고 `world.flush()`가 맡겨 둔 결과(실등록의 등록됨)를 지금 낸다.
 */
let demo: DemoApi;
let off: () => void;

beforeEach(() => {
  ({ demo, off } = startDemoKit());
});

afterEach(() => {
  off();
  expect(demo.serverErrors).toEqual([]);
  expect(demo.unknownRequests).toEqual([]);
});

const candidateId = 1;
const path = { params: { path: { candidateId } } };

const approval = (optionType?: string) =>
  api.GET('/candidates/{candidateId}/approval', {
    params: { path: { candidateId }, query: optionType ? { optionType: optionType as never } : {} },
  });
const preValidate = (body: object = { optionType: 'COMBINATION' }) =>
  api.POST('/candidates/{candidateId}/pre-validations', { ...path, body: body as never });
const candidate = async () => (await api.GET('/candidates/{candidateId}', path)).data!;
const registrations = async () =>
  (await api.GET('/candidates/{candidateId}/registrations', path)).data!;
const railOf = async (code: string) =>
  (await api.GET('/candidates/{candidateId}/steps', path)).data!.items.find(
    (item) => item.stepCode === code,
  )!;
const g4 = async () =>
  (await api.GET('/candidates/{candidateId}/gates', path)).data!.items.find(
    (item) => item.gate === 'G4',
  )!;

let nextKey = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++nextKey).padStart(12, '0')}`;

/** 화면이 보내는 승인 요청(미리보기가 준 버전 번호) */
async function approve(
  options: { key?: string; optionType?: string; upload?: number; judgement?: number } = {},
) {
  const preview = await approval();
  return api.POST('/candidates/{candidateId}/registrations', {
    params: {
      path: { candidateId },
      header: { 'Idempotency-Key': options.key ?? uuid() },
    },
    body: {
      optionType: (options.optionType ?? 'COMBINATION') as never,
      expectedUploadResultId: options.upload ?? preview.data?.uploadResultId ?? 1,
      expectedPriceJudgementId: options.judgement ?? preview.data?.priceJudgementId ?? 7,
    },
  });
}

describe('승인대기가 아닐 때(실제 BE는 200이 아니라 409)', () => {
  it('⑧ 전: 승인 미리보기·사전 검증 409 CANDIDATE_STATUS_INVALID(작업중, details.allowed)', async () => {
    await reachThumbnailDone(demo);
    const preview = await approval();
    expect(preview.response.status).toBe(409);
    expect(preview.error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(작업중)에서는 할 수 없습니다.',
      details: { status: 'WORKING', allowed: ['AWAITING_APPROVAL'] },
    });
    const check = await preValidate();
    expect(check.response.status).toBe(409);
    expect(check.error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(작업중)에서는 할 수 없습니다.',
    });
    // 승인 요청도 같은 오류(키·본문 검사를 지난 뒤 상태)
    const accepted = await approve({ upload: 1, judgement: 7 });
    expect(accepted.response.status).toBe(409);
    expect(accepted.error).toMatchObject({ code: 'CANDIDATE_STATUS_INVALID' });
    // 이력은 비어 있고 ⑨ 레일은 [실행] 막힘(최종 승인에서만)
    expect((await registrations()).content).toEqual([]);
    const register = await railOf('REGISTER');
    expect(register).toMatchObject({ status: 'NOT_RUN' });
    expect(register.actions.run).toMatchObject({
      enabled: false,
      disabledReason: { code: 'INVALID_STEP_CODE', message: '최종 승인(G4)에서만 등록합니다.' },
    });
    expect((await g4()).passed).toBe(false);
  });

  it('차단 스위치는 처음부터 켬(드라이런), 조회는 여정 없이도 된다', async () => {
    const res = await api.GET('/registration-switch');
    expect(res.data).toMatchObject({ apiBlocked: true });
    expect(res.data!.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('승인 미리보기 · 사전 검증', () => {
  beforeEach(async () => {
    await reachUploadDone(demo);
  });

  it('승인대기: 승인 버튼 켜짐, 버전 번호가 ⑧ 산출물·③ 판정과 같다', async () => {
    const preview = (await approval()).data!;
    const upload = (await api.GET('/candidates/{candidateId}/upload-result', path)).data!;
    const judgement = (await api.GET('/candidates/{candidateId}/price-judgement', path)).data!;
    expect(preview).toMatchObject({
      candidateId,
      candidateStatus: 'AWAITING_APPROVAL',
      optionType: 'COMBINATION',
      apiBlocked: true,
      approveEnabled: true,
      approveDisabledReason: null,
      displayStatusType: 'SUSPENSION',
      liveRegistrationCount: 0,
      initialSuspensionCount: 10,
      standardOptionSupported: false,
      sellerManagementCode: 'RKT:shop-a:10000123:108',
      productName: '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
      salePriceKrw: judgement.salePriceKrw,
      priceJudgementId: judgement.id,
      uploadResultId: upload.uploadResultId,
      judgedAt: judgement.judgedAt,
      rakutenPageCollectedAt: judgement.rakutenPageCollectedAt,
      judgementExpiresAt: judgement.pageValidUntil,
      originAreaCode: '0200036',
      originLabel: '베트남',
    });
    expect(preview.duplicate).toMatchObject({ duplicated: false, source: null });
    expect(preview.images.map((image) => [image.role, image.url])).toEqual(
      upload.images.map((image) => [image.role, image.url]),
    );
    expect(preview.detailContent).toBe(upload.detailContent);
    expect(preview.tags.map((tag) => tag.finalOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(preview.tags[0]).toMatchObject({ text: '젤카야노14' });
    expect(preview.marginBreakdown.sizes.map((size) => size.sizeMm)).toEqual([
      250, 255, 260, 265, 275,
    ]);
    expect(preview.marginBreakdown.sizes[0]).toMatchObject({
      profitAKrw: judgement.sizes[0]!.profitAKrw,
      marginRateA: judgement.sizes[0]!.marginRateA,
    });
    const draft = preview.requestJsonDraft as {
      originProduct: { salePrice: number };
      smartstoreChannelProduct: { channelProductDisplayStatusType: string };
    };
    expect(draft.originProduct.salePrice).toBe(judgement.salePriceKrw);
    expect(draft.smartstoreChannelProduct.channelProductDisplayStatusType).toBe('SUSPENSION');
    expect(JSON.stringify(preview)).not.toContain('[수입자]');
  });

  it('쿼리 검사: 모르는 조건·optionType 밖 값은 422, STANDARD는 켜진 채 꺼진 이유(VALIDATION_FAILED)', async () => {
    const unknown = await api.GET('/candidates/{candidateId}/approval', {
      params: { path: { candidateId }, query: { foo: '1' } as never },
    });
    expect(unknown.error).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
      fieldErrors: [{ field: 'foo', message: '받지 않는 조건입니다.' }],
    });
    const bad = await approval('GIANT');
    expect(bad.error).toMatchObject({
      code: 'INVALID_QUERY_PARAMETER',
      fieldErrors: [{ field: 'optionType', message: 'COMBINATION·STANDARD 중 하나여야 합니다.' }],
    });
    const standard = (await approval('STANDARD')).data!;
    expect(standard).toMatchObject({
      optionType: 'STANDARD',
      approveEnabled: false,
      approveDisabledReason: {
        code: 'VALIDATION_FAILED',
        message: '이 상품은 표준형 옵션으로 등록할 수 없습니다. 조합형으로 승인해 주세요.',
      },
    });
  });

  it('사전 검증: 15개 코드 순서 그대로 모두 BLOCK·통과, 변경 알림을 내지 않는다(조회처럼 쓰는 POST)', async () => {
    let changes = 0;
    const unsubscribe = demo.world.subscribe(() => {
      changes += 1;
    });
    const res = await preValidate();
    expect(res.response.status).toBe(200);
    expect(res.data).toMatchObject({ candidateId, approvable: true, warnings: [] });
    expect(res.data!.checks.map((check) => check.checkCode)).toEqual([
      'REQUIRED_FIELDS',
      'IMAGES',
      'OPTIONS',
      'TAGS',
      'NOTICE_BLOCK',
      'ORIGIN',
      'JAPAN_WORDING',
      'MIN_BLOCK_WORDS',
      'NEGATIVE_MARGIN',
      'EXTRA_CHARGE_WORDING',
      'JUDGEMENT_FRESHNESS',
      'REPRESENTATIVE_IMAGE_SOURCE',
      'STEP_FRESHNESS',
      'CATEGORY',
      'DUPLICATE',
    ]);
    for (const check of res.data!.checks) {
      expect(check).toEqual({
        checkCode: check.checkCode,
        passed: true,
        severity: 'BLOCK',
        reason: null,
        stepCode: null,
        gateCode: null,
      });
    }
    expect(res.data!.duplicate).toMatchObject({ duplicated: false });
    // 본문 없이도 조합형으로 검사한다
    const empty = await api.POST('/candidates/{candidateId}/pre-validations', path);
    expect(empty.response.status).toBe(200);
    const bad = await preValidate({ optionType: 'X' });
    expect(bad.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'optionType', message: 'COMBINATION·STANDARD 중 하나여야 합니다.' }],
    });
    unsubscribe();
    expect(changes).toBe(0);
  });

  it('판정 유효 시간(6시간)이 지나면: 승인 버튼 꺼짐 JUDGEMENT_EXPIRED · 사전 검증 한 항목 실패 · 승인 409', async () => {
    demo.world.s.times.pageCollected = demo.world.now() - 7 * 3_600_000;
    const preview = (await approval()).data!;
    expect(preview).toMatchObject({
      approveEnabled: false,
      approveDisabledReason: {
        code: 'JUDGEMENT_EXPIRED',
        message: "판정에 쓴 라쿠텐 페이지가 6시간이 넘었습니다. '재조회'로 다시 판정해 주세요.",
      },
    });
    const check = (await preValidate()).data!;
    expect(check.approvable).toBe(false);
    expect(check.checks.filter((c) => !c.passed).map((c) => c.checkCode)).toEqual([
      'JUDGEMENT_FRESHNESS',
    ]);
    expect(check.checks.find((c) => c.checkCode === 'JUDGEMENT_FRESHNESS')).toMatchObject({
      stepCode: 'SOURCING',
    });
    const res = await approve();
    expect(res.response.status).toBe(409);
    expect(res.error).toMatchObject({ code: 'JUDGEMENT_EXPIRED' });
    expect((await registrations()).content).toEqual([]);
  });
});

describe('[승인·등록] 검사 순서', () => {
  beforeEach(async () => {
    await reachUploadDone(demo);
  });

  it('Idempotency-Key가 없거나 비면 400 IDEMPOTENCY_KEY_REQUIRED(BE와 같다) — 승인만 요구한다', async () => {
    const body = {
      optionType: 'COMBINATION' as const,
      expectedUploadResultId: 1,
      expectedPriceJudgementId: 7,
    };
    const missing = await api.POST('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId } } as never,
      body,
    });
    expect(missing.response.status).toBe(400);
    expect(missing.error).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REQUIRED',
      message: '요청 번호가 빠졌습니다. 화면을 새로 고친 뒤 다시 해 주세요.',
    });
    const blank = await api.POST('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId }, header: { 'Idempotency-Key': '  ' } },
      body,
    });
    expect(blank.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    // 키를 본문보다 먼저 본다(본문이 틀려도 키가 없으면 400)
    const both = await api.POST('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId } } as never,
      body: { optionType: 'GIANT' } as never,
    });
    expect(both.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    expect(await registrations()).toMatchObject({ content: [] });
  });

  it('Idempotency-Key 모양·본문 칸 검사는 422 VALIDATION_FAILED(칸 이름)', async () => {
    const badKey = await api.POST('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId }, header: { 'Idempotency-Key': 'not-a-uuid' } },
      body: { optionType: 'COMBINATION', expectedUploadResultId: 1, expectedPriceJudgementId: 7 },
    });
    expect(badKey.response.status).toBe(422);
    expect(badKey.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'Idempotency-Key', message: 'UUID 형식이어야 합니다.' }],
    });
    const badBody = await api.POST('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId }, header: { 'Idempotency-Key': uuid() } },
      body: { optionType: 'GIANT', expectedUploadResultId: 0, extra: 1 } as never,
    });
    expect(badBody.error).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(badBody.error!.fieldErrors!.map((f) => f.field).sort()).toEqual([
      'expectedPriceJudgementId',
      'expectedUploadResultId',
      'extra',
      'optionType',
    ]);
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
  });

  it('화면이 본 버전과 다르면 409 VERSION_NOT_CURRENT(details에 기대·현재 번호)', async () => {
    const preview = (await approval()).data!;
    const res = await approve({ upload: preview.uploadResultId + 5 });
    expect(res.response.status).toBe(409);
    expect(res.error).toMatchObject({
      code: 'VERSION_NOT_CURRENT',
      message: '화면을 연 뒤 값이 바뀌었습니다. 새로 고친 뒤 다시 해 주세요.',
      details: {
        expectedUploadResultId: preview.uploadResultId + 5,
        currentUploadResultId: preview.uploadResultId,
        expectedPriceJudgementId: preview.priceJudgementId,
        currentPriceJudgementId: preview.priceJudgementId,
      },
    });
  });

  it('G2가 무효면 409 GATE_NOT_PASSED, STANDARD는 422 VALIDATION_FAILED(optionType)', async () => {
    const standard = await approve({ optionType: 'STANDARD' });
    expect(standard.response.status).toBe(422);
    expect(standard.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'optionType', message: '표준형 옵션을 쓸 수 없습니다.' }],
    });
    demo.world.s.gates.G2 = null;
    // 승인대기도 곧바로 작업중이 되지는 않는다(재평가는 단계가 움직일 때) — 모델을 직접 건드렸으니 여정 상태를 맞춘다
    expect((await approval()).data!.approveDisabledReason).toMatchObject({
      code: 'GATE_NOT_PASSED',
      message: 'G2 판정 확정을 먼저 통과해 주세요.',
    });
    const res = await approve();
    expect(res.error).toMatchObject({
      code: 'GATE_NOT_PASSED',
      message: 'G2 판정 확정을 먼저 통과해 주세요.',
      details: { gate: 'G2' },
    });
  });
});

describe('드라이런 → 스위치 끄기 → 실등록 → 스위치 켜기', () => {
  beforeEach(async () => {
    await reachUploadDone(demo);
  });

  it('차단 켬 승인은 동기 드라이런: 등록 기록 VALIDATED · ⑨ v1 COMPLETED · 여정 검증완료 · G4 통과', async () => {
    const key = uuid();
    const res = await approve({ key });
    expect(res.response.status).toBe(202);
    expect(res.data).toMatchObject({
      registrationId: 30,
      candidateId,
      status: 'VALIDATED',
      sellerManagementCode: 'RKT:shop-a:10000123:108',
      displayStatusType: 'SUSPENSION',
    });
    expect(Date.parse(res.data!.approvedAt)).not.toBeNaN();

    // 곧바로(flush 없이) 끝나 있다
    expect(demo.world.pendingTasks).toBe(0);
    const detail = await candidate();
    expect(detail).toMatchObject({
      status: 'VALIDATED',
      locked: false,
      approvedAt: res.data!.approvedAt,
    });
    const register = await railOf('REGISTER');
    expect(register).toMatchObject({ status: 'COMPLETED', lastVersion: 1 });
    expect(register.currentRun).toMatchObject({
      id: res.data!.stepRunId,
      version: 1,
      status: 'COMPLETED',
      executionMode: 'STEP',
    });
    const history = (await api.GET('/candidates/{candidateId}/status-history', path)).data!;
    expect(history.content[0]).toMatchObject({
      fromStatus: 'AWAITING_APPROVAL',
      toStatus: 'VALIDATED',
      reason: 'G4_APPROVED_BLOCKED',
      stepRunId: res.data!.stepRunId,
      registrationId: 30,
    });
    expect(await g4()).toMatchObject({ passed: true, registrationId: 30 });

    const list = await registrations();
    expect(list.page).toMatchObject({ number: 0, size: 20, totalElements: 1, totalPages: 1 });
    expect(list.content[0]).toMatchObject({
      registrationId: 30,
      stepRunVersion: 1,
      status: 'VALIDATED',
      optionType: 'COMBINATION',
      registeredAt: null,
      originProductNo: null,
      failedAt: null,
    });
    const one = await api.GET('/registrations/{registrationId}', {
      params: { path: { registrationId: 30 } },
    });
    expect(one.data).toMatchObject({
      registrationId: 30,
      candidateId,
      stepRunId: res.data!.stepRunId,
      status: 'VALIDATED',
      itemCode: 'shop-a:10000123',
      colorCode: '108',
      requestSentAt: null,
      smartstoreProductUrl: null,
    });
    expect((one.data!.validationResult as { checks: unknown[] }).checks).toHaveLength(15);

    // 검증완료 여정은 기본 목록에 보인다
    const defaults = await api.GET('/candidates', { params: { query: { size: 20 } } });
    expect(defaults.data!.content.map((c) => c.status)).toEqual(['VALIDATED']);

    // 승인 미리보기·사전 검증은 이제 409(검증완료)
    expect((await approval()).error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(검증완료)에서는 할 수 없습니다.',
    });
    expect((await preValidate()).error).toMatchObject({ code: 'CANDIDATE_STATUS_INVALID' });

    // 같은 키로 다시 보내면 첫 응답을 그대로(새 기록 없음), 같은 키 다른 본문은 422
    const again = await api.POST('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId }, header: { 'Idempotency-Key': key } },
      body: { optionType: 'COMBINATION', expectedUploadResultId: 1, expectedPriceJudgementId: 7 },
    });
    expect(again.response.status).toBe(202);
    expect(again.data).toEqual(res.data);
    expect((await registrations()).content).toHaveLength(1);
    const reused = await api.POST('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId }, header: { 'Idempotency-Key': key } },
      body: { optionType: 'STANDARD', expectedUploadResultId: 1, expectedPriceJudgementId: 7 },
    });
    expect(reused.response.status).toBe(422);
    expect(reused.error).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: '같은 요청 번호로 다른 내용을 보냈습니다. 화면을 새로 고친 뒤 다시 해 주세요.',
      details: { registrationId: 30 },
    });

    // 다른 키로 한 번 더 누르면(두 번 누름) 상태 검사에서 막힌다
    const twice = await approve();
    expect(twice.response.status).toBe(409);
    expect(twice.error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(검증완료)에서는 할 수 없습니다.',
    });
  });

  it('스위치를 끄면 검증완료 여정이 승인대기로 돌아온다(BLOCK_SWITCH_OFF) — 켤 때는 여정을 건드리지 않는다', async () => {
    await approve();
    const off1 = await api.PUT('/registration-switch', { body: { apiBlocked: false } });
    expect(off1.response.status).toBe(200);
    expect(off1.data).toMatchObject({ apiBlocked: false, revertedCandidateIds: [candidateId] });
    expect((await candidate()).status).toBe('AWAITING_APPROVAL');
    const history = (await api.GET('/candidates/{candidateId}/status-history', path)).data!;
    expect(history.content[0]).toMatchObject({
      fromStatus: 'VALIDATED',
      toStatus: 'AWAITING_APPROVAL',
      reason: 'BLOCK_SWITCH_OFF',
      registrationId: 30,
    });
    // G4는 다시 '확인 필요', 드라이런 기록은 이력에 남는다
    expect(await g4()).toMatchObject({ passed: false, registrationId: 30 });
    expect((await registrations()).content.map((r) => r.status)).toEqual(['VALIDATED']);
    // 미리보기는 다시 200, 차단 꺼짐, 드라이런은 처음 N건에 세지 않는다
    expect((await approval()).data).toMatchObject({
      apiBlocked: false,
      approveEnabled: true,
      liveRegistrationCount: 0,
      displayStatusType: 'SUSPENSION',
    });
    // 같은 값을 다시 보내면 아무것도 바뀌지 않는다
    const same = await api.PUT('/registration-switch', { body: { apiBlocked: false } });
    expect(same.data).toMatchObject({ apiBlocked: false, revertedCandidateIds: [] });
    expect(same.data!.changedAt).toBe(off1.data!.changedAt);
    const bad = await api.PUT('/registration-switch', { body: { apiBlocked: 'yes' } as never });
    expect(bad.response.status).toBe(422);
    expect(bad.error).toMatchObject({
      code: 'VALIDATION_FAILED',
      fieldErrors: [{ field: 'apiBlocked', message: 'true·false 중 하나여야 합니다.' }],
    });
  });

  it('실등록: 202 REGISTERING → 여정 등록요청중·⑨ v2 RUNNING → (두 번 누름은 409) → 지연 뒤 등록됨', async () => {
    await approve();
    await api.PUT('/registration-switch', { body: { apiBlocked: false } });
    const res = await approve();
    expect(res.response.status).toBe(202);
    expect(res.data).toMatchObject({ registrationId: 31, status: 'REGISTERING' });

    expect(await candidate()).toMatchObject({ status: 'REGISTERING', locked: true });
    const running = await railOf('REGISTER');
    expect(running).toMatchObject({ status: 'RUNNING', lastVersion: 2 });
    expect(running.currentRun).toMatchObject({ id: res.data!.stepRunId, version: 2 });
    expect(demo.world.progress().busy).toBe(true);
    expect((await registrations()).content.map((r) => [r.registrationId, r.status])).toEqual([
      [31, 'REGISTERING'],
      [30, 'VALIDATED'],
    ]);

    // 진행 중에 또 누르면 상태 검사보다 먼저 막힌다
    const twice = await approve({ upload: 1, judgement: 7 });
    expect(twice.response.status).toBe(409);
    expect(twice.error).toMatchObject({
      code: 'REGISTRATION_IN_PROGRESS',
      message: '이 여정의 등록이 진행 중이거나 결과 확인이 필요합니다.',
      details: { registrationId: 31, status: 'REGISTERING' },
    });
    expect((await approval()).error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(등록요청중)에서는 할 수 없습니다.',
    });
    // 단계 [실행]도 여정 잠금으로 막힌다
    const rerun = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'UPLOAD' } },
      body: {},
    });
    expect(rerun.error).toMatchObject({ code: 'CANDIDATE_LOCKED' });

    demo.world.flush();
    expect(await candidate()).toMatchObject({ status: 'REGISTERED', locked: true });
    const done = await railOf('REGISTER');
    expect(done).toMatchObject({ status: 'COMPLETED', lastVersion: 2 });
    expect(done.currentRun).toMatchObject({ version: 2, status: 'COMPLETED' });
    const history = (await api.GET('/candidates/{candidateId}/status-history', path)).data!;
    expect(history.content.slice(0, 2).map((h) => [h.fromStatus, h.toStatus, h.reason])).toEqual([
      ['REGISTERING', 'REGISTERED', 'REGISTER_SUCCEEDED'],
      ['AWAITING_APPROVAL', 'REGISTERING', 'G4_APPROVED'],
    ]);
    const list = (await registrations()).content;
    expect(list.map((r) => [r.registrationId, r.stepRunVersion, r.status])).toEqual([
      [31, 2, 'REGISTERED'],
      [30, 1, 'VALIDATED'],
    ]);
    expect(list[0]).toMatchObject({
      originProductNo: '10000000001',
      httpStatus: 200,
      displayStatusType: 'SUSPENSION',
      failedAt: null,
    });
    expect(list[0]!.registeredAt).not.toBeNull();
    const detail = (
      await api.GET('/registrations/{registrationId}', { params: { path: { registrationId: 31 } } })
    ).data!;
    expect(detail).toMatchObject({
      status: 'REGISTERED',
      originProductNo: '10000000001',
      channelProductNo: '10000000002',
      traceId: 'demo-trace-register-200',
      smartstoreProductUrl: null,
    });
    expect(await g4()).toMatchObject({ passed: true, registrationId: 31 });
    // 등록된 뒤: 기본 목록에서 빠지고, 다시 승인하면 상태 검사에서 막힌다
    const defaults = await api.GET('/candidates', { params: { query: { size: 20 } } });
    expect(defaults.data!.content).toEqual([]);
    const again = await approve({ upload: 1, judgement: 7 });
    expect(again.error).toMatchObject({
      code: 'CANDIDATE_STATUS_INVALID',
      message: '지금 여정 상태(등록됨)에서는 할 수 없습니다.',
    });
    expect(demo.world.progress().registered).toBe(true);

    // 스위치를 다시 켜도 여정은 등록됨 그대로
    const on = await api.PUT('/registration-switch', { body: { apiBlocked: true } });
    expect(on.data).toMatchObject({ apiBlocked: true, revertedCandidateIds: [] });
    expect((await candidate()).status).toBe('REGISTERED');
    expect((await api.GET('/registration-switch')).data).toMatchObject({ apiBlocked: true });
  });

  it('처음 N건 셈: 등록됨은 센다(실등록 뒤 liveRegistrationCount 1)', async () => {
    await api.PUT('/registration-switch', { body: { apiBlocked: false } });
    await approve();
    // 진행 중에는 여정이 승인대기가 아니라 미리보기가 409지만, 모델은 진행 중 기록도 센다
    const world = demo.world;
    expect(world.s.registration.records.map((r) => r.status)).toEqual(['REGISTERING']);
    world.flush();
    expect(world.s.registration.records.map((r) => r.status)).toEqual(['REGISTERED']);
  });

  it('없는 등록 기록은 404 REGISTRATION_NOT_FOUND, 모르는 조건은 422', async () => {
    const missing = await api.GET('/registrations/{registrationId}', {
      params: { path: { registrationId: 999 } },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.error).toMatchObject({
      code: 'REGISTRATION_NOT_FOUND',
      message: '등록 기록을 찾을 수 없습니다.',
    });
    const weird = await api.GET('/registrations/{registrationId}', {
      params: { path: { registrationId: 'abc' as never } },
    });
    expect(weird.error).toMatchObject({ code: 'REGISTRATION_NOT_FOUND' });
    const query = await api.GET('/candidates/{candidateId}/registrations', {
      params: { path: { candidateId }, query: { foo: 'x' } as never },
    });
    expect(query.error).toMatchObject({ code: 'INVALID_QUERY_PARAMETER' });
  });

  it('결과 확인(result-checks)은 체험에서 403 안내다', async () => {
    const res = await api.POST('/registrations/{registrationId}/result-checks', {
      params: { path: { registrationId: 30 } },
    });
    expect(res.response.status).toBe(403);
    expect(res.error).toMatchObject({ code: 'DEMO_READ_ONLY' });
    expect(demo.readOnlyRequests).toEqual(['POST /registrations/30/result-checks']);
  });
});
