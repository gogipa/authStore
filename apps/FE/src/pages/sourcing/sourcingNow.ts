import type { StepStatusValue } from '@/features/step-engine';
import type { SourcingComparisonDetail } from '@/features/sourcing';
import type { SOURCING_NOW_TEXT } from '@/features/guide';

export type SourcingNowKey = keyof typeof SOURCING_NOW_TEXT;

export interface SourcingNowInput {
  /** 단계 레일의 ② 상태(레일을 아직 못 받았으면 undefined) */
  stepStatus: StepStatusValue | undefined;
  /** 현재 ② 비교표 머리(검색 전이면 undefined) */
  head:
    | Pick<SourcingComparisonDetail, 'comparisonPerformed' | 'exploreMode' | 'isCurrent' | 'rows'>
    | undefined;
  /** 비교에 쓰는 성별을 알고 있는가 */
  genderKnown: boolean;
  /** '성인용 상품 확인'을 지금 체크할 수 있는가 */
  adultPending: boolean;
}

/**
 * ② 화면 맨 위 '지금 할 일' 글 키(D-34). 화면에 이미 있는 값만 읽어 한 가지를 고른다 — 알 수 없는 상태면 null(줄을 감춘다).
 * 입력을 기다리는 동안은 위에서부터 첫 번째로 막힌 일을 말한다: 기준 상품 → 성별 → 살 샵 → 성인용 확인.
 */
export function sourcingNowKey(input: SourcingNowInput): SourcingNowKey | null {
  const { stepStatus, head, genderKnown, adultPending } = input;
  switch (stepStatus) {
    case undefined:
      return null;
    case 'NOT_RUN':
      return 'start';
    case 'RUNNING':
      return 'running';
    case 'COMPLETED':
      return 'done';
    case 'RERUN_REQUIRED':
      return 'rerun';
    case 'FAILED':
      return 'failed';
    case 'WAITING_INPUT': {
      if (!head || !head.isCurrent) return null;
      // 비교를 하지 않은 여정(라쿠텐 URL로 바로 만든 여정)은 성인용 확인만 남을 수 있다
      if (!head.comparisonPerformed) return adultPending ? 'confirmAdult' : null;
      if (head.exploreMode) return 'pickAnchor';
      if (!genderKnown) return 'pickGender';
      if (!head.rows.some((row) => row.isSelected)) return 'pickShop';
      return adultPending ? 'confirmAdult' : null;
    }
  }
}
