import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Subscription } from 'rxjs';
import { SECRET_STORE } from '../../src/common/secrets/secret-store.port.js';
import { ProgressEventsService } from '../../src/common/events/progress-events.service.js';
import { HTTP_FETCH } from '../../src/modules/integrations/http/http-fetch.token.js';
import { COMMERCE_TOKEN_PATH } from '../../src/modules/integrations/naver-commerce/commerce-endpoints.js';
import { COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH } from '../../src/modules/integrations/naver-commerce/commerce-images.port.js';
import { COMMERCE_RESTRICTED_TAGS_PATH } from '../../src/modules/integrations/naver-commerce/commerce-tags.port.js';
import { CommerceTokenService } from '../../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { RegistrationRestartCheck } from '../../src/modules/registration/result-check/result-check.service.js';
import { RegistrationSubmitter } from '../../src/modules/registration/submit/registration-submitter.js';
import { readDefaultSettingsText } from '../../src/modules/settings/defaults/default-settings.js';
import { writeSettingsFileAtomically } from '../../src/modules/settings/settings-file.loader.js';
import { RestartRecoveryService } from '../../src/modules/step-engine/recovery/restart-recovery.service.js';
import {
  seedApprovableCandidate,
  truncateApproval,
  type ApprovableSeed,
} from '../fixtures/registration/approval/seed-approvable-candidate.js';
import { createCandidate } from '../fixtures/step-engine/candidate.factory.js';
import { insertStepRun } from '../fixtures/step-engine/step-run.factory.js';
import { createTestApp, TEST_START_MS, type TestApp } from '../helpers/test-app.js';
import { FakeCommerceProductsServer } from '../support/fake-commerce-products.js';
import {
  commerceAuthFixture,
  FakeCommerceTransport,
  FAKE_ACCESS_TOKEN,
  signatureVector,
} from '../support/fake-commerce-transport.js';
import { InMemorySecretStore } from '../support/in-memory-secret-store.js';

const DATA_DIR = process.env.APP_DATA_DIR!;
const CLIENT = { 'X-AutoStore-Client': '1' };

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string }[];
}

interface AcceptedBody {
  registrationId: number;
  stepRunId: number;
  candidateId: number;
  status: string;
  sellerManagementCode: string;
  displayStatusType: string;
  approvedAt: string;
}

/** 등록 호출 응답 대기 1초(설정 registration.requestTimeoutSeconds — 타임아웃 시나리오를 짧게) */
function registerSettingsText(): string {
  const settings = JSON.parse(readDefaultSettingsText()) as {
    registration: { requestTimeoutSeconds: number };
  };
  settings.registration.requestTimeoutSeconds = 1;
  return `${JSON.stringify(settings, null, 2)}\n`;
}

describe('⑨ 등록(P4-03) e2e — autostore_test·가짜 커머스API(등록·SELLER_CODE·restricted-tags)', () => {
  let t: TestApp;
  let origin: string;
  const store = new InMemorySecretStore();
  const commerce = new FakeCommerceTransport();
  const products = new FakeCommerceProductsServer();
  const v = signatureVector();
  const events: { name: string; data: Record<string, unknown> }[] = [];
  let subscription: Subscription;

  const http = () => request(t.app.getHttpServer());
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const bodyOf = (seed: ApprovableSeed, optionType = 'COMBINATION') => ({
    optionType,
    expectedUploadResultId: seed.uploadResultId,
    expectedPriceJudgementId: seed.priceJudgementId,
  });
  const approve = (candidateId: number, body: object, key: string | null = randomUUID()) => {
    const req = http()
      .post(`/api/v1/candidates/${candidateId}/registrations`)
      .set('Origin', origin)
      .set(CLIENT);
    return (key === null ? req : req.set('Idempotency-Key', key)).send(body);
  };
  const setSwitch = (apiBlocked: boolean) =>
    http()
      .put('/api/v1/registration-switch')
      .set('Origin', origin)
      .set(CLIENT)
      .send({ apiBlocked });
  const resultCheck = (registrationId: number) =>
    http()
      .post(`/api/v1/registrations/${registrationId}/result-checks`)
      .set('Origin', origin)
      .set(CLIENT)
      .send();
  const idle = () => t.app.get(RegistrationSubmitter).whenIdle();
  const candidateOf = (id: number) => t.prisma.candidate.findUniqueOrThrow({ where: { id } });
  const registrationOf = (id: number) => t.prisma.registration.findUniqueOrThrow({ where: { id } });
  const lastHistory = async (candidateId: number) =>
    (
      await t.prisma.candidateStatusHistory.findMany({
        where: { candidateId },
        orderBy: { id: 'desc' },
        take: 1,
      })
    )[0]!;
  const registerStep = (candidateId: number) =>
    t.prisma.candidateStep.findUniqueOrThrow({
      where: { candidateId_stepCode: { candidateId, stepCode: 'REGISTER' } },
    });
  const uploadRequests = () =>
    commerce.requests.filter((r) => r.path.endsWith(COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH));

  /** 실제 스토어(샌드박스 없음): 차단 스위치를 끄기 전에 밖으로 나가는 HTTP가 가짜 fetch인지 먼저 단언한다(작업 지시 §8) */
  const assertFakeCommerce = () => {
    expect(t.app.get(HTTP_FETCH)).toBe(t.fetch.fn);
  };
  const switchOff = async () => {
    assertFakeCommerce();
    expect((await setSwitch(false)).status).toBe(200);
  };

  beforeAll(async () => {
    await writeSettingsFileAtomically(DATA_DIR, registerSettingsText());
    t = await createTestApp({ overrides: [{ provide: SECRET_STORE, useValue: store }] });
    origin = `http://127.0.0.1:${t.port}`;
    subscription = t.app
      .get(ProgressEventsService)
      .stream()
      .subscribe((e) =>
        events.push({ name: e.name, data: e.data as unknown as Record<string, unknown> }),
      );
  });

  beforeEach(async () => {
    await idle();
    products.release();
    await truncateApproval(t.prisma);
    store.reset();
    await store.set('COMMERCE_CLIENT_ID', v.clientId);
    await store.set('COMMERCE_CLIENT_SECRET', v.clientSecret);
    commerce.reset();
    products.reset();
    commerce.defaultResponder = (req) => {
      if (req.path.endsWith(COMMERCE_TOKEN_PATH)) return commerceAuthFixture('token-200');
      if (req.path.endsWith(COMMERCE_RESTRICTED_TAGS_PATH)) {
        const tags = new URL(req.url).searchParams.getAll('tags');
        return {
          status: 200,
          headers: { 'GNCP-GW-Trace-ID': 'fixture-trace-restricted' },
          body: tags.map((tag) => ({ tag, restricted: false })),
        };
      }
      return commerceAuthFixture('api-200-ok');
    };
    t.fetch.reset();
    t.fetch.handler = products.fetchHandler(commerce);
    t.app.get(CommerceTokenService).invalidate();
    t.clock.ms = TEST_START_MS;
    events.length = 0;
  });

  afterAll(async () => {
    subscription?.unsubscribe();
    products.release();
    await idle();
    await truncateApproval(t.prisma);
    await t.app.close();
  });

  it('새 DB에서 GET /registration-switch → apiBlocked true(기본 켬)', async () => {
    const res = await http().get('/api/v1/registration-switch');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ apiBlocked: true });
    expect(typeof (res.body as { changedAt: string }).changedAt).toBe('string');
  });

  describe('드라이런(차단 켬)·멱등·스위치 끄기', () => {
    it('K1 → 202 VALIDATED, 등록 호출 0, 후보 VALIDATED, ⑨ COMPLETED, GATE_PASSED(G4) 1행, 검증 결과 15개', async () => {
      const seed = await seedApprovableCandidate(t);
      const key = randomUUID();
      const res = await approve(seed.candidate.id, bodyOf(seed), key);
      expect(res.status).toBe(202);
      const accepted = res.body as AcceptedBody;
      expect(res.headers.location).toBe(`/api/v1/registrations/${accepted.registrationId}`);
      expect(accepted).toMatchObject({
        candidateId: seed.candidate.id,
        status: 'VALIDATED',
        sellerManagementCode: 'RKT:shop-a:10000123:108',
        displayStatusType: 'SUSPENSION',
      });
      expect(products.creates).toHaveLength(0);
      expect((await candidateOf(seed.candidate.id)).status).toBe('VALIDATED');
      const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: accepted.stepRunId } });
      expect(run).toMatchObject({ stepCode: 'REGISTER', status: 'COMPLETED', aiEngine: null });
      expect((await registerStep(seed.candidate.id)).status).toBe('COMPLETED');
      const row = await registrationOf(accepted.registrationId);
      expect(row).toMatchObject({
        status: 'VALIDATED',
        requestSentAt: null,
        originProductNo: null,
        idempotencyKey: key,
        optionType: 'COMBINATION',
        uploadResultId: seed.uploadResultId,
        priceJudgementId: seed.priceJudgementId,
      });
      expect(JSON.stringify(row.requestJson)).not.toMatch(/access_token|client_secret|Bearer/i);
      const logs = await t.prisma.userActionLog.findMany({
        where: { candidateId: seed.candidate.id, eventType: 'GATE_PASSED', gate: 'G4' },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]!.registrationId).toBe(accepted.registrationId);
      expect(await lastHistory(seed.candidate.id)).toMatchObject({
        toStatus: 'VALIDATED',
        reason: 'G4_APPROVED_BLOCKED',
        registrationId: accepted.registrationId,
      });
      const detail = await http().get(`/api/v1/registrations/${accepted.registrationId}`);
      expect(detail.status).toBe(200);
      const body = detail.body as Record<string, unknown> & {
        validationResult: { checks: unknown[] };
      };
      expect(body.validationResult.checks).toHaveLength(15);
      expect(body).not.toHaveProperty('requestJson');
      expect(body.candidateId).toBe(seed.candidate.id);
      expect(
        events.some(
          (e) =>
            e.name === 'registration.status-changed' &&
            e.data.registrationId === accepted.registrationId &&
            e.data.status === 'VALIDATED',
        ),
      ).toBe(true);
      // G4 게이트는 통과로 보인다
      const gates = (await http().get(`/api/v1/candidates/${seed.candidate.id}/gates`)).body as {
        items: { gate: string; passed: boolean }[];
      };
      expect(gates.items.find((g) => g.gate === 'G4')?.passed).toBe(true);

      // 같은 K1 다시 → 202, 같은 registrationId, 행 수 1
      const again = await approve(seed.candidate.id, bodyOf(seed), key);
      expect(again.status).toBe(202);
      expect((again.body as AcceptedBody).registrationId).toBe(accepted.registrationId);
      expect(await t.prisma.registration.count()).toBe(1);
      // 같은 K1·다른 optionType → 422 IDEMPOTENCY_KEY_REUSED
      const reused = await approve(seed.candidate.id, bodyOf(seed, 'STANDARD'), key);
      expect(reused.status).toBe(422);
      expect(errorOf(reused).code).toBe('IDEMPOTENCY_KEY_REUSED');

      // 스위치 끄기 → 검증완료 후보를 승인대기로(BLOCK_SWITCH_OFF), 같은 값 다시 → 200·[]
      assertFakeCommerce();
      const off = await setSwitch(false);
      expect(off.status).toBe(200);
      expect(off.body).toMatchObject({
        apiBlocked: false,
        revertedCandidateIds: [seed.candidate.id],
      });
      expect((await candidateOf(seed.candidate.id)).status).toBe('AWAITING_APPROVAL');
      expect(await lastHistory(seed.candidate.id)).toMatchObject({
        toStatus: 'AWAITING_APPROVAL',
        reason: 'BLOCK_SWITCH_OFF',
        registrationId: accepted.registrationId,
      });
      expect(await t.prisma.userActionLog.count({ where: { eventType: 'SETTING_CHANGED' } })).toBe(
        1,
      );
      expect(events.some((e) => e.name === 'registration-switch.changed')).toBe(true);
      const same = await setSwitch(false);
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({ apiBlocked: false, revertedCandidateIds: [] });
      expect(await t.prisma.userActionLog.count({ where: { eventType: 'SETTING_CHANGED' } })).toBe(
        1,
      );
      expect((await http().get('/api/v1/registration-switch')).body).toMatchObject({
        apiBlocked: false,
      });
      // 끈 뒤에는 G4가 다시 '확인 필요'
      const gates2 = (await http().get(`/api/v1/candidates/${seed.candidate.id}/gates`)).body as {
        items: { gate: string; passed: boolean }[];
      };
      expect(gates2.items.find((g) => g.gate === 'G4')?.passed).toBe(false);
    });
  });

  describe('실제 등록(차단 끔)', () => {
    it('성공: 202 REGISTERING → 기록 REGISTERED(숫자 문자열 상품 번호), 후보 REGISTERED, 전시중지, 요청 본문 = request_json', async () => {
      const seed = await seedApprovableCandidate(t);
      await switchOff();
      const res = await approve(seed.candidate.id, bodyOf(seed));
      expect(res.status).toBe(202);
      const accepted = res.body as AcceptedBody;
      expect(accepted.status).toBe('REGISTERING');
      await idle();
      const row = await registrationOf(accepted.registrationId);
      expect(row).toMatchObject({
        status: 'REGISTERED',
        originProductNo: '10000000001',
        channelProductNo: '20000000001',
        displayStatusType: 'SUSPENSION',
        httpStatus: 200,
        traceId: 'fixture-trace-products-200',
        failedAt: null,
      });
      expect(row.originProductNo).toMatch(/^[0-9]+$/);
      expect(row.requestSentAt).not.toBeNull();
      expect(row.registeredAt).not.toBeNull();
      expect((await candidateOf(seed.candidate.id)).status).toBe('REGISTERED');
      expect(await lastHistory(seed.candidate.id)).toMatchObject({
        toStatus: 'REGISTERED',
        reason: 'REGISTER_SUCCEEDED',
        registrationId: accepted.registrationId,
      });
      expect(
        (await t.prisma.stepRun.findUniqueOrThrow({ where: { id: accepted.stepRunId } })).status,
      ).toBe('COMPLETED');
      expect(products.creates).toHaveLength(1);
      expect(products.creates[0]!.body).toEqual(row.requestJson);
      expect(products.creates[0]!.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
      expect(JSON.stringify(products.creates[0]!.body)).not.toContain(FAKE_ACCESS_TOKEN);
      expect(products.creates[0]!.body).toMatchObject({
        smartstoreChannelProduct: { channelProductDisplayStatusType: 'SUSPENSION' },
      });
      // 이미지를 다시 올리지 않는다
      expect(uploadRequests()).toHaveLength(0);
      const log = await t.prisma.callLog.findFirst({
        where: { stepRunId: accepted.stepRunId, target: 'COMMERCE_API' },
      });
      expect(log?.traceId).toBe('fixture-trace-products-200');
      const statusEvents = events.filter(
        (e) =>
          e.name === 'registration.status-changed' &&
          e.data.registrationId === accepted.registrationId,
      );
      expect(statusEvents.map((e) => e.data.status)).toEqual(['REGISTERING', 'REGISTERED']);
    });

    it('4xx: 기록 REGISTERING + failedAt·INVALID_INPUT_4XX·한국어 문구·추적 번호, 후보 승인대기 → 새 키로 재승인하면 새 행(같은 판매자관리코드), 업로드 0', async () => {
      const seed = await seedApprovableCandidate(t);
      await switchOff();
      products.createMode = '400';
      const first = (await approve(seed.candidate.id, bodyOf(seed))).body as AcceptedBody;
      await idle();
      const failed = await registrationOf(first.registrationId);
      expect(failed).toMatchObject({
        status: 'REGISTERING',
        failureKind: 'INVALID_INPUT_4XX',
        httpStatus: 400,
        errorCode: 'BadRequest',
        traceId: 'fixture-trace-products-400',
      });
      expect(failed.failedAt).not.toBeNull();
      expect(failed.errorMessage).toContain('커머스API가 등록 요청을 거절했습니다');
      expect(failed.errorMessage).toContain('태그: 쓸 수 없는 값입니다(제한)');
      expect(failed.invalidInputs).toHaveLength(2);
      expect((await candidateOf(seed.candidate.id)).status).toBe('AWAITING_APPROVAL');
      expect(await lastHistory(seed.candidate.id)).toMatchObject({ reason: 'REGISTER_4XX' });
      expect(
        await t.prisma.stepRun.findUniqueOrThrow({ where: { id: first.stepRunId } }),
      ).toMatchObject({ status: 'FAILED', failureKind: 'EXTERNAL_API', errorCode: 'BadRequest' });

      products.createMode = '200';
      const second = await approve(seed.candidate.id, bodyOf(seed));
      expect(second.status).toBe(202);
      const accepted = second.body as AcceptedBody;
      expect(accepted.registrationId).not.toBe(first.registrationId);
      expect(accepted.sellerManagementCode).toBe(first.sellerManagementCode);
      await idle();
      expect((await registrationOf(accepted.registrationId)).status).toBe('REGISTERED');
      expect(uploadRequests()).toHaveLength(0);
      const list = await http().get(`/api/v1/candidates/${seed.candidate.id}/registrations`);
      expect(list.status).toBe(200);
      const page = list.body as {
        content: { registrationId: number; stepRunVersion: number; errorMessage: string | null }[];
        page: { totalElements: number };
      };
      expect(page.page.totalElements).toBe(2);
      expect(page.content.map((r) => r.registrationId)).toEqual([
        accepted.registrationId,
        first.registrationId,
      ]);
      expect(page.content.map((r) => r.stepRunVersion)).toEqual([2, 1]);
    });

    it('5xx: 기록·후보 결과확인필요, 등록 호출 정확히 1회 → result-checks(found) REGISTERED(SELLER_CODE_FOUND, 검색 코드 = 기록 코드) → 다시 409', async () => {
      const seed = await seedApprovableCandidate(t);
      await switchOff();
      products.createMode = '500';
      const accepted = (await approve(seed.candidate.id, bodyOf(seed))).body as AcceptedBody;
      await idle();
      expect(products.creates).toHaveLength(1);
      const row = await registrationOf(accepted.registrationId);
      expect(row).toMatchObject({
        status: 'RESULT_CHECK_REQUIRED',
        httpStatus: 500,
        failedAt: null,
      });
      expect((await candidateOf(seed.candidate.id)).status).toBe('RESULT_CHECK_REQUIRED');
      expect(await lastHistory(seed.candidate.id)).toMatchObject({ reason: 'REGISTER_UNKNOWN' });

      // 진행 중 기록이 있으면 409 REGISTRATION_IN_PROGRESS(상태 검사보다 먼저)
      const busy = await approve(seed.candidate.id, bodyOf(seed));
      expect(busy.status).toBe(409);
      expect(errorOf(busy).code).toBe('REGISTRATION_IN_PROGRESS');

      products.searchMode = 'FOUND';
      const check = await resultCheck(accepted.registrationId);
      expect(check.status).toBe(200);
      expect(check.body).toMatchObject({
        registrationId: accepted.registrationId,
        found: true,
        status: 'REGISTERED',
        originProductNo: '10000000001',
        candidateStatus: 'REGISTERED',
      });
      expect(products.searches.at(-1)!.body).toMatchObject({
        searchKeywordType: 'SELLER_CODE',
        sellerManagementCode: row.sellerManagementCode,
      });
      expect(await lastHistory(seed.candidate.id)).toMatchObject({
        toStatus: 'REGISTERED',
        reason: 'SELLER_CODE_FOUND',
      });
      // 닫힌 ⑨는 그대로 FAILED
      expect(
        (await t.prisma.stepRun.findUniqueOrThrow({ where: { id: accepted.stepRunId } })).status,
      ).toBe('FAILED');
      expect(products.creates).toHaveLength(1);
      const again = await resultCheck(accepted.registrationId);
      expect(again.status).toBe(409);
      expect(errorOf(again).code).toBe('REGISTRATION_STATUS_INVALID');
    });

    it('타임아웃(응답 없음): 결과확인필요, 등록 호출 1회 → result-checks(empty) NOT_FOUND_ON_CHECK·후보 승인대기 → 다시 409', async () => {
      const seed = await seedApprovableCandidate(t);
      await switchOff();
      products.createMode = 'TIMEOUT';
      const accepted = (await approve(seed.candidate.id, bodyOf(seed))).body as AcceptedBody;
      await idle();
      expect(products.creates).toHaveLength(1);
      const row = await registrationOf(accepted.registrationId);
      expect(row).toMatchObject({
        status: 'RESULT_CHECK_REQUIRED',
        httpStatus: null,
        errorCode: 'TIMEOUT',
        responseReceivedAt: null,
      });
      expect((await candidateOf(seed.candidate.id)).status).toBe('RESULT_CHECK_REQUIRED');

      products.searchMode = 'EMPTY';
      const check = await resultCheck(accepted.registrationId);
      expect(check.status).toBe(200);
      expect(check.body).toMatchObject({
        found: false,
        status: 'RESULT_CHECK_REQUIRED',
        failureKind: 'NOT_FOUND_ON_CHECK',
        candidateStatus: 'AWAITING_APPROVAL',
      });
      expect(await lastHistory(seed.candidate.id)).toMatchObject({
        toStatus: 'AWAITING_APPROVAL',
        reason: 'SELLER_CODE_NOT_FOUND',
      });
      const again = await resultCheck(accepted.registrationId);
      expect(again.status).toBe(409);
      expect(errorOf(again).code).toBe('REGISTRATION_STATUS_INVALID');
    });

    it('재시작: 응답 전에 앱이 꺼지면 ⑨ FAILED(INTERRUPTED)·기록·후보 결과확인필요(APP_RESTART) → 자동 조회로 REGISTERED', async () => {
      const seed = await seedApprovableCandidate(t);
      await switchOff();
      products.createMode = 'HOLD';
      const accepted = (await approve(seed.candidate.id, bodyOf(seed))).body as AcceptedBody;
      await waitFor(() => products.creates.length === 1);
      await t.app.get(RestartRecoveryService).recover();
      expect(
        await t.prisma.stepRun.findUniqueOrThrow({ where: { id: accepted.stepRunId } }),
      ).toMatchObject({ status: 'FAILED', failureKind: 'INTERRUPTED' });
      expect((await registrationOf(accepted.registrationId)).status).toBe('RESULT_CHECK_REQUIRED');
      expect(await lastHistory(seed.candidate.id)).toMatchObject({
        toStatus: 'RESULT_CHECK_REQUIRED',
        reason: 'APP_RESTART',
        registrationId: accepted.registrationId,
      });
      // 붙잡힌 응답이 늦게 와도 반영하지 않는다(이미 결과확인필요)
      products.release();
      await idle();
      expect((await registrationOf(accepted.registrationId)).status).toBe('RESULT_CHECK_REQUIRED');
      products.searchMode = 'FOUND';
      expect(await t.app.get(RegistrationRestartCheck).runOnce()).toEqual([
        accepted.registrationId,
      ]);
      expect((await registrationOf(accepted.registrationId)).status).toBe('REGISTERED');
      expect((await candidateOf(seed.candidate.id)).status).toBe('REGISTERED');
    });
  });

  describe('승인 요청 검사(규칙 5)', () => {
    it('키 없음 400, UUID 아님 422, 헤더 없음 403', async () => {
      const seed = await seedApprovableCandidate(t);
      const noKey = await approve(seed.candidate.id, bodyOf(seed), null);
      expect(noKey.status).toBe(400);
      expect(errorOf(noKey).code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const badKey = await approve(seed.candidate.id, bodyOf(seed), 'not-a-uuid');
      expect(badKey.status).toBe(422);
      expect(errorOf(badKey).code).toBe('VALIDATION_FAILED');
      const noHeader = await http()
        .post(`/api/v1/candidates/${seed.candidate.id}/registrations`)
        .set('Idempotency-Key', randomUUID())
        .send(bodyOf(seed));
      expect(noHeader.status).toBe(403);
      expect(errorOf(noHeader).code).toBe('CLIENT_HEADER_REQUIRED');
      const badBody = await approve(seed.candidate.id, { optionType: 'BAD' });
      expect(badBody.status).toBe(422);
      expect(errorOf(badBody).code).toBe('VALIDATION_FAILED');
      expect((await approve(99999, bodyOf(seed))).status).toBe(404);
      expect(await t.prisma.registration.count()).toBe(0);
    });

    it('WORKING 409 CANDIDATE_STATUS_INVALID, 옛 expectedUploadResultId 409 VERSION_NOT_CURRENT', async () => {
      const working = await seedApprovableCandidate(t, { status: 'WORKING' });
      const res = await approve(working.candidate.id, bodyOf(working));
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('CANDIDATE_STATUS_INVALID');
      expect(errorOf(res).details?.allowed).toEqual(['AWAITING_APPROVAL']);
      await truncateApproval(t.prisma);
      const seed = await seedApprovableCandidate(t);
      const old = await approve(seed.candidate.id, {
        ...bodyOf(seed),
        expectedUploadResultId: seed.uploadResultId + 1000,
      });
      expect(old.status).toBe(409);
      expect(errorOf(old).code).toBe('VERSION_NOT_CURRENT');
      // 409면 외부 조회(restricted-tags·SELLER_CODE)를 하지 않는다
      expect(products.searches).toHaveLength(0);
    });

    it('수집 6시간 1초 뒤 409 JUDGEMENT_EXPIRED', async () => {
      const seed = await seedApprovableCandidate(t, {
        collectedAt: new Date(TEST_START_MS - 6 * 3_600_000 - 1000),
      });
      const res = await approve(seed.candidate.id, bodyOf(seed));
      expect(res.status).toBe(409);
      expect(errorOf(res).code).toBe('JUDGEMENT_EXPIRED');
    });

    it('같은 item+색상 REGISTERED 기록 409 DUPLICATE_REGISTRATION, 가짜 검색이 상품을 돌려줘도 409', async () => {
      const seed = await seedApprovableCandidate(t);
      await insertLiveRegistration(t, seed, 'REGISTERED');
      const local = await approve(seed.candidate.id, bodyOf(seed));
      expect(local.status).toBe(409);
      expect(errorOf(local).code).toBe('DUPLICATE_REGISTRATION');
      expect(errorOf(local).details).toMatchObject({ source: 'LOCAL' });

      await truncateApproval(t.prisma);
      const fresh = await seedApprovableCandidate(t);
      products.searchMode = 'FOUND';
      const remote = await approve(fresh.candidate.id, bodyOf(fresh));
      expect(remote.status).toBe(409);
      expect(errorOf(remote).code).toBe('DUPLICATE_REGISTRATION');
      expect(errorOf(remote).details).toMatchObject({
        source: 'COMMERCE_API',
        originProductNo: '10000000001',
      });
      expect(await t.prisma.registration.count()).toBe(0);
    });

    it('상품명 101자 → 422 PRE_VALIDATION_FAILED(details.checks에 REQUIRED_FIELDS false)', async () => {
      const seed = await seedApprovableCandidate(t, { productName: '가'.repeat(101) });
      const res = await approve(seed.candidate.id, bodyOf(seed));
      expect(res.status).toBe(422);
      const error = errorOf(res);
      expect(error.code).toBe('PRE_VALIDATION_FAILED');
      expect(error.message).toContain('필수 항목');
      const checks = error.details?.checks as { checkCode: string; passed: boolean }[];
      expect(checks).toHaveLength(15);
      expect(checks.find((c) => c.checkCode === 'REQUIRED_FIELDS')?.passed).toBe(false);
      expect(await t.prisma.registration.count()).toBe(0);
    });
  });

  it('DB 방어선: 같은 판매자관리코드의 진행 중 행을 직접 INSERT하면 UNIQUE 위반', async () => {
    const seed = await seedApprovableCandidate(t);
    await insertLiveRegistration(t, seed, 'REGISTERING');
    await expect(insertLiveRegistration(t, seed, 'REGISTERING')).rejects.toThrow();
  });

  it('목록·상세 조회: size=101·sort=foo,asc 422, 없는 기록 404, 상세에 requestJson 키 없음', async () => {
    const seed = await seedApprovableCandidate(t);
    const big = await http().get(`/api/v1/candidates/${seed.candidate.id}/registrations?size=101`);
    expect(big.status).toBe(422);
    expect(errorOf(big).code).toBe('INVALID_QUERY_PARAMETER');
    const sort = await http().get(
      `/api/v1/candidates/${seed.candidate.id}/registrations?sort=foo,asc`,
    );
    expect(sort.status).toBe(422);
    expect(errorOf(sort).code).toBe('INVALID_QUERY_PARAMETER');
    const empty = await http().get(`/api/v1/candidates/${seed.candidate.id}/registrations`);
    expect(empty.body).toMatchObject({ content: [], page: { totalElements: 0 } });
    const missing = await http().get('/api/v1/registrations/999');
    expect(missing.status).toBe(404);
    expect(errorOf(missing).code).toBe('REGISTRATION_NOT_FOUND');
    expect((await http().get('/api/v1/registrations/abc')).status).toBe(404);
    expect((await http().get('/api/v1/candidates/99999/registrations')).status).toBe(404);
  });

  it('POST …/steps/REGISTER/runs → 422 INVALID_STEP_CODE(⑨는 G4 승인으로만)', async () => {
    const seed = await seedApprovableCandidate(t);
    const res = await http()
      .post(`/api/v1/candidates/${seed.candidate.id}/steps/REGISTER/runs`)
      .set('Origin', origin)
      .set(CLIENT)
      .send({});
    expect(res.status).toBe(422);
    expect(errorOf(res).code).toBe('INVALID_STEP_CODE');
  });
});

/** 조건이 맞을 때까지 잠깐씩 기다린다(실시간 — 최대 2초) */
async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('조건을 기다리다 시간이 지났습니다');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * 같은 상품·색상의 진행 중·등록됨 등록 기록을 직접 넣는다(다른 후보의 ⑨ 버전 — 중복·DB 방어선 e2e). 판정·⑧ 산출물 FK는 시드 후보의 것을 쓴다
 */
async function insertLiveRegistration(
  t: TestApp,
  seed: ApprovableSeed,
  status: 'REGISTERING' | 'REGISTERED',
): Promise<number> {
  const other = (
    await createCandidate(t.prisma, {
      status: 'WORKING',
      creationPath: 'KEYWORD',
      anchor: { modelCode: 'OTHERMODEL', colorCode: '108' },
    })
  ).candidate;
  const run = await insertStepRun(t.prisma, {
    candidateId: other.id,
    stepCode: 'REGISTER',
    status: 'COMPLETED',
  });
  const row = await t.prisma.registration.create({
    data: {
      stepRunId: run.id,
      priceJudgementId: seed.priceJudgementId,
      uploadResultId: seed.uploadResultId,
      status,
      itemCode: seed.candidate.itemCode!,
      selectedColor: seed.candidate.selectedColor!,
      colorCode: '108',
      sellerManagementCode: `RKT:${seed.candidate.itemCode!}:108`,
      displayStatusType: 'SUSPENSION',
      requestJson: {},
      validationResult: {},
      approvedAt: new Date(TEST_START_MS - 3_600_000),
      ...(status === 'REGISTERED'
        ? { originProductNo: '555', registeredAt: new Date(TEST_START_MS - 3_000_000) }
        : {}),
    },
  });
  return row.id;
}
