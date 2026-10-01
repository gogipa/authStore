import type { components } from '@/shared/api/schema';

type UploadResultOutput = components['schemas']['UploadResultOutput'];
type UploadResultImageItem = components['schemas']['UploadResultImageItem'];

const AT = '2026-09-28T05:42:00.000Z';

/** 업로드 이미지 한 장(가짜 shop-phinf 주소 — 실제 주소 아님. FE 규칙 15로 소스에 scheme을 적지 않는다) */
export function uploadResultImage(
  patch: Partial<UploadResultImageItem> & { sortOrder: number },
): UploadResultImageItem {
  return {
    id: patch.sortOrder + 1,
    uploadedImageId: patch.sortOrder + 11,
    role: patch.sortOrder === 0 ? 'REPRESENTATIVE' : 'ADDITIONAL',
    url: `shop-phinf.pstatic.net/fake/upload-${patch.sortOrder + 1}.jpg`,
    sourceSha256: String(patch.sortOrder).repeat(64),
    imageAssetId: patch.sortOrder + 31,
    uploadedAt: AT,
    traceId: 'fixture-trace-upload-200',
    reused: false,
    ...patch,
  };
}

/** ⑧ 한 버전(05-2 UploadResultOutput): 대표·추가 2장 */
export function uploadResultOutput(patch: Partial<UploadResultOutput> = {}): UploadResultOutput {
  return {
    stepRunId: 108,
    candidateId: 1,
    version: 1,
    stepRunStatus: 'COMPLETED',
    isCurrent: true,
    uploadResultId: 1,
    detailContent:
      '<div data-autostore-detail="v1"><p data-autostore-image-slot="0"><img src="shop-phinf.pstatic.net/fake/upload-1.jpg" alt="대표 이미지"></p></div>',
    detailContentSha256: 'c'.repeat(64),
    createdAt: AT,
    images: [uploadResultImage({ sortOrder: 0 }), uploadResultImage({ sortOrder: 1 })],
    ...patch,
  };
}

type ApprovalPreview = components['schemas']['ApprovalPreview'];
type PreValidationResult = components['schemas']['PreValidationResult'];
type PreValidationCheck = components['schemas']['PreValidationCheck'];

/** 사전 검증 15개 코드(05-3 §5.3 순서) */
export const CHECK_CODES: PreValidationCheck['checkCode'][] = [
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
];

/** 사전 검증 결과(기본 15개 통과). `failed`에 코드별 실패를 준다 */
export function preValidationResult(
  candidateId: number,
  failed: Partial<Record<PreValidationCheck['checkCode'], Partial<PreValidationCheck>>> = {},
): PreValidationResult {
  const checks = CHECK_CODES.map((checkCode) => {
    const fail = failed[checkCode];
    return {
      checkCode,
      passed: !fail,
      severity: 'BLOCK' as const,
      reason: fail ? (fail.reason ?? '통과하지 못했습니다') : null,
      stepCode: fail?.stepCode ?? null,
      gateCode: fail?.gateCode ?? null,
    };
  });
  return {
    candidateId,
    approvable: checks.every((c) => c.passed),
    checks,
    checkedAt: '2026-09-28T05:50:00.000Z',
    warnings: [],
  };
}

const SALE_SIZES = [250, 255, 260, 265, 275];

/** G4 승인 미리보기(05-2 ApprovalPreview — 화면시안 후보 A, 합성 값. 주소는 scheme 없이 — FE 규칙 15) */
export function approvalPreview(
  candidateId: number,
  patch: Partial<ApprovalPreview> = {},
): ApprovalPreview {
  return {
    candidateId,
    candidateStatus: 'AWAITING_APPROVAL',
    optionType: 'COMBINATION',
    apiBlocked: true,
    productName: '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
    salePriceKrw: 167300,
    priceJudgementId: 7,
    uploadResultId: 1,
    judgedAt: '2026-09-28T05:10:00.000Z',
    rakutenPageCollectedAt: '2026-09-28T05:02:00.000Z',
    judgementExpiresAt: '2026-09-28T11:02:00.000Z',
    marginBreakdown: {
      couponYen: 0,
      shippingYen: 0,
      shippingEstimated: false,
      cShipIntlKrw: 15000,
      cFwdKrw: 15000,
      fwdCouponKrw: 0,
      fwdAssumed: true,
      vatMode: 'A',
      pricingRule: 'REF_MINUS_1PCT',
      targetMarginRate: 0.1,
      minProfitKrw: 5000,
      sizes: SALE_SIZES.map((sizeMm) => ({
        sizeMm,
        skuPriceYen: 12000,
        cGoodsKrw: 107748,
        vUsd: 77.37,
        isDutyFree: true,
        isBoundary: false,
        cTaxKrw: 0,
        pMinKrw: 153100,
        optionPriceKrw: 0,
        sizeSalePriceKrw: 167300,
        cMktKrw: 11092,
        vatAKrw: 3042,
        vatBKrw: 14201,
        profitAKrw: 27418,
        profitBKrw: 16259,
        marginRateA: 0.1639,
        isSellable: true,
        unsellableReason: null,
        stockQuantity: 3,
      })),
    },
    images: [
      { role: 'REPRESENTATIVE', sortOrder: 0, url: 'shop-phinf.pstatic.net/fake/upload-1.jpg' },
      { role: 'ADDITIONAL', sortOrder: 1, url: 'shop-phinf.pstatic.net/fake/upload-2.jpg' },
    ],
    detailContent:
      '<div data-autostore-detail="v1"><p data-block-id="AGENCY">· 이 상품은 [내 상호]가 일본 판매처에서 구매해 고객님께 보내 드리는 해외구매대행 상품입니다.</p><p data-autostore-image-slot="0"><img src="shop-phinf.pstatic.net/fake/upload-1.jpg" alt="대표 이미지"></p><p data-autostore-image-slot="1"><img src="shop-phinf.pstatic.net/fake/upload-2.jpg" alt="추가 이미지 1"></p><p data-autostore-image-slot="9"><img src="shop-phinf.pstatic.net/fake/unknown.jpg" alt="모르는 이미지"></p></div>',
    noticeFields: {
      material: '겉감 합성섬유·합성가죽 / 밑창 고무',
      color: '크림',
      size: '250~265·275mm (JP 25.0~26.5·27.5cm)',
    },
    originAreaCode: '0200037',
    originAreaContent: null,
    originLabel: '베트남',
    importer: '[수입자]',
    leafCategoryId: '50000830',
    wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
    tags: [
      '젤카야노14',
      '아식스운동화',
      '조깅화',
      '남자운동화',
      '데일리운동화',
      '레트로운동화',
      '크림운동화',
      '쿠션운동화',
      '가벼운운동화',
      '커플운동화',
    ].map((text, i) => ({ text, code: i < 4 ? String(7000001 + i) : null, finalOrder: i + 1 })),
    sourcingMethod: {
      method: 'COMPARED',
      creationPath: 'KEYWORD',
      noComparisonConfirmedAt: null,
      itemCode: 'shop-a:10000123',
    },
    requestJsonDraft: {
      originProduct: {
        statusType: 'SALE',
        stockQuantity: 10,
        deliveryInfo: {
          deliveryFee: { deliveryFeeType: 'FREE', deliveryFeePayType: 'PREPAID' },
          businessCustomsClearanceSaleYn: false,
        },
        detailAttribute: {
          customsTaxType: 'INCLUDED',
          optionInfo: {
            optionCombinations: SALE_SIZES.map((size) => ({
              optionName1: String(size),
              stockQuantity: 2,
              price: 0,
              usable: true,
            })),
          },
        },
      },
      smartstoreChannelProduct: {
        naverShoppingRegistration: true,
        channelProductDisplayStatusType: 'SUSPENSION',
      },
    },
    sellerManagementCode: 'RKT:shop-a:10000123:108',
    displayStatusType: 'SUSPENSION',
    duplicate: {
      duplicated: false,
      existingRegistrationId: null,
      originProductNo: null,
      channelProductNo: null,
    },
    approveEnabled: true,
    approveDisabledReason: null,
    warnings: [],
    standardOptionSupported: false,
    liveRegistrationCount: 3,
    initialSuspensionCount: 10,
    ...patch,
  };
}

type RegistrationSummary = components['schemas']['RegistrationSummary'];
type RegistrationDetail = components['schemas']['RegistrationDetail'];
type RegistrationSummaryPage = components['schemas']['RegistrationSummaryPage'];

/** 등록 기록 이력 한 줄(05-2 RegistrationSummary — 기본 드라이런 검증완료) */
export function registrationSummary(patch: Partial<RegistrationSummary> = {}): RegistrationSummary {
  return {
    registrationId: 31,
    stepRunId: 210,
    stepRunVersion: 1,
    status: 'VALIDATED',
    sellerManagementCode: 'RKT:shop-a:10000123:108',
    optionType: 'COMBINATION',
    displayStatusType: 'SUSPENSION',
    approvedAt: '2026-09-28T06:00:00.000Z',
    registeredAt: null,
    originProductNo: null,
    httpStatus: null,
    errorCode: null,
    errorMessage: null,
    failedAt: null,
    failureKind: null,
    createdAt: '2026-09-28T06:00:00.000Z',
    ...patch,
  };
}

/** 이력 한 페이지(맨 앞이 직전 결과) */
export function registrationPage(content: RegistrationSummary[] = []): RegistrationSummaryPage {
  return {
    content,
    page: {
      number: 0,
      size: 20,
      totalElements: content.length,
      totalPages: content.length ? 1 : 0,
    },
  };
}

/** 등록 기록 상세(05-2 RegistrationDetail — request_json 없음). summary 값을 그대로 잇는다 */
export function registrationDetail(
  candidateId: number,
  patch: Partial<RegistrationDetail> = {},
): RegistrationDetail {
  const summary = registrationSummary();
  return {
    registrationId: summary.registrationId,
    candidateId,
    stepRunId: summary.stepRunId,
    priceJudgementId: 7,
    uploadResultId: 1,
    status: summary.status,
    itemCode: 'shop-a:10000123',
    selectedColor: '크림/블랙',
    colorCode: '108',
    sellerManagementCode: summary.sellerManagementCode,
    displayStatusType: 'SUSPENSION',
    optionType: 'COMBINATION',
    validationResult: { checks: [] },
    approvedAt: summary.approvedAt,
    requestSentAt: null,
    responseReceivedAt: null,
    lastResultCheckAt: null,
    registeredAt: null,
    originProductNo: null,
    channelProductNo: null,
    httpStatus: null,
    errorCode: null,
    errorMessage: null,
    invalidInputs: null,
    traceId: null,
    failedAt: null,
    failureKind: null,
    smartstoreProductUrl: null,
    createdAt: summary.createdAt,
    updatedAt: summary.createdAt,
    ...patch,
  };
}

/** 등록 API 차단 스위치(05-2 RegistrationSwitchState) */
export function registrationSwitch(apiBlocked = true) {
  return { apiBlocked, changedAt: '2026-09-28T00:00:00.000Z' };
}
