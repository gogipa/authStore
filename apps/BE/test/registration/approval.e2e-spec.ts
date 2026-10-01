import request from 'supertest';
import { SECRET_STORE } from '../../src/common/secrets/secret-store.port.js';
import { COMMERCE_TOKEN_PATH } from '../../src/modules/integrations/naver-commerce/commerce-endpoints.js';
import { COMMERCE_RESTRICTED_TAGS_PATH } from '../../src/modules/integrations/naver-commerce/commerce-tags.port.js';
import { CommerceTokenService } from '../../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { readVariant } from '../fixtures/registration/approval/approval-fixtures.js';
import {
  seedApprovableCandidate,
  truncateApproval,
  type ApprovableSeed,
} from '../fixtures/registration/approval/seed-approvable-candidate.js';
import { createTestApp, TEST_START_MS, type TestApp } from '../helpers/test-app.js';
import {
  commerceAuthFixture,
  FakeCommerceTransport,
  signatureVector,
  type CommerceFixture,
  type RecordedCommerceRequest,
} from '../support/fake-commerce-transport.js';
import { FakeCommerceProductsServer } from '../support/fake-commerce-products.js';
import { InMemorySecretStore } from '../support/in-memory-secret-store.js';

const CLIENT = { 'X-AutoStore-Client': '1' };

interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  fieldErrors?: { field: string; message: string }[];
}

interface CheckBody {
  checkCode: string;
  passed: boolean;
  severity: string;
  reason: string | null;
  stepCode: string | null;
  gateCode: string | null;
}

interface PreValidationBody {
  candidateId: number;
  approvable: boolean;
  checks: CheckBody[];
  checkedAt: string;
  warnings: unknown[];
}

interface PreviewBody {
  candidateId: number;
  candidateStatus: string;
  optionType: string;
  apiBlocked: boolean;
  productName: string;
  salePriceKrw: number;
  priceJudgementId: number;
  uploadResultId: number;
  rakutenPageCollectedAt: string | null;
  judgementExpiresAt: string | null;
  marginBreakdown: {
    targetMarginRate: number;
    sizes: { sizeMm: number; stockQuantity: number | null }[];
  };
  images: { role: string; sortOrder: number; url: string }[];
  detailContent: string;
  noticeFields: Record<string, string>;
  originLabel: string | null;
  tags: { text: string; finalOrder: number }[];
  sourcingMethod: { method: string; itemCode: string } | null;
  requestJsonDraft: Record<string, unknown>;
  sellerManagementCode: string;
  displayStatusType: string;
  duplicate: { duplicated: boolean };
  approveEnabled: boolean;
  approveDisabledReason: { code: string; message: string } | null;
  warnings: unknown[];
}

/** 가짜 restricted-tags 응답(fixture) → 요청한 태그마다 판정 */
function restrictedResponder(name: string): (req: RecordedCommerceRequest) => CommerceFixture {
  const fixture = readVariant(name) as unknown as { status: number; body: unknown };
  return (req): CommerceFixture => {
    if (fixture.status !== 200) return { status: fixture.status, headers: {}, body: fixture.body };
    const verdicts = new Map(
      (fixture.body as { tag: string; restricted: boolean }[]).map((v) => [v.tag, v.restricted]),
    );
    const tags = new URL(req.url).searchParams.getAll('tags');
    return {
      status: 200,
      headers: { 'GNCP-GW-Trace-ID': 'fixture-trace-restricted' },
      body: tags.map((tag) => ({ tag, restricted: verdicts.get(tag) ?? false })),
    };
  };
}

/** 모든 키를 재귀로 모은다(요청 초안에 비밀 키 이름이 없는지) */
function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      out.push(key);
      keysOf(v, out);
    }
  }
  return out;
}

describe('G4 승인 미리보기·사전 검증(P4-02) e2e — autostore_test·가짜 커머스 restricted-tags', () => {
  let t: TestApp;
  let origin: string;
  const store = new InMemorySecretStore();
  const commerce = new FakeCommerceTransport();
  // P4-03: 사전 검증이 판매자관리코드(SELLER_CODE)도 조회한다 — 기본은 '없음'
  const products = new FakeCommerceProductsServer();
  let restricted = restrictedResponder('restricted-tags.200-none.json');
  const v = signatureVector();

  const http = () => request(t.app.getHttpServer());
  const preview = (id: number, query = '') =>
    http().get(`/api/v1/candidates/${id}/approval${query}`);
  const preValidate = (id: number, body: object = {}) =>
    http()
      .post(`/api/v1/candidates/${id}/pre-validations`)
      .set('Origin', origin)
      .set(CLIENT)
      .send(body);
  const errorOf = (res: { body: unknown }) => res.body as ErrorBody;
  const checkOf = (body: PreValidationBody, code: string) =>
    body.checks.find((c) => c.checkCode === code)!;
  const restrictedRequests = () =>
    commerce.requests.filter((r) => r.path.endsWith(COMMERCE_RESTRICTED_TAGS_PATH));

  beforeAll(async () => {
    t = await createTestApp({ overrides: [{ provide: SECRET_STORE, useValue: store }] });
    origin = `http://127.0.0.1:${t.port}`;
  });

  beforeEach(async () => {
    await truncateApproval(t.prisma);
    store.reset();
    await store.set('COMMERCE_CLIENT_ID', v.clientId);
    await store.set('COMMERCE_CLIENT_SECRET', v.clientSecret);
    commerce.reset();
    restricted = restrictedResponder('restricted-tags.200-none.json');
    commerce.defaultResponder = (req) => {
      if (req.path.endsWith(COMMERCE_TOKEN_PATH)) return commerceAuthFixture('token-200');
      if (req.path.endsWith(COMMERCE_RESTRICTED_TAGS_PATH)) return restricted(req);
      return commerceAuthFixture('api-200-ok');
    };
    t.fetch.reset();
    // 가짜 커머스 서버를 가짜 fetch(HTTP_FETCH) 뒤에 둔다 → 실제 관문(허용 목록·UA·call_log)을 지난다
    products.reset();
    t.fetch.handler = products.fetchHandler(commerce);
    t.app.get(CommerceTokenService).invalidate();
    t.clock.ms = TEST_START_MS;
  });

  afterAll(async () => {
    await truncateApproval(t.prisma);
    await t.app.close();
  });

  describe('GET /candidates/{id}/approval', () => {
    let seed: ApprovableSeed;
    beforeEach(async () => {
      seed = await seedApprovableCandidate(t);
    });

    it('200: 대표이미지·판매자관리코드·비밀 없는 요청 초안·승인 켜짐, 현재 버전 id·유효 끝 시각', async () => {
      const res = await preview(seed.candidate.id);
      expect(res.status).toBe(200);
      const body = res.body as PreviewBody;
      expect(body.candidateStatus).toBe('AWAITING_APPROVAL');
      expect(body.optionType).toBe('COMBINATION');
      expect(body.apiBlocked).toBe(true);
      expect(body.images[0]).toMatchObject({ role: 'REPRESENTATIVE', sortOrder: 0 });
      expect(body.images).toHaveLength(2);
      expect(body.sellerManagementCode).toMatch(/^RKT:.+:.+$/);
      expect(body.sellerManagementCode).toBe('RKT:shop-a:10000123:108');
      expect(
        keysOf(body.requestJsonDraft).filter((k) => /token|secret|authorization/i.test(k)),
      ).toEqual([]);
      expect(JSON.stringify(body.requestJsonDraft)).not.toMatch(/access_token|client_secret/i);
      expect(body.approveEnabled).toBe(true);
      expect(body.approveDisabledReason).toBeNull();
      expect(body.priceJudgementId).toBe(seed.priceJudgementId);
      expect(body.uploadResultId).toBe(seed.uploadResultId);
      expect(body.rakutenPageCollectedAt).toBe(seed.collectedAt.toISOString());
      expect(body.judgementExpiresAt).toBe(
        new Date(seed.collectedAt.getTime() + 6 * 3_600_000).toISOString(),
      );
      expect(body.salePriceKrw).toBe(167300);
      expect(body.marginBreakdown.targetMarginRate).toBe(0.1);
      expect(body.marginBreakdown.sizes.map((s) => [s.sizeMm, s.stockQuantity])).toEqual([
        [250, 3],
        [255, 2],
        [260, 5],
        [265, 3],
        [275, 4],
      ]);
      expect(body.tags).toHaveLength(10);
      expect(body.sourcingMethod).toMatchObject({
        method: 'COMPARED',
        itemCode: 'shop-a:10000123',
      });
      expect(body.originLabel).toBe('베트남');
      expect(body.displayStatusType).toBe('SUSPENSION');
      expect(body.duplicate.duplicated).toBe(false);
      expect(body.warnings).toEqual([]);
      const product = body.requestJsonDraft.originProduct as Record<string, unknown>;
      expect(product.stockQuantity).toBe(10);
      expect(product.detailContent).toBe(body.detailContent);
      // 미리보기는 외부 호출이 없다
      expect(t.fetch.calls).toHaveLength(0);
    });

    it('?optionType=STANDARD는 표준형 미리보기(카테고리 표준옵션이 없으면 꺼짐 VALIDATION_FAILED), BAD는 422 INVALID_QUERY_PARAMETER', async () => {
      const standard = await preview(seed.candidate.id, '?optionType=STANDARD');
      expect(standard.status).toBe(200);
      expect((standard.body as PreviewBody).optionType).toBe('STANDARD');
      expect((standard.body as PreviewBody).approveDisabledReason?.code).toBe('VALIDATION_FAILED');
      const bad = await preview(seed.candidate.id, '?optionType=BAD');
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('INVALID_QUERY_PARAMETER');
      const unknown = await preview(seed.candidate.id, '?foo=1');
      expect(errorOf(unknown).code).toBe('INVALID_QUERY_PARAMETER');
    });

    it('판정에 쓴 페이지가 6시간을 넘으면 approveEnabled=false, JUDGEMENT_EXPIRED', async () => {
      t.clock.ms = seed.collectedAt.getTime() + 6 * 3_600_000 + 1000;
      const body = (await preview(seed.candidate.id)).body as PreviewBody;
      expect(body.approveEnabled).toBe(false);
      expect(body.approveDisabledReason?.code).toBe('JUDGEMENT_EXPIRED');
    });
  });

  describe('POST /candidates/{id}/pre-validations', () => {
    it('200: 15개 모두 통과, approvable=true, restricted-tags는 관문(call_log)을 지난다', async () => {
      const seed = await seedApprovableCandidate(t);
      const res = await preValidate(seed.candidate.id);
      expect(res.status).toBe(200);
      const body = res.body as PreValidationBody;
      expect(body.checks).toHaveLength(15);
      expect(body.checks.filter((c) => !c.passed)).toEqual([]);
      expect(body.checks.every((c) => c.severity === 'BLOCK')).toBe(true);
      expect(body.approvable).toBe(true);
      expect(body.checkedAt).toBe(new Date(TEST_START_MS).toISOString());
      expect(restrictedRequests()).toHaveLength(1);
      expect(new URL(restrictedRequests()[0]!.url).searchParams.getAll('tags')).toEqual(
        seed.finalTags,
      );
      // P4-03: SELLER_CODE 교차 조회 1회(판매자관리코드 = 요청 초안 값)
      expect(products.searches.map((r) => r.body?.sellerManagementCode)).toEqual([
        'RKT:shop-a:10000123:108',
      ]);
      const logs = await t.prisma.callLog.findMany({ where: { candidateId: seed.candidate.id } });
      expect(
        logs.some(
          (log) => log.target === 'COMMERCE_API' && log.urlMasked?.includes('restricted-tags'),
        ),
      ).toBe(true);
    });

    it('body optionType STANDARD도 받고, BAD는 422 VALIDATION_FAILED', async () => {
      const seed = await seedApprovableCandidate(t);
      expect((await preValidate(seed.candidate.id, { optionType: 'STANDARD' })).status).toBe(200);
      const bad = await preValidate(seed.candidate.id, { optionType: 'BAD' });
      expect(bad.status).toBe(422);
      expect(errorOf(bad).code).toBe('VALIDATION_FAILED');
      const extra = await preValidate(seed.candidate.id, { foo: 1 });
      expect(errorOf(extra).code).toBe('VALIDATION_FAILED');
    });

    it('헤더 없이 POST → 403 CLIENT_HEADER_REQUIRED', async () => {
      const seed = await seedApprovableCandidate(t);
      const res = await http()
        .post(`/api/v1/candidates/${seed.candidate.id}/pre-validations`)
        .send({});
      expect(res.status).toBe(403);
      expect(errorOf(res).code).toBe('CLIENT_HEADER_REQUIRED');
    });

    it('가짜 restricted-tags 500 → 200, TAGS.passed=false(사유), approvable=false', async () => {
      const seed = await seedApprovableCandidate(t);
      restricted = restrictedResponder('restricted-tags.500.json');
      const body = (await preValidate(seed.candidate.id)).body as PreValidationBody;
      const tags = checkOf(body, 'TAGS');
      expect(tags.passed).toBe(false);
      expect(tags.reason).toContain('제한 태그를 확인하지 못했습니다');
      expect(tags.stepCode).toBe('TAGS');
      expect(body.approvable).toBe(false);
      expect(body.checks.filter((c) => !c.passed).map((c) => c.checkCode)).toEqual(['TAGS']);
    });

    it('P4-03: SELLER_CODE 조회에 상품이 있으면 DUPLICATE 실패 + duplicate.source=COMMERCE_API(기존 상품 보기)', async () => {
      const seed = await seedApprovableCandidate(t);
      products.searchMode = 'FOUND';
      const body = (await preValidate(seed.candidate.id)).body as PreValidationBody & {
        duplicate: { duplicated: boolean; source: string; originProductNo: string };
      };
      expect(checkOf(body, 'DUPLICATE').passed).toBe(false);
      expect(body.approvable).toBe(false);
      expect(body.duplicate).toMatchObject({
        duplicated: true,
        source: 'COMMERCE_API',
        originProductNo: '10000000001',
      });
    });

    it("restricted-tags가 제한 태그를 돌려주면 TAGS 실패('쿠션운동화')", async () => {
      const seed = await seedApprovableCandidate(t);
      restricted = restrictedResponder('restricted-tags.200-hit.json');
      const body = (await preValidate(seed.candidate.id)).body as PreValidationBody;
      expect(checkOf(body, 'TAGS').reason).toContain("'쿠션운동화'");
      expect(body.approvable).toBe(false);
    });

    it('커머스API 키가 없으면 외부 호출 없이 TAGS만 실패(200)', async () => {
      const seed = await seedApprovableCandidate(t);
      store.reset();
      const body = (await preValidate(seed.candidate.id)).body as PreValidationBody;
      expect(checkOf(body, 'TAGS').passed).toBe(false);
      expect(restrictedRequests()).toHaveLength(0);
    });

    it('판정에 쓴 페이지 6시간 1초 → JUDGEMENT_FRESHNESS 실패(stepCode SOURCING)', async () => {
      const seed = await seedApprovableCandidate(t, {
        collectedAt: new Date(TEST_START_MS - 6 * 3_600_000 - 1000),
      });
      const body = (await preValidate(seed.candidate.id)).body as PreValidationBody;
      const fresh = checkOf(body, 'JUDGEMENT_FRESHNESS');
      expect(fresh.passed).toBe(false);
      expect(fresh.stepCode).toBe('SOURCING');
    });

    it('POST 뒤 후보 상태와 registration 행 수가 그대로다(저장하지 않는다)', async () => {
      const seed = await seedApprovableCandidate(t);
      const before = await t.prisma.registration.count();
      await preValidate(seed.candidate.id).expect(200);
      await preValidate(seed.candidate.id).expect(200);
      const candidate = await t.prisma.candidate.findUniqueOrThrow({
        where: { id: seed.candidate.id },
      });
      expect(candidate.status).toBe('AWAITING_APPROVAL');
      expect(candidate.statusChangedAt.toISOString()).toBe(
        seed.candidate.statusChangedAt.toISOString(),
      );
      expect(await t.prisma.registration.count()).toBe(before);
      expect(
        await t.prisma.stepRun.count({
          where: { candidateId: seed.candidate.id, stepCode: 'REGISTER' },
        }),
      ).toBe(0);
    });

    it('같은 후보 검사가 겹치면 한 번만 돈다(restricted-tags 1회)', async () => {
      const seed = await seedApprovableCandidate(t);
      commerce.block();
      const first = preValidate(seed.candidate.id).then((r) => r);
      const second = preValidate(seed.candidate.id).then((r) => r);
      await new Promise((resolve) => setTimeout(resolve, 200));
      commerce.release();
      const [a, b] = await Promise.all([first, second]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(restrictedRequests()).toHaveLength(1);
    });
  });

  describe('상태·없는 후보', () => {
    it('WORKING 후보 → 두 API 409 CANDIDATE_STATUS_INVALID(details.allowed에 AWAITING_APPROVAL)', async () => {
      const seed = await seedApprovableCandidate(t, { status: 'WORKING' });
      for (const res of [await preview(seed.candidate.id), await preValidate(seed.candidate.id)]) {
        expect(res.status).toBe(409);
        expect(errorOf(res).code).toBe('CANDIDATE_STATUS_INVALID');
        expect(errorOf(res).details?.allowed).toEqual(['AWAITING_APPROVAL']);
      }
      expect(restrictedRequests()).toHaveLength(0);
    });

    it('없는 id → 404 CANDIDATE_NOT_FOUND', async () => {
      for (const res of [await preview(99999), await preValidate(99999), await preview(0)]) {
        expect(res.status).toBe(404);
        expect(errorOf(res).code).toBe('CANDIDATE_NOT_FOUND');
      }
    });
  });
});
