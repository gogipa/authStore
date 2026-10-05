import type { AppSettings } from '../settings/schema/settings.types.js';
import type { GenreScope } from './entry-checks.js';

/**
 * ② SOURCING 실행기의 산출물 초안(StepOutcome.output). 엔진은 해석하지 않고 `persist`에 그대로 넘긴다 —
 * persist가 `sourcing_comparison`(+ 행)을 쓴다. ② 세 동작(PRD §5.3): 검색·비교 / URL로 만들기 / 재조회.
 */

export type AnchorInputMethod = 'SEARCH_PICK' | 'CODE_ENTRY' | 'URL_ITEM';

/** 앵커(비교표 머리 행 anchor_*). URL로 만들기·다시 실행이면 앞에서 정한 앵커를 그대로 든다 */
export interface AnchorPreset {
  anchorInputMethod: AnchorInputMethod;
  anchorItemCode: string | null;
  anchorModelCode: string | null;
  anchorModelCodeNorm: string | null;
  anchorColorCode: string | null;
  anchorColorLabel: string | null;
}

/** 검색 결과 한 행(비교표 API 행) */
export interface SearchRowDraft {
  searchRank: number;
  itemCode: string;
  shopCode: string;
  shopName: string | null;
  itemName: string;
  itemUrl: string;
  /** 상품 사진 주소(Item Search `mediumImageUrls` 첫 값, D-47). 없으면 null */
  imageUrl: string | null;
  apiItemPriceYen: number | null;
  apiItemPriceMin3Yen: number | null;
  apiPointRate: number | null;
  apiPostageFlag: number | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  shipOverseas: boolean | null;
  /** API 결과 수집 시각(ISO) — 검색 캐시 fetched_at */
  apiCollectedAt: string;
}

export interface SearchCompareOutput {
  action: 'SEARCH_COMPARE';
  searchKeyword: string;
  sourceUrl: string | null;
  params: Record<string, unknown>;
  anchor: AnchorPreset | null;
  rows: SearchRowDraft[];
  /** 상품명 아동 단어 등으로 빼서 저장하지 않은 행 수(F-SO-04) */
  excludedRowCount: number;
}

export interface UrlCreateOutput {
  action: 'URL_CREATE';
  sourceUrl: string;
  rakutenItemId: number;
  params: Record<string, unknown>;
  anchor: AnchorPreset;
  shippingYen: number;
  shippingSource: 'FREE' | 'DEFAULT_ESTIMATE';
  childSizeSuspect: boolean;
  genreScope: GenreScope;
  detectedGender: 'MALE' | 'FEMALE' | null;
  genderBasis: 'GENRE_PATH' | 'ITEM_NAME' | null;
}

export interface RefetchOutput {
  action: 'REFETCH';
  baseSourcingComparisonId: number;
  /** 새로 읽은 페이지 스냅샷 */
  rakutenItemId: number;
  childSizeSuspect: boolean;
  genreScope: GenreScope;
  /** 앞 버전의 '성인용 상품 확인'을 가져온 값(ISO, Proposed — 같은 상품이라 다시 묻지 않는다) */
  adultProductConfirmedAt: string | null;
  /** 비교를 하지 않은 버전이면 새 페이지로 다시 정한 송료 */
  shippingYen: number | null;
  shippingSource: 'FREE' | 'DEFAULT_ESTIMATE' | null;
  /** 이 재조회 실행의 설정 사본(P2-03 — 고른 행의 재고·실질가를 다시 계산한다). 없으면 앞 버전 사본 */
  params?: Record<string, unknown>;
}

/** 입력 대기를 끝낼 때(성인용 확인 등) — 산출물은 이미 있다 */
export interface ResumedOutput {
  action: 'RESUMED';
}

export type SourcingOutput = SearchCompareOutput | UrlCreateOutput | RefetchOutput | ResumedOutput;

export function isSourcingOutput(value: unknown): value is SourcingOutput {
  return (
    !!value &&
    typeof value === 'object' &&
    ['SEARCH_COMPARE', 'URL_CREATE', 'REFETCH', 'RESUMED'].includes(
      (value as { action?: unknown }).action as string,
    )
  );
}

/**
 * 적용한 소싱 설정 실효값 사본(sourcing_comparison.params — ERD, P2-03 규칙 10): 목표 범위·최소 사이즈 수·기본 폭·取り寄せ
 * 제외·기본 송료·K·M·아동화 기준 mm + 포인트(k_rank·SPU·내림 방식·pointRate 기본 1배 포함). 버전 안의 재고·실질가 계산은
 * 이 사본으로 한다(`comparisonParamsOf`)
 */
export function sourcingParamsOf(settings: Readonly<AppSettings>): Record<string, unknown> {
  const s = settings.sourcing;
  return {
    genreId: s.genreId,
    minPriceYen: s.minPriceYen,
    ngKeywords: [...s.ngKeywords],
    targetSizeMm: s.targetSizeMm,
    minSizeCount: s.minSizeCount,
    defaultWidth: s.defaultWidth,
    excludeBackOrder: s.excludeBackOrder,
    defaultShippingYen: s.defaultShippingYen,
    pageFetchTargetCandidates: s.pageFetchTargetCandidates,
    pageFetchMaxPages: s.pageFetchMaxPages,
    childShoeMaxSizeMm: settings.safety.childShoeMaxSizeMm,
    kRank: s.points.kRank,
    spuMultiplier: s.points.spuMultiplier,
    pointRounding: s.points.rounding,
    pointRateIncludesBase: s.points.pointRateIncludesBase,
  };
}

/** 버전 안 계산에 쓰는 설정 값(params 사본, 빠진 값은 지금 설정 — P2-02가 만든 버전은 포인트 값이 없다) */
export interface ComparisonParams {
  targetSizeMm: Record<'MALE' | 'FEMALE', { min: number; max: number }>;
  minSizeCount: number;
  defaultWidth: string;
  excludeBackOrder: boolean;
  defaultShippingYen: number;
  pageFetchTargetCandidates: number;
  pageFetchMaxPages: number;
  kRank: number;
  spuMultiplier: number;
  pointRounding: 'PER_PROGRAM' | 'SIMPLE';
  pointRateIncludesBase: boolean;
}

function isRange(value: unknown): value is { min: number; max: number } {
  if (!value || typeof value !== 'object') return false;
  const v = value as { min?: unknown; max?: unknown };
  return Number.isInteger(v.min) && Number.isInteger(v.max);
}

export function comparisonParamsOf(
  params: unknown,
  settings: Readonly<AppSettings>,
): ComparisonParams {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
  const s = settings.sourcing;
  const num = (key: string, fallback: number): number => {
    const v = p[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  };
  const bool = (key: string, fallback: boolean): boolean => {
    const v = p[key];
    return typeof v === 'boolean' ? v : fallback;
  };
  const target = (p.targetSizeMm ?? {}) as Record<string, unknown>;
  const male = target.MALE;
  const female = target.FEMALE;
  return {
    targetSizeMm: {
      MALE: isRange(male) ? male : s.targetSizeMm.MALE,
      FEMALE: isRange(female) ? female : s.targetSizeMm.FEMALE,
    },
    minSizeCount: num('minSizeCount', s.minSizeCount),
    defaultWidth: typeof p.defaultWidth === 'string' ? p.defaultWidth : s.defaultWidth,
    excludeBackOrder: bool('excludeBackOrder', s.excludeBackOrder),
    defaultShippingYen: num('defaultShippingYen', s.defaultShippingYen),
    pageFetchTargetCandidates: num('pageFetchTargetCandidates', s.pageFetchTargetCandidates),
    pageFetchMaxPages: num('pageFetchMaxPages', s.pageFetchMaxPages),
    kRank: num('kRank', s.points.kRank),
    spuMultiplier: num('spuMultiplier', s.points.spuMultiplier),
    pointRounding:
      p.pointRounding === 'SIMPLE' || p.pointRounding === 'PER_PROGRAM'
        ? p.pointRounding
        : s.points.rounding,
    pointRateIncludesBase: bool('pointRateIncludesBase', s.points.pointRateIncludesBase),
  };
}

/** ② 입력 대기 이유 코드(Proposed, 05-1 §7.3 P2-02) */
export const SOURCING_WAITING_REASONS = {
  /** 검색 결과가 나왔고 앵커(型番·색상)를 기다린다(탐색 모드) */
  ANCHOR: { code: 'SOURCING_ANCHOR_REQUIRED', pending: ['owner.anchor'] },
  /** 앵커가 있어 페이지 조회·최종 후보 선택을 기다린다(P2-03) */
  SELECTION: { code: 'SOURCING_SELECTION_REQUIRED', pending: ['owner.sourcingSelection'] },
  /**
   * 성별을 판단하지 못해 목표 사이즈를 정할 수 없다(F-SO-19, P2-03 Proposed). 앵커 뒤 백그라운드 작업이 알아내므로 실행 상태는
   * 바꾸지 않고(입력 대기 그대로) 화면이 비교표 머리(`detectedGender`·후보 성별)로 판단한다 — 코드는 문서용
   */
  GENDER: { code: 'SOURCING_GENDER_REQUIRED', pending: ['candidate.gender'] },
  /** 아동화 의심·대상 외 장르 → '성인용 상품 확인' */
  ADULT: {
    code: 'ADULT_PRODUCT_CONFIRMATION_REQUIRED',
    pending: ['owner.adultProductConfirmation'],
  },
} as const;
