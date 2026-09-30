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
}
