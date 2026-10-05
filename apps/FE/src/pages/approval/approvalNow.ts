import type { APPROVAL_GUIDE } from '@/features/guide';
import type { PreValidationLineView } from '@/features/registration';
import type { CandidateStatus, StepStatusValue } from '@/features/step-engine';
import type { StepCode } from '@/shared/lib/steps';

export type ApprovalNowKey = keyof typeof APPROVAL_GUIDE.now;

/** '지금 여기' 표시가 붙을 수 있는 자리 */
export type ApprovalNowPlace =
  | 'upload' // ⑧ 상태 줄의 [실행]·[다시 실행]
  | 'switch' // 등록 API 차단 스위치 띠
  | 'validation' // 사전 검증 결과
  | 'approve' // ⑨ 맨 아래 승인 바
  | 'result' // ⑨ 직전 결과 칸
  | 'existing'; // ⑨ 맨 아래 '기존 상품 보기' 상자

type NowLine = Pick<PreValidationLineView, 'id' | 'passed' | 'linkStep'>;

export interface ApprovalNowInput {
  /** 여정 상태(여정을 아직 못 읽었으면 undefined) */
  candidateStatus: CandidateStatus | undefined;
  /** 단계 레일의 ⑧ 상태(레일을 아직 못 받았으면 undefined) */
  uploadStatus: StepStatusValue | undefined;
  /** ⑧ 실행 버튼이 꺼져 있는가(꺼진 이유가 버튼 아래에 적힌다) */
  uploadRunBlocked: boolean;
  /** 승인을 막는 첫 앞 단계(승인 바 아래 '승인 전에 끝낼 곳'의 맨 위). 없으면 null */
  blockerStep: StepCode | null;
  /** 승인 미리보기·사전 검증 결과를 받는 중인가 */
  loading: boolean;
  /** 사전 검증 13줄(결과가 아직 없으면 passed가 모두 null) */
  lines: readonly NowLine[];
  /** 같은 상품·색상이 이미 등록돼 있는가 */
  duplicated: boolean;
  /** 등록 API 차단 스위치(켜짐 true·꺼짐 false·아직 모름 undefined) */
  apiBlocked: boolean | undefined;
  /** 승인 바의 [승인·등록]이 켜져 있는가 */
  approveEnabled: boolean;
  /** 직전 등록 기록에 [결과 확인]을 누를 수 있는가 */
  canCheckResult: boolean;
}

/**
 * ⑧·⑨ 화면 맨 위 '지금 할 일' 글 키(D-41). 화면에 이미 있는 값만 읽어 한 가지를 고른다 — 알 수 없는 상태면 null(줄을 감춘다).
 * 위에서부터 첫 번째로 막힌 일을 말한다: 이미 승인한 뒤의 상태(검증완료·등록요청중·결과확인필요·등록됨)면 그 결과 → ⑧ 이미지 업로드 →
 * (승인대기가 아니면) 앞 단계 → 중복 → 사전 검증 → 승인. 승인 글은 등록 API 차단 스위치가 켜졌는지 꺼졌는지로 갈린다(켜짐=드라이런,
 * 꺼짐=실제 등록 — 스위치 상태를 모르면 말하지 않는다).
 */
export function approvalNowKey(input: ApprovalNowInput): ApprovalNowKey | null {
  switch (input.candidateStatus) {
    case undefined:
    case 'TEMP':
    case 'EXCLUDED':
      return null;
    case 'VALIDATED':
      return 'validated';
    case 'REGISTERING':
      return 'registering';
    case 'RESULT_CHECK_REQUIRED':
      return input.canCheckResult ? 'checkResult' : null;
    case 'REGISTERED':
      return 'registered';
    case 'WORKING':
    case 'AWAITING_APPROVAL':
      break;
  }

  switch (input.uploadStatus) {
    case undefined:
    case 'WAITING_INPUT':
      return null;
    case 'RUNNING':
      return 'uploading';
    case 'NOT_RUN':
      return input.uploadRunBlocked ? 'uploadBlocked' : 'upload';
    case 'RERUN_REQUIRED':
      return input.uploadRunBlocked ? 'uploadBlocked' : 'uploadRerun';
    case 'FAILED':
      return input.uploadRunBlocked ? 'uploadBlocked' : 'uploadFailed';
    case 'COMPLETED':
      break;
  }

  // ⑧까지 끝났는데 승인대기가 아니면 다른 필수 단계나 게이트가 막고 있다(승인 미리보기가 409라 '승인 전에 끝낼 곳'이 뜬다)
  if (input.candidateStatus !== 'AWAITING_APPROVAL') {
    return input.blockerStep ? 'finishSteps' : null;
  }

  if (input.duplicated) return 'duplicate';
  const decided = input.lines.length > 0 && input.lines.every((line) => line.passed !== null);
  if (!decided) return input.loading ? 'checking' : null;
  if (!input.approveEnabled) {
    const failed = input.lines.filter((line) => line.passed === false);
    if (failed.length === 0) return null;
    // 판정 유효 시간만 막고 있으면 [재조회] 한 가지, 다른 줄이 하나라도 실패했으면 그 줄부터 고친다
    return failed.some((line) => line.id !== 'JUDGEMENT_FRESHNESS') ? 'fixValidation' : 'refetch';
  }
  if (input.apiBlocked === undefined) return null;
  return input.apiBlocked ? 'approveDryRun' : 'approveLive';
}

const PLACE = {
  upload: 'upload',
  uploadBlocked: null,
  uploading: null,
  uploadRerun: 'upload',
  uploadFailed: 'upload',
  finishSteps: 'approve',
  checking: null,
  duplicate: 'existing',
  fixValidation: 'validation',
  refetch: 'validation',
  approveDryRun: 'approve',
  approveLive: 'approve',
  validated: 'switch',
  registering: null,
  checkResult: 'result',
  registered: null,
} as const satisfies Record<ApprovalNowKey, ApprovalNowPlace | null>;

/** 지금 할 일이 있는 자리('지금 여기'). 기다리기만 하거나 앱 밖의 일이면 null */
export function approvalNowPlace(key: ApprovalNowKey | null): ApprovalNowPlace | null {
  return key ? PLACE[key] : null;
}

/**
 * 지금 할 일 옆 이동 링크가 열 단계. `fixValidation`은 실패한 줄 가운데 맨 위의 고칠 단계(판정 유효 시간 줄은 이 화면의
 * [재조회]로 한다), `finishSteps`는 '승인 전에 끝낼 곳'의 맨 위 단계. 그 밖의 글에는 링크가 없다.
 */
export function approvalNowLinkStep(
  key: ApprovalNowKey | null,
  input: Pick<ApprovalNowInput, 'lines' | 'blockerStep'>,
): StepCode | null {
  if (key === 'finishSteps') return input.blockerStep;
  if (key === 'fixValidation') {
    const line = input.lines.find(
      (item) => item.passed === false && item.id !== 'JUDGEMENT_FRESHNESS' && item.linkStep,
    );
    return line?.linkStep ?? null;
  }
  return null;
}
