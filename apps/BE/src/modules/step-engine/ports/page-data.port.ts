import { Injectable } from '@nestjs/common';
import type { Db } from '../candidates/step-engine-tx.js';
import { loadCurrentSelection } from '../candidates/candidate-view.js';

/**
 * ② 페이지 데이터 수집 시각 포트(F-CW-20, 05-2 CandidateDetail.pageDataCollectedAt). '오래됨' = 이 시각 + 판정 유효 시간
 * (설정 safety.judgementValidityHours, 기본 6시간) < 지금. 오래됨은 표시만 하고 '재실행 필요'로 바꾸지 않는다.
 * P2-02(라쿠텐 연동)가 페이지 조회 규칙에 맞게 바꿔 끼운다. 기본 구현은 현재 ② 버전의 소싱 선택 상품
 * `rakuten_item.collected_at`을 읽는다(② 산출물이 없으면 null — P2-02 전에는 늘 null).
 */
export interface PageDataPort {
  /** 현재 ② 버전(`sourcingStepRunId`)의 선택 상품 페이지 수집 시각. 없으면 null */
  collectedAt(db: Db, sourcingStepRunId: number | null): Promise<Date | null>;
}

export const PAGE_DATA = Symbol('PAGE_DATA');

@Injectable()
export class SourcingSelectionPageData implements PageDataPort {
  async collectedAt(db: Db, sourcingStepRunId: number | null): Promise<Date | null> {
    const selection = await loadCurrentSelection(db, sourcingStepRunId);
    return selection?.collectedAt ?? null;
  }
}
