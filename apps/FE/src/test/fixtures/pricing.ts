import type {
  DomesticPriceEntry,
  FxRateLatestSet,
  FxRatePage,
  FxRateRecord,
  FxRateWarning,
  NaverShoppingLink,
  PriceJudgementDetail,
  PriceJudgementSize,
} from '@/features/pricing';
import type {
  ForwarderRateTableDetail,
  ForwarderRateTableImportResult,
  ForwarderRateTableSummary,
  ForwarderRateTier,
} from '@/features/settings';

/** 환율 기록 한 건(기본: 원가 환율 JPY(100) 876 → 8.76원/엔, 2026-09-28 09:00 KST 자동 수집) */
export function fxRecord(overrides: Partial<FxRateRecord> = {}): FxRateRecord {
  return {
    id: 1,
    rateKind: 'COST',
    currency: 'JPY',
    rateValue: 876,
    unit: 100,
    source: 'KEXIM',
    sourceNote: null,
    referenceAt: '2026-09-28T02:00:00.000Z',
    collectedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

/** 최신값 3종(원가 8.76 · 과세 엔 8.76 · 과세 달러 1,358.72) */
export function fxLatest(
  warnings: FxRateWarning[] = [],
  items: FxRateRecord[] = [
    fxRecord(),
    fxRecord({
      id: 2,
      rateKind: 'CUSTOMS',
      source: 'CUSTOMS_SERVICE',
      referenceAt: '2026-09-26T15:00:00.000Z',
    }),
    fxRecord({
      id: 3,
      rateKind: 'CUSTOMS',
      currency: 'USD',
      rateValue: 1358.72,
      unit: 1,
      source: 'CUSTOMS_SERVICE',
      referenceAt: '2026-09-26T15:00:00.000Z',
    }),
  ],
): FxRateLatestSet {
  return { items, warnings };
}

export const FX_FETCH_FAILED_WARNING: FxRateWarning = {
  code: 'FX_FETCH_FAILED',
  rateKind: 'COST',
  currency: 'JPY',
  message:
    '원가 환율 자동 수집이 실패했습니다(2026-09-28 11:00). 마지막 값을 계속 씁니다. 필요하면 환율을 직접 넣어 주세요.',
};

export function fxPage(content: FxRateRecord[] = fxLatest().items): FxRatePage {
  return {
    content,
    page: {
      number: 0,
      size: 10,
      totalElements: content.length,
      totalPages: content.length > 0 ? 1 : 0,
    },
  };
}

export function rateTier(overrides: Partial<ForwarderRateTier> = {}): ForwarderRateTier {
  return {
    id: 1,
    weightMaxKg: 1.2,
    fee: 15000,
    currency: 'KRW',
    volumetricDivisor: null,
    volumetricAppliesWhen: null,
    ...overrides,
  };
}

/** 요금표 버전 요약(기본: #1 v2026-09 활성) */
export function rateTableSummary(
  overrides: Partial<ForwarderRateTableSummary> = {},
): ForwarderRateTableSummary {
  return {
    id: 1,
    forwarderName: '[배대지 A]',
    sourceFileName: 'rate-table-v2026-09.csv',
    sourceFileSha256: 'a'.repeat(64),
    rowCount: 3,
    isActive: true,
    importedAt: '2026-09-28T00:00:00.000Z',
    activatedAt: '2026-09-28T00:00:00.000Z',
    ...overrides,
  };
}

/** 요금표 상세(0.5kg 9,000원 · 1.2kg 15,000원 · 2kg 18,000원) */
export function rateTableDetail(
  overrides: Partial<ForwarderRateTableDetail> = {},
  tiers: ForwarderRateTier[] = [
    rateTier({ id: 1, weightMaxKg: 0.5, fee: 9000 }),
    rateTier({ id: 2, weightMaxKg: 1.2, fee: 15000 }),
    rateTier({
      id: 3,
      weightMaxKg: 2,
      fee: 18000,
      volumetricDivisor: 6000,
      volumetricAppliesWhen: 'SUM_CM>160',
    }),
  ],
): ForwarderRateTableDetail {
  return { ...rateTableSummary({ rowCount: tiers.length, ...overrides }), tiers };
}

export function rateTablePage(content: ForwarderRateTableSummary[]) {
  return {
    content,
    page: {
      number: 0,
      size: 20,
      totalElements: content.length,
      totalPages: content.length > 0 ? 1 : 0,
    },
  };
}

export function rateTableImportResult(
  rateTable: ForwarderRateTableDetail,
  overrides: Partial<ForwarderRateTableImportResult> = {},
): ForwarderRateTableImportResult {
  return { rateTable, reused: false, rerunRequiredStepCount: 0, ...overrides };
}

// ── ③ 판정(P2-05) — PRD §8.3 예시(¥12,000 · 환율 8.76 · 국내 기준가 169,000 · 모드 A) ─────────────────────

/** 판정 사이즈 한 칸(기본: 250mm ¥12,000 면세 · P_min 153,100 · 판매가 167,300 · 순이익 27,418 · 16.4%) */
export function judgementSize(overrides: Partial<PriceJudgementSize> = {}): PriceJudgementSize {
  return {
    id: 1,
    sizeMm: 250,
    rakutenSkuId: 10,
    skuPriceYen: 12000,
    cGoodsKrw: 107748,
    vUsd: 77.37,
    isDutyFree: true,
    twoPairTaxable: true,
    isBoundary: false,
    customsValueKrw: null,
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
    pointsReferencePt: 1090,
    isSellable: true,
    unsellableReason: null,
    ...overrides,
  };
}

/** 판정 스냅샷(판매 사이즈 250·255·260·265·275, 270·285 품절 · 280 取り寄せ · 290 없음) */
export function priceJudgement(
  overrides: Partial<PriceJudgementDetail> = {},
): PriceJudgementDetail {
  return {
    id: 1,
    stepRunId: 101,
    candidateId: 1,
    version: 1,
    stepStatus: 'COMPLETED',
    isCurrent: true,
    skuPriceSource: 'STEP2',
    rakutenItemId: 5,
    rakutenPageCollectedAt: '2026-09-28T05:02:00.000Z',
    pageValidUntil: '2026-09-28T11:02:00.000Z',
    domesticPriceId: 1,
    pRefKrw: 169000,
    couponYen: 0,
    shippingYen: 0,
    shippingEstimated: false,
    costFxRate: fxRecord(),
    customsJpyFxRate: fxRecord({ id: 2, rateKind: 'CUSTOMS', source: 'CUSTOMS_SERVICE' }),
    customsUsdFxRate: fxRecord({
      id: 3,
      rateKind: 'CUSTOMS',
      currency: 'USD',
      rateValue: 1358.72,
      unit: 1,
      source: 'CUSTOMS_SERVICE',
    }),
    forwarderRateTableId: null,
    chargeableWeightKg: null,
    cShipIntlKrw: 15000,
    cFwdKrw: 15000,
    fwdCouponKrw: 0,
    fwdAssumed: true,
    dutyFreeLimitYen: 22490,
    vatMode: 'A',
    pricingRule: 'REF_MINUS_1PCT',
    targetMarginRate: 0.1,
    minProfitKrw: 5000,
    params: {
      cardSurchargePct: 2.5,
      saleFeePct: 3,
      npayFeePct: 3.63,
      miscCostKrw: 3000,
      refDiscountPct: 1,
      dutyFreeThresholdUsd: 145,
      sourcing: { comparisonPerformed: true },
    },
    isSaleCandidate: true,
    sellableSizeCount: 5,
    salePriceKrw: 167300,
    exclusionReason: null,
    judgedAt: '2026-09-28T05:05:00.000Z',
    sizes: [250, 255, 260, 265, 275].map((sizeMm, i) => judgementSize({ id: i + 1, sizeMm })),
    unjudgedSizes: [
      { sizeMm: 270, stockStatus: 'SOLD_OUT' },
      { sizeMm: 280, stockStatus: 'BACK_ORDER' },
      { sizeMm: 285, stockStatus: 'SOLD_OUT' },
      { sizeMm: 290, stockStatus: 'NONE' },
    ],
    ...overrides,
  };
}

export function domesticPriceEntry(
  overrides: Partial<DomesticPriceEntry> = {},
): DomesticPriceEntry {
  return {
    id: 1,
    candidateId: 1,
    pRefKrw: 169000,
    sourceKind: 'MANUAL',
    sourceLabel: null,
    sourceUrl: 'search.shopping.naver.com/search/all?query=1201A019-108',
    enteredAt: '2026-09-28T05:04:00.000Z',
    domesticPriceImportRowId: null,
    ...overrides,
  };
}

/**
 * 네이버쇼핑 링크(키워드 후보: 출처 키워드 + 型番). 주소는 스킴 없이 둔다 — 소스 전체에 외부 주소 글자를 두지 않는 규칙 15
 * 검사(`app/source-rules.test.ts`, sourcing fixture의 itemUrl과 같다). 화면은 받은 url을 그대로 href에 넣는다
 */
export function naverLinks(kinds: NaverShoppingLink['kind'][] = ['SOURCE_KEYWORD', 'MODEL_CODE']) {
  const all: Record<NaverShoppingLink['kind'], NaverShoppingLink> = {
    SOURCE_KEYWORD: {
      kind: 'SOURCE_KEYWORD',
      query: '아식스 젤카야노14',
      url: 'search.shopping.naver.com/search/all?query=%EC%95%84%EC%8B%9D%EC%8A%A4',
    },
    MODEL_CODE: {
      kind: 'MODEL_CODE',
      query: '1201A019-108',
      url: 'search.shopping.naver.com/search/all?query=1201A019-108',
    },
  };
  return { items: kinds.map((k) => all[k]) };
}
