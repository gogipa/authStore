import { ApiException } from '../../../common/errors/api.exception.js';
import { createCommerceKit } from '../../../../test/support/commerce-test-kit.js';
import { productsFixture } from '../../../../test/support/fake-commerce-products.js';
import {
  commerceAuthFixture,
  FAKE_ACCESS_TOKEN,
} from '../../../../test/support/fake-commerce-transport.js';
import { CommerceProductsHttpAdapter } from '../../integrations/naver-commerce/commerce-products.http-adapter.js';
import {
  COMMERCE_CREATE_PRODUCT_PATH,
  type CreateProductResult,
} from '../../integrations/naver-commerce/commerce-products.port.js';
import { registerOutcomeOf } from './register-outcome.js';

const NOW = new Date('2026-10-01T05:00:00Z');
const BODY = { originProduct: { name: '상품' }, smartstoreChannelProduct: {} };

function setup() {
  const kit = createCommerceKit();
  const adapter = new CommerceProductsHttpAdapter(kit.client);
  const creates = () =>
    kit.transport.apiRequests.filter((r) => r.path.endsWith(COMMERCE_CREATE_PRODUCT_PATH));
  return { ...kit, adapter, creates };
}

function gatewayFailure(reason: 'TIMEOUT' | 'NETWORK_ERROR'): ApiException {
  return new ApiException('EXTERNAL_API_ERROR', {
    details: { target: 'COMMERCE_API', reason, callLogId: 1 },
  });
}

/** 한 시나리오 → [어댑터 결과, 기록 분류] */
async function classify(
  arrange: (kit: ReturnType<typeof setup>) => void,
): Promise<{ result: CreateProductResult; kind: string; creates: number }> {
  const kit = setup();
  await kit.tokens.getToken(); // 토큰을 먼저 받아 둔다(아래 응답 줄·연결 오류는 등록 호출에 걸린다)
  arrange(kit);
  const result = await kit.adapter.createProduct(BODY, {
    candidateId: 1,
    stepRunId: 2,
    timeoutMs: 1000,
  });
  return { result, kind: registerOutcomeOf(result, NOW).kind, creates: kit.creates().length };
}

describe('결과 분류(P4-03 규칙 8 — 어댑터 + register-outcome, 가짜 커머스 서버)', () => {
  it('200 → REGISTERED(상품 번호 숫자 글자·Trace-ID), 토큰은 Authorization 헤더에만', async () => {
    const kit = setup();
    kit.transport.respondWith('token-200', productsFixture('products.200'));
    const result = await kit.adapter.createProduct(BODY, { timeoutMs: 1000 });
    expect(result).toEqual({
      kind: 'SUCCESS',
      httpStatus: 200,
      originProductNo: '10000000001',
      channelProductNo: '20000000001',
      traceId: 'fixture-trace-products-200',
    });
    const [req] = kit.creates();
    expect(req!.method).toBe('POST');
    expect(req!.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
    expect(req!.body).not.toContain(FAKE_ACCESS_TOKEN);
    expect(JSON.parse(req!.body!)).toEqual(BODY);
    const outcome = registerOutcomeOf(result, NOW);
    expect(outcome.kind).toBe('REGISTERED');
    expect(outcome.registration).toMatchObject({
      status: 'REGISTERED',
      originProductNo: '10000000001',
      registeredAt: NOW,
    });
    expect(outcome.step.kind).toBe('COMPLETED');
    expect(outcome.candidate).toEqual({ toStatus: 'REGISTERED', reason: 'REGISTER_SUCCEEDED' });
  });

  it('400(invalidInputs 2건) → 4XX 종결: failed_at·INVALID_INPUT_4XX·한국어 문구·원문·Trace-ID, 후보 승인대기', async () => {
    const { result, kind } = await classify((kit) =>
      kit.transport.respondWith(productsFixture('products.400-invalid-inputs')),
    );
    expect(kind).toBe('INVALID_INPUT_4XX');
    const outcome = registerOutcomeOf(result, NOW);
    expect(outcome.registration).toMatchObject({
      failedAt: NOW,
      failureKind: 'INVALID_INPUT_4XX',
      httpStatus: 400,
      errorCode: 'BadRequest',
      traceId: 'fixture-trace-products-400',
    });
    expect(outcome.registration.status).toBeUndefined();
    expect(outcome.registration.errorMessage as string).toContain(
      '태그: 쓸 수 없는 값입니다(제한)',
    );
    expect(outcome.registration.errorMessage as string).toContain(
      'originProduct.detailAttribute.fixtureUnknownField(FixtureRule): fixture unknown field message',
    );
    expect(outcome.registration.invalidInputs).toHaveLength(2);
    expect(outcome.step).toMatchObject({ kind: 'FAILED', failureKind: 'EXTERNAL_API' });
    expect(outcome.candidate).toEqual({ toStatus: 'AWAITING_APPROVAL', reason: 'REGISTER_4XX' });
  });

  it.each([
    [
      '500',
      (kit: ReturnType<typeof setup>) => kit.transport.respondWith(productsFixture('products.500')),
    ],
    [
      '503',
      (kit: ReturnType<typeof setup>) => kit.transport.respondWith(productsFixture('products.503')),
    ],
    [
      '타임아웃',
      (kit: ReturnType<typeof setup>) => kit.transport.failNext(gatewayFailure('TIMEOUT')),
    ],
    [
      'ECONNRESET',
      (kit: ReturnType<typeof setup>) => kit.transport.failNext(gatewayFailure('NETWORK_ERROR')),
    ],
  ])('%s → 결과확인필요(자동 재시도 없음 — 등록 호출 1회)', async (_name, arrange) => {
    const { result, kind, creates } = await classify(arrange);
    expect(result.kind).toBe('UNKNOWN');
    expect(kind).toBe('RESULT_CHECK_REQUIRED');
    expect(creates).toBe(1);
    const outcome = registerOutcomeOf(result, NOW);
    expect(outcome.registration.status).toBe('RESULT_CHECK_REQUIRED');
    expect(outcome.candidate).toEqual({
      toStatus: 'RESULT_CHECK_REQUIRED',
      reason: 'REGISTER_UNKNOWN',
    });
    expect(outcome.registration.errorMessage as string).toContain("'결과 확인'");
  });

  it('연결이 끊긴 원시 오류(TypeError ECONNRESET)도 결과확인필요다(모르면 늘 이쪽)', async () => {
    const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const { result, kind } = await classify((kit) =>
      kit.transport.failNext(new TypeError('fetch failed', { cause })),
    );
    expect(result).toMatchObject({ kind: 'UNKNOWN', errorCode: 'NETWORK_ERROR', httpStatus: null });
    expect(kind).toBe('RESULT_CHECK_REQUIRED');
  });

  it('401 GW.AUTHN이면 토큰을 다시 받아 다시 보내지 않는다 → 4XX 종결(등록 호출 1회)', async () => {
    const { result, kind, creates } = await classify((kit) =>
      kit.transport.respondWith(commerceAuthFixture('api-401-authn')),
    );
    expect(creates).toBe(1);
    expect(result).toMatchObject({ kind: 'CLIENT_ERROR', httpStatus: 401, errorCode: 'GW.AUTHN' });
    expect(kind).toBe('INVALID_INPUT_4XX');
  });

  it('2xx인데 원상품 번호가 없으면 결과확인필요(INVALID_RESPONSE)', async () => {
    const { result } = await classify((kit) =>
      kit.transport.respondWith(commerceAuthFixture('api-200-ok')),
    );
    expect(result).toMatchObject({ kind: 'UNKNOWN', errorCode: 'INVALID_RESPONSE' });
  });
});

describe('판매자관리코드 조회(SELLER_CODE)', () => {
  it('찾으면 상품 번호(받은 코드와 같은 줄), 없으면 null, 실패는 502', async () => {
    const kit = setup();
    const code = 'RKT:shop-a:10000123:108';
    const found = productsFixture('products-search.found');
    kit.transport.respondWith('token-200', {
      ...found,
      body: JSON.parse(JSON.stringify(found.body).replace('{sellerManagementCode}', code)),
    });
    expect(await kit.adapter.searchProductsBySellerCode(code)).toEqual({
      product: { originProductNo: '10000000001', channelProductNo: '20000000001' },
      traceId: 'fixture-trace-search-found',
    });
    const search = kit.transport.apiRequests.at(-1)!;
    expect(JSON.parse(search.body!)).toMatchObject({
      searchKeywordType: 'SELLER_CODE',
      sellerManagementCode: code,
    });
    kit.transport.respondWith(productsFixture('products-search.empty'));
    expect((await kit.adapter.searchProductsBySellerCode(code)).product).toBeNull();
    // 다른 코드만 있으면 없음
    kit.transport.respondWith(found);
    expect((await kit.adapter.searchProductsBySellerCode(code)).product).toBeNull();
    kit.transport.respondWith(productsFixture('products.500'));
    await expect(kit.adapter.searchProductsBySellerCode(code)).rejects.toMatchObject({
      code: 'EXTERNAL_API_ERROR',
      details: { target: 'COMMERCE_API', reason: 'HTTP_500' },
    });
  });
});
