import type { CONTENT_GUIDE } from '@/features/guide';
import type { StepStatusValue } from '@/features/step-engine';

export type ContentNowKey = keyof (typeof CONTENT_GUIDE)['now'];

/** ⑥ 세부 단계 코드 */
export type ContentStepCode = 'COPY' | 'NOTICE_RAW' | 'NOTICE_HTML';

/** 지금 할 일 글의 `{step}` 자리에 들어가는 화면 이름 */
export const CONTENT_STEP_LABEL: Readonly<Record<ContentStepCode, string>> = {
  COPY: '⑥-1',
  NOTICE_RAW: '⑥-2',
  NOTICE_HTML: '⑥-3',
};

export interface ContentNowInput {
  /** 단계 레일의 ⑥-1·⑥-2·⑥-3 상태(레일을 아직 못 받았으면 undefined) */
  copyStatus: StepStatusValue | undefined;
  factStatus: StepStatusValue | undefined;
  assemblyStatus: StepStatusValue | undefined;
  /** 맨 위 [실행]·[⑥-1 실행]이 꺼져 있는가(꺼진 이유 글이 화면에 보인다) */
  runBlocked: boolean;
  /** ⑥-1: 다시 실행한 결과가 직접 고친 값과 달라 고르기를 기다리는 항목이 있는가 */
  copyChoicePending: boolean;
  /** ⑥-2·⑥-3: '재확인 필요' 표시가 붙은 줄이 있는가 */
  factRecheck: boolean;
  assemblyRecheck: boolean;
  /** 구매대행 프로필에 ⑥-3이 막히는 빈칸이 있는가 */
  profileMissing: boolean;
}

export interface ContentNow {
  key: ContentNowKey;
  /** 지금 할 일이 놓인 구획(맨 위 실행 줄·전체 글이면 null). `{step}` 자리와 '지금 여기' 표시 자리를 정한다 */
  step: ContentStepCode | null;
}

const at = (key: ContentNowKey, step: ContentStepCode | null = null): ContentNow => ({
  key,
  step,
});

/**
 * ⑥ 화면 맨 위 '지금 할 일'(D-41). 화면에 이미 있는 값만 읽어 **위에서부터 첫 번째로 막힌 일** 한 가지를 고른다:
 * ⑥-1 카피 → ⑥-2 원산지·소재 → ⑥-3 고시·HTML. 어느 단계든 실행 중이면 기다리라고 말한다.
 * 알 수 없는 상태(레일을 못 받음, 입력을 기다릴 일이 없는 단계가 입력 대기)면 null — 줄을 감춘다.
 */
export function contentNow(input: ContentNowInput): ContentNow | null {
  const { copyStatus, factStatus, assemblyStatus } = input;
  if (copyStatus === undefined || factStatus === undefined || assemblyStatus === undefined) {
    return null;
  }
  if ([copyStatus, factStatus, assemblyStatus].includes('RUNNING')) return at('running');

  // ⑥-1 카피
  switch (copyStatus) {
    case 'NOT_RUN':
      if (input.runBlocked) return at('blocked');
      return factStatus === 'NOT_RUN' && assemblyStatus === 'NOT_RUN'
        ? at('start')
        : at('runStep', 'COPY');
    case 'FAILED':
      return input.runBlocked ? at('blocked') : at('failedStep', 'COPY');
    case 'RERUN_REQUIRED':
      return input.runBlocked ? at('blocked') : at('rerunCopy', 'COPY');
    case 'WAITING_INPUT':
      return null;
    case 'COMPLETED':
      if (input.copyChoicePending) return at('chooseCopy', 'COPY');
  }

  // ⑥-2 원산지·소재
  switch (factStatus) {
    case 'NOT_RUN':
      return at('runStep', 'NOTICE_RAW');
    case 'FAILED':
      return at('failedStep', 'NOTICE_RAW');
    case 'WAITING_INPUT':
      return at('originInput', 'NOTICE_RAW');
    case 'RERUN_REQUIRED':
      return at(input.factRecheck ? 'recheckStep' : 'rerunStep', 'NOTICE_RAW');
    case 'COMPLETED':
      if (input.factRecheck) return at('recheckStep', 'NOTICE_RAW');
  }

  // ⑥-3 고시·HTML
  switch (assemblyStatus) {
    case 'NOT_RUN':
      return input.profileMissing ? at('fillProfile', 'NOTICE_HTML') : at('runStep', 'NOTICE_HTML');
    case 'FAILED':
      return input.profileMissing
        ? at('fillProfile', 'NOTICE_HTML')
        : at('failedStep', 'NOTICE_HTML');
    case 'RUNNING': // 위에서 먼저 걸러진다(switch를 끝까지 따져 보도록 남긴 자리)
      return at('running');
    case 'WAITING_INPUT':
      return null;
    case 'RERUN_REQUIRED':
      if (input.assemblyRecheck) return at('recheckStep', 'NOTICE_HTML');
      return input.profileMissing
        ? at('fillProfile', 'NOTICE_HTML')
        : at('rerunStep', 'NOTICE_HTML');
    case 'COMPLETED':
      return input.assemblyRecheck ? at('recheckStep', 'NOTICE_HTML') : at('done');
  }
}

/** 지금 할 일 글 키만(알 수 없으면 null) */
export function contentNowKey(input: ContentNowInput): ContentNowKey | null {
  return contentNow(input)?.key ?? null;
}
