import { ApiException } from '../../../common/errors/api.exception.js';
import { baseApprovalInputs } from '../../../../test/fixtures/registration/approval/approval-fixtures.js';
import { InMemorySecretStore } from '../../../../test/support/in-memory-secret-store.js';
import type { CommerceProductsPort } from '../../integrations/naver-commerce/commerce-products.port.js';
import { smartstoreProductUrl } from '../register/registration-record.js';
import { approvalWarningsOf, duplicateInfoOf, DuplicateService } from './duplicate.service.js';

function inputsWith(
  registrations: Partial<ReturnType<typeof baseApprovalInputs>['registrations']>,
) {
  const base = baseApprovalInputs();
  return { ...base, registrations: { ...base.registrations, ...registrations } };
}

describe('중복 교차 확인·경고(P4-03 규칙 10·11, F-AP-36·37·38)', () => {
  it('SAME_MODEL_REGISTERED: 같은 모델·색상이 다른 샵으로 등록돼 있으면 경고(막지 않음)', () => {
    expect(approvalWarningsOf(baseApprovalInputs())).toEqual([]);
    const warnings = approvalWarningsOf(
      inputsWith({
        sameModel: [{ registrationId: 5, itemCode: 'shop-b:20000456', originProductNo: '777' }],
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.code).toBe('SAME_MODEL_REGISTERED');
    expect(warnings[0]!.message).toContain('shop-b:20000456 · 상품 번호 777');
  });

  it('중복 정보: 로컬 기록이 먼저(등록 시각·스마트스토어센터 주소), 없으면 SELLER_CODE 결과', () => {
    const local = duplicateInfoOf(
      inputsWith({
        duplicate: {
          registrationId: 3,
          status: 'REGISTERED',
          originProductNo: '1234',
          channelProductNo: '5678',
          registeredAt: '2026-09-30T01:00:00.000Z',
        },
      }),
      { ok: true, product: { originProductNo: '9999', channelProductNo: null } },
    );
    expect(local).toEqual({
      duplicated: true,
      existingRegistrationId: 3,
      originProductNo: '1234',
      channelProductNo: '5678',
      source: 'LOCAL',
      registeredAt: '2026-09-30T01:00:00.000Z',
      smartstoreProductUrl: smartstoreProductUrl('1234'),
    });
    expect(smartstoreProductUrl('1234')).toMatch(/\/products\/edit\/1234$/);
    const remote = duplicateInfoOf(baseApprovalInputs(), {
      ok: true,
      product: { originProductNo: '9999', channelProductNo: null },
    });
    expect(remote).toMatchObject({
      duplicated: true,
      source: 'COMMERCE_API',
      originProductNo: '9999',
    });
    expect(duplicateInfoOf(baseApprovalInputs()).duplicated).toBe(false);
  });

  it('lookupSellerCode: 키가 없으면 외부 호출 없이 실패 사유, 있으면 포트 결과', async () => {
    const calls: string[] = [];
    const port: CommerceProductsPort = {
      createProduct: () => Promise.reject(new Error('부르지 않는다')),
      searchProductsBySellerCode: (code) => {
        calls.push(code);
        return Promise.resolve({ product: null, traceId: null });
      },
    };
    const store = new InMemorySecretStore();
    const service = new DuplicateService(port, store);
    const missing = await service.lookupSellerCode('RKT:a:1:2');
    expect(missing.ok).toBe(false);
    expect(calls).toEqual([]);
    await store.set('COMMERCE_CLIENT_ID', 'id');
    await store.set('COMMERCE_CLIENT_SECRET', '$2a$04$abcdefghijklmnopqrstuv');
    expect(await service.lookupSellerCode('RKT:a:1:2')).toEqual({ ok: true, product: null });
    expect(calls).toEqual(['RKT:a:1:2']);
    await expect(
      new DuplicateService(
        {
          ...port,
          searchProductsBySellerCode: () => Promise.reject(new ApiException('EXTERNAL_API_ERROR')),
        },
        store,
      ).searchSellerCode('RKT:a:1:2'),
    ).rejects.toMatchObject({ code: 'EXTERNAL_API_ERROR' });
  });
});
