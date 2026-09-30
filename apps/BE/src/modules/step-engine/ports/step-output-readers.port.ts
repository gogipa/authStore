import type { Db } from '../candidates/step-engine-tx.js';

/**
 * 앞 단계 산출물 읽기 창구(P3-04 Proposed — C4 §3.1 '② 소싱 선택 읽기'와 같은 방식). 산출물을 가진 단계 모듈이 앱 시작 때 읽기
 * 함수를 등록하고(`StepEngineApi.register…`), 읽는 단계 모듈은 step-engine을 거쳐 이것만 쓴다 — 단계 모듈끼리 import하지 않는다
 * (03-ADR-003).
 */

/** ③ 버전의 판매 사이즈(⑥-3 시작 조건 '③ 판매 사이즈 집합' — `price_judgement_size.is_sellable`, mm 오름차순) */
export interface PricingSaleSizesView {
  pricingStepRunId: number;
  saleSizesMm: number[];
}

/** ③ 판정 읽기(pricing이 등록) */
export interface PricingOutputReader {
  /** ③ 버전 하나(step_run id)의 판매 사이즈. 판정이 없으면 null */
  readSaleSizes(db: Db, pricingStepRunId: number): Promise<PricingSaleSizesView | null>;
}

/** 후보의 지금 G3 선택본(⑤ 현재 버전의 `thumbnail_selection_image`, 순서대로) */
export interface ThumbnailSelectionView {
  thumbnailStepRunId: number;
  images: { imageAssetId: number; role: 'REPRESENTATIVE' | 'ADDITIONAL'; sortOrder: number }[];
}

/** ⑤ G3 선택본 읽기(thumbnails가 등록). ⑥-3 미리보기가 자리표시자를 채울 때만 쓴다(⑥-3 입력이 아니다 — 규칙 1·12) */
export interface ThumbnailSelectionReader {
  /** ⑤ 현재 버전의 선택본. ⑤ 미실행·선택 전이면 null */
  readCurrentSelection(db: Db, candidateId: number): Promise<ThumbnailSelectionView | null>;
}
