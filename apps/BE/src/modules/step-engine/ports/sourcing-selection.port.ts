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

export interface SourcingSelectionReader {
  /** ② 버전 하나(step_run id)의 소싱 선택. 선택이 없으면 null */
  read(db: Db, sourcingStepRunId: number): Promise<SourcingSelectionView | null>;
}
