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

/** 적용한 소싱 설정 실효값 사본(sourcing_comparison.params — ERD). P2-03이 k_rank·SPU 등을 더한다 */
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
  };
}

/** ② 입력 대기 이유 코드(Proposed, 05-1 §7.3 P2-02) */
export const SOURCING_WAITING_REASONS = {
  /** 검색 결과가 나왔고 앵커(型番·색상)를 기다린다(탐색 모드) */
  ANCHOR: { code: 'SOURCING_ANCHOR_REQUIRED', pending: ['owner.anchor'] },
  /** 앵커가 있어 페이지 조회·최종 후보 선택을 기다린다(P2-03) */
  SELECTION: { code: 'SOURCING_SELECTION_REQUIRED', pending: ['owner.sourcingSelection'] },
  /** 아동화 의심·대상 외 장르 → '성인용 상품 확인' */
  ADULT: {
    code: 'ADULT_PRODUCT_CONFIRMATION_REQUIRED',
    pending: ['owner.adultProductConfirmation'],
  },
} as const;
