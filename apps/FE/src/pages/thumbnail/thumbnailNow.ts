import type { THUMBNAIL_GUIDE } from '@/features/guide';
import type { StepStatusValue } from '@/features/step-engine';
import type { ThumbnailGenerationSummary, ThumbnailOutput } from '@/features/thumbnails';

export type ThumbnailNowKey = keyof typeof THUMBNAIL_GUIDE.now;

export interface ThumbnailNowInput {
  /** 단계 레일의 ⑤ 상태(레일을 아직 못 받았으면 undefined) */
  stepStatus: StepStatusValue | undefined;
  /** [실행]/[다시 실행]이 꺼져 있는가(꺼진 이유가 버튼 아래에 보인다) */
  runBlocked: boolean;
  /** ⑤ 현재 버전 산출물(아직 못 읽었으면 undefined) */
  output:
    | (Pick<ThumbnailOutput, 'isCurrent'> & {
        generationRuns: readonly Pick<
          ThumbnailGenerationSummary,
          'status' | 'resultImageAssetId'
        >[];
      })
    | undefined;
  /** 이 화면에서 레퍼런스 1~3장과 '레퍼런스에 사람·얼굴 없음'을 저장했는가 */
  referencesConfirmed: boolean;
  /** 후보를 만드는 중인가(요청 중이거나 생성 중인 번호가 있다) */
  generating: boolean;
  /** 지금 대표로 고른 이미지(없으면 null) */
  representative: number | null;
  /** 지금 고른 것이 유효한 G3 통과의 선택과 같은가 */
  passedSame: boolean;
}

/**
 * ⑤ 화면 맨 위 '지금 할 일' 글 키(D-41). 화면에 이미 있는 값만 읽어 한 가지를 고른다 — 알 수 없는 상태면 null(줄을 감춘다).
 * 실행을 하지 못하면 `blocked`, 입력을 기다리는 동안은 위에서부터 첫 번째로 막힌 일을 말한다:
 * 생성 중 → 만든 후보에서 대표 고르기 → 선택 전 확인·G3 / (후보가 없으면) 레퍼런스 → 만들기 → 거부·실패 뒤 다시 만들기.
 */
export function thumbnailNowKey(input: ThumbnailNowInput): ThumbnailNowKey | null {
  const { stepStatus, runBlocked, output, referencesConfirmed, generating, representative } = input;
  switch (stepStatus) {
    case undefined:
      return null;
    case 'NOT_RUN':
      return runBlocked ? 'blocked' : 'start';
    case 'RUNNING':
      return 'running';
    case 'RERUN_REQUIRED':
      return runBlocked ? 'blocked' : 'rerun';
    case 'FAILED':
      return runBlocked ? 'blocked' : 'failed';
    case 'WAITING_INPUT': {
      if (!output?.isCurrent) return null;
      if (generating) return 'generating';
      if (hasImage(output)) return representative === null ? 'pickCandidate' : 'passG3';
      if (!referencesConfirmed) return 'pickReferences';
      return output.generationRuns.length === 0 ? 'generate' : 'retry';
    }
    case 'COMPLETED': {
      if (!output?.isCurrent) return null;
      if (input.passedSame) return 'done';
      // 완료 뒤 다시 고르는 중이거나, 기준이 바뀌어 G3을 다시 통과해야 하는 때
      if (representative !== null) return 'passG3';
      return hasImage(output) ? 'pickCandidate' : null;
    }
  }
}

/** 고를 수 있는(생성에 성공한) 후보가 하나라도 있는가 */
function hasImage(output: NonNullable<ThumbnailNowInput['output']>): boolean {
  return output.generationRuns.some(
    (run) => run.status === 'SUCCEEDED' && run.resultImageAssetId !== null,
  );
}
