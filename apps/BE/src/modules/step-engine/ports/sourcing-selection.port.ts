import type { Db } from '../candidates/step-engine-tx.js';

/**
 * ② 소싱 선택 읽기(ERD `sourcing_comparison` '소싱 선택 읽기 규칙', P2-02). sourcing 모듈이 읽기 함수를 등록하고
 * (`StepEngineApi.registerSourcingSelectionReader`), ③·⑤·⑥(P2-05·P3)은 step-engine을 거쳐 이것만 쓴다
 * (`StepEngineApi.readSourcingSelection`) — 단계 모듈끼리 import하지 않는다(03-ADR-003).
 * - 비교를 한 버전(`comparison_performed=true`): `is_selected` 행의 rakuten_item·대표 SKU·송료·쿠폰
 * - 비교를 하지 않은 버전(URL로 만들기·그 재조회): 머리 행의 `selected_rakuten_item_id`·송료(쿠폰은 ③ pricing_coupon_input)
 */
export interface SourcingSelectionView {
  sourcingStepRunId: number;
  sourcingComparisonId: number;
  action: 'SEARCH_COMPARE' | 'URL_CREATE' | 'REFETCH';
  comparisonPerformed: boolean;
  rakutenItemId: number;
  itemCode: string;
  itemName: string;
  itemUrl: string;
  /** 고른 페이지 스냅샷의 수집 시각(rakuten_item.collected_at) */
  collectedAt: Date;
  /** 비교를 한 버전의 대표 SKU(없으면 null) */
  representativeRakutenSkuId: number | null;
  shippingYen: number | null;
  shippingSource: string | null;
  /** 비교를 한 버전의 행 쿠폰(엔). 비교를 하지 않은 버전은 0(③ 쿠폰 입력을 쓴다) */
  couponYen: number;
  /** 앵커 색상 라벨(= 후보 selected_color)과 코드 */
  anchorColorLabel: string | null;
  anchorColorCode: string | null;
  adultProductConfirmedAt: Date | null;
}

/** 목표 사이즈 한 칸의 재고 상태(② 재고 판정 RK-05 — 화면 '있음·품절·取り寄せ·없음') */
export type SourcingSizeStockStatus = 'IN_STOCK' | 'SOLD_OUT' | 'BACK_ORDER' | 'NONE';

/**
 * ② 버전의 소싱 선택 상품에서 목표 사이즈별 SKU(P2-05 Proposed — ③ 판정 입력 '② 목표 사이즈 SKU가·재고'). ②의 재고 판정
 * 규칙(앵커 색상·기본 폭·목표 범위·取り寄せ 제외, 그 버전의 설정 사본)을 그대로 써서 sourcing이 만든다 — ③은 규칙을
 * 복제하지 않는다. `IN_STOCK` 칸이 판정 대상('재고 있는 목표 사이즈')이다.
 */
export interface SourcingTargetSkus {
  sourcingStepRunId: number;
  rakutenItemId: number;
  gender: 'MALE' | 'FEMALE';
  sizes: {
    sizeMm: number;
    status: SourcingSizeStockStatus;
    /** 그 사이즈에서 고른 SKU(있음이면 재고 SKU). 없으면 null */
    rakutenSkuId: number | null;
    /** 그 SKU의 taxIncludedPrice(엔, 쿠폰 전). 모르면 null */
    taxIncludedPriceYen: number | null;
  }[];
  inStockSizeCount: number;
  /** 비교를 한 버전의 고른 행 포인트 합계(pt, 참고치). 없으면 null */
  pointsTotalPt: number | null;
}

/**
 * ② 버전의 소싱 선택 상품 장르·상품유형(P2-06 Proposed — ④ 입력 '② 장르·상품유형'). 고른 페이지 스냅샷
 * (`rakuten_item.genre_id`·`genre_path`·`product_type`) 값이다. URL 후보에서 장르를 얻지 못했으면 `genreId`가 null이다.
 */
export interface SourcingGenreView {
  sourcingStepRunId: number;
  rakutenItemId: number;
  /** 리프 장르 id. 없으면 null(장르 없음 — ④는 성별 경로 전체 목록을 보인다) */
  genreId: number | null;
  /** 루트 → 리프 장르 id 경로(`genre_path` 사본에서). 경로가 없으면 `genreId` 하나 또는 빈 배열 */
  genreIdPath: number[];
  /** 상품유형(ERD §7.1-6 — 정하는 방법이 문서에 없어 M1은 늘 null일 수 있다) */
  productType: string | null;
}

/**
 * ② 버전의 소싱 선택 상품 원본 이미지 출처(P3-01 Proposed — ⑤ 원본 받기 F-TH-01·02). 고른 페이지 스냅샷
 * (`rakuten_item.image_urls` = 페이지 JSON `media.images[]`)과 출처 메타(샵·型番). ⑤는 이것을 입력 지문에 넣지 않는다
 * (P3-01 규칙 2 — 같은 앵커 키 안에서 샵만 바뀌어도 ⑤·G3은 그대로).
 */
export interface SourcingImagesView {
  sourcingStepRunId: number;
  rakutenItemId: number;
  itemCode: string;
  shopCode: string;
  shopName: string | null;
  itemUrl: string;
  /** 고른 페이지 스냅샷의 수집 시각 */
  collectedAt: Date;
  /** `media.images[]` 원본 URL(페이지 순서). 비었으면 ⑤가 API 이미지 URL의 `_ex`를 키워 받는다 */
  imageUrls: string[];
  /** 정규화 型番(없으면 null) */
  modelCodeNorm: string | null;
  /**
   * 이미지가 보여 주는 SKU 색상 코드(P3-01 Proposed): 이 상품의 SKU 색상 코드가 **하나뿐이면** 그 값, 여럿이거나 없으면 null
   * (이미지마다 어느 색상인지 모른다 — G3 '같은 상품·색상' 확인·색상 체크리스트로 대신한다)
   */
  colorCode: string | null;
}

export interface SourcingSelectionReader {
  /** ② 버전 하나(step_run id)의 소싱 선택. 선택이 없으면 null */
  read(db: Db, sourcingStepRunId: number): Promise<SourcingSelectionView | null>;
  /**
   * 소싱 선택 상품의 목표 사이즈별 SKU(P2-05 Proposed, 선택 메서드). 선택이 없으면 null. `gender`는 목표 범위(성별)
   */
  readTargetSkus?(
    db: Db,
    sourcingStepRunId: number,
    gender: 'MALE' | 'FEMALE',
  ): Promise<SourcingTargetSkus | null>;
  /** 소싱 선택 상품의 장르·상품유형(P2-06 Proposed, 선택 메서드). 선택이 없으면 null */
  readGenre?(db: Db, sourcingStepRunId: number): Promise<SourcingGenreView | null>;
  /** 소싱 선택 상품의 원본 이미지 출처(P3-01 Proposed, 선택 메서드). 선택이 없으면 null */
  readImages?(db: Db, sourcingStepRunId: number): Promise<SourcingImagesView | null>;
}
