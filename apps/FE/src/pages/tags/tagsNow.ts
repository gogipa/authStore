import type { StepStatusValue } from '@/features/step-engine';
import type { TAGS_GUIDE } from '@/features/guide';

export type TagsNowKey = keyof typeof TAGS_GUIDE.now;

export interface TagsNowInput {
  /** 단계 레일의 ⑦ 상태(레일을 아직 못 받았으면 undefined) */
  stepStatus: StepStatusValue | undefined;
  /** [실행]·[다시 실행]이 서버 이유로 꺼져 있는가(앞 단계 미완료·다른 단계 실행 중 등) */
  runBlocked: boolean;
  /** 읽어 둔 경쟁 태그 입력 수(목록을 아직 못 받았으면 undefined) */
  competitorInputCount: number | undefined;
  /** 현재 버전 산출물의 최종 태그 수(산출물이 없거나 지난 버전이면 undefined) */
  finalTagCount: number | undefined;
}

/**
 * ⑦ 화면 맨 위 '지금 할 일' 글 키(D-41). 화면에 이미 있는 값만 읽어 한 가지를 고른다 — 알 수 없는 상태면 null(줄을 감춘다).
 * 위에서부터 첫 번째로 막힌 일을 말한다: 실행이 꺼진 이유 → 실행(경쟁 태그를 넣어 두었는지로 글이 갈린다) → 최종 태그 확인.
 * ⑦은 오너 입력을 기다리며 멈추지 않는다(입력 대기 없음 — 경쟁 태그는 선택, 편집은 완료 뒤). 그래서 '입력 대기'는 줄을 감춘다.
 */
export function tagsNowKey(input: TagsNowInput): TagsNowKey | null {
  const { stepStatus, runBlocked, competitorInputCount, finalTagCount } = input;
  switch (stepStatus) {
    case undefined:
    case 'WAITING_INPUT':
      return null;
    case 'RUNNING':
      return 'running';
    case 'NOT_RUN':
      if (runBlocked) return 'blocked';
      if (competitorInputCount === undefined) return null;
      return competitorInputCount > 0 ? 'startWithCompetitor' : 'start';
    case 'RERUN_REQUIRED':
      return runBlocked ? 'blocked' : 'rerun';
    case 'FAILED':
      return runBlocked ? 'blocked' : 'failed';
    case 'COMPLETED':
      if (finalTagCount === undefined) return null;
      return finalTagCount === 0 ? 'noTags' : 'done';
  }
}
