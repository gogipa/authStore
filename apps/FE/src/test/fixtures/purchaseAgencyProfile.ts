import type { components } from '@/shared/api/schema';

type Profile = components['schemas']['PurchaseAgencyProfile'];
type SaveResult = components['schemas']['PurchaseAgencyProfileSaveResult'];
type DispatchList = components['schemas']['DispatchDeliveryCompanyList'];

/** nullable 칸 10개(05-2 missingFields 순서, P1-09 Proposed) */
export const PROFILE_REQUIRED_FIELDS = [
  'overseasShippingCommerceAddressbookId',
  'returnCommerceAddressbookId',
  'dispatchDeliveryCompanyCode',
  'commerceReturnDeliveryCompanyId',
  'returnFeeKrw',
  'exchangeFeeKrw',
  'businessName',
  'afterServicePhone',
  'afterServiceGuide',
  'importer',
];

/** GET /purchase-agency-profile — 행이 없을 때의 빈 기본값 */
export function emptyProfile(): Profile {
  return {
    id: null,
    overseasShippingCommerceAddressbookId: null,
    returnCommerceAddressbookId: null,
    dispatchDeliveryCompanyCode: null,
    commerceReturnDeliveryCompanyId: null,
    deliveryFeeKrw: 0,
    returnFeeKrw: null,
    exchangeFeeKrw: null,
    businessName: null,
    afterServicePhone: null,
    afterServiceGuide: null,
    importer: null,
    noticeFixedTexts: {},
    maxPurchaseQuantityPerOrder: 1,
    createdAt: null,
    updatedAt: null,
    missingFields: [...PROFILE_REQUIRED_FIELDS],
    addressWarnings: [],
  };
}

/** 모두 채운 프로필(자리표시자 값). 주소록 id 1(해외)·2(국내), 반품 택배사 id 1, 발송 코드 FAKE_DISPATCH_A */
export function filledProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    ...emptyProfile(),
    id: 1,
    overseasShippingCommerceAddressbookId: 1,
    returnCommerceAddressbookId: 2,
    dispatchDeliveryCompanyCode: 'FAKE_DISPATCH_A',
    commerceReturnDeliveryCompanyId: 1,
    returnFeeKrw: 30000,
    exchangeFeeKrw: 60000,
    businessName: '[내 상호]',
    afterServicePhone: '[A/S 연락처]',
    afterServiceGuide: '[A/S 안내]',
    importer: '[수입자]',
    noticeFixedTexts: {
      warrantyPolicy: '소비자분쟁해결기준에 따름',
      returnCostReason: '상품상세 참조',
      noRefundReason: '상품상세 참조',
      qualityAssuranceStandard: '상품상세 참조',
      compensationProcedure: '상품상세 참조',
      troubleShootingContents: '상품상세 참조',
    },
    createdAt: '2026-09-30T00:00:00.000Z',
    updatedAt: '2026-09-30T00:00:00.000Z',
    missingFields: [],
    ...overrides,
  };
}

export function profileSaveResult(profile: Profile, rerunRequiredStepCount = 0): SaveResult {
  return { profile, rerunRequiredStepCount };
}

/** GET /dispatch-delivery-companies(가짜 코드 2개, BE fixture와 같다) */
export function dispatchCompanyList(): DispatchList {
  return {
    items: [
      {
        code: 'FAKE_DISPATCH_A',
        name: '[가짜 발송 택배사 A]',
        source: '테스트 fixture(P1-09) — 실제 커머스API 택배사 코드가 아님',
      },
      {
        code: 'FAKE_DISPATCH_B',
        name: '[가짜 발송 택배사 B]',
        source: '테스트 fixture(P1-09) — 실제 커머스API 택배사 코드가 아님',
      },
    ],
  };
}
