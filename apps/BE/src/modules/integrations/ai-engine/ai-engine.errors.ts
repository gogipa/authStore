import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { AI_ENGINE_LABEL } from './ai-engine.constants.js';
import type { AiEngineCode } from './ai-engine.port.js';

/**
 * AI 실행 오류(P1-10 규칙 8·9·12·14). 단계 실행기에서 던지면 step-engine이 `step_run`을 FAILED로 닫는다:
 * `failure_kind = failureKind`, `error_code = errorCode`, `error_message = userMessage`(한국어, 비밀·로컬 경로 없음).
 * `error_code` 이름은 Proposed(ERD step_run.error_code, 04-1 §3.1): 아래 `AI_RUN_ERROR_CODES`.
 */

/**
 * 선택 엔진을 쓸 수 없는 사유(05-3 AI_ENGINE_UNAVAILABLE details.reason, ai_cli_check.error_code와 같은 값).
 * NOT_INSTALLED·NOT_LOGGED_IN·CONTRACT_FAILED·VERSION_UNSUPPORTED는 문서 값, NOT_CHECKED(선택 엔진 점검 행 없음)·
 * MODEL_NOT_SET(설정에 모델이 없음)은 P1-10 Proposed. VERSION_UNSUPPORTED는 M1에서 거절 사유로 쓰지 않는다(경고만).
 */
export const AI_UNAVAILABLE_REASONS = [
  'NOT_INSTALLED',
  'NOT_LOGGED_IN',
  'CONTRACT_FAILED',
  'VERSION_UNSUPPORTED',
  'NOT_CHECKED',
  'MODEL_NOT_SET',
] as const;
export type AiUnavailableReason = (typeof AI_UNAVAILABLE_REASONS)[number];

/** 사유 → 문구의 `{사유}` */
export const AI_UNAVAILABLE_REASON_LABEL: Readonly<Record<AiUnavailableReason, string>> = {
  NOT_INSTALLED: '설치되지 않음',
  NOT_LOGGED_IN: '로그인 풀림',
  CONTRACT_FAILED: '연결 테스트 실패',
  VERSION_UNSUPPORTED: '지원 밖 버전',
  NOT_CHECKED: '점검 기록 없음',
  MODEL_NOT_SET: '모델이 정해지지 않음',
};

/** step_run.error_code·call_log.error_code에 쓰는 AI 실행 오류 코드(P1-10 Proposed) */
export const AI_RUN_ERROR_CODES = {
  /** 실행 중 선택 엔진을 쓸 수 없음(실행 파일 없음·로그인 풀림·모델 없음, 문서 값) */
  ENGINE_UNAVAILABLE: 'AI_ENGINE_UNAVAILABLE',
  /** 결과가 스키마와 다름·JSON 아님·SUCCESS인데 빈 결과·부분 출력(규칙 8) */
  OUTPUT_INVALID: 'AI_OUTPUT_INVALID',
  /** 비전 결과의 images_seen이 없거나 넘긴 이미지와 다름(규칙 9) */
  IMAGES_NOT_SEEN: 'AI_IMAGES_NOT_SEEN',
  /** agy stderr의 AGY_ERROR(문서 값) */
  AGY_ERROR: 'AGY_ERROR',
  /** exit code ≠ 0(그 밖) */
  CLI_FAILED: 'AI_CLI_FAILED',
  /** 시간 제한(텍스트 120s·비전 180s)을 넘겨 자식을 끝냄 */
  TIMEOUT: 'AI_TIMEOUT',
  /** 프롬프트에 비밀·개인정보·네이버 출처 데이터(규칙 14). failure_kind = INPUT_VALIDATION */
  INPUT_BLOCKED: 'AI_INPUT_BLOCKED',
} as const;
export type AiRunErrorCode = (typeof AI_RUN_ERROR_CODES)[keyof typeof AI_RUN_ERROR_CODES];

/** 선택 엔진을 쓸 수 없음 문구(05-3 AI_ENGINE_UNAVAILABLE과 같은 문구) */
export function aiEngineUnavailableMessage(
  engine: AiEngineCode,
  reason: AiUnavailableReason,
): string {
  return formatErrorMessage('AI_ENGINE_UNAVAILABLE', {
    엔진: AI_ENGINE_LABEL[engine],
    사유: AI_UNAVAILABLE_REASON_LABEL[reason],
  });
}

/** AI 실행 오류의 공통 모양(step-engine이 이 모양으로 FAILED를 만든다) */
export abstract class AiExecutionError extends Error {
  abstract readonly errorCode: AiRunErrorCode;
  abstract readonly failureKind: 'AI' | 'INPUT_VALIDATION';
  /** 화면·step_run.error_message용 한국어 문구(비밀·로컬 경로 없음) */
  abstract readonly userMessage: string;
}

/** 규칙 12: 실행 파일 없음(ENOENT)·로그인 풀림·모델 없음. 다른 엔진으로 넘어가지 않는다 */
export class AiEngineUnavailableError extends AiExecutionError {
  readonly errorCode = AI_RUN_ERROR_CODES.ENGINE_UNAVAILABLE;
  readonly failureKind = 'AI' as const;
  readonly userMessage: string;

  constructor(
    readonly engine: AiEngineCode,
    readonly reason: AiUnavailableReason,
  ) {
    super(`AI 엔진 ${engine}을 쓸 수 없습니다(${reason})`);
    this.name = 'AiEngineUnavailableError';
    this.userMessage = aiEngineUnavailableMessage(engine, reason);
  }
}

/** 규칙 8·9: 결과를 믿을 수 없다(스키마 불일치·빈 결과·부분 출력·images_seen 불일치) */
export class AiOutputInvalidError extends AiExecutionError {
  readonly failureKind = 'AI' as const;
  readonly userMessage: string;

  constructor(
    readonly errorCode:
      typeof AI_RUN_ERROR_CODES.OUTPUT_INVALID | typeof AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN,
    /** 짧은 한국어 사유(필드 경로 정도, 값·출력 본문 없음) */
    readonly detail: string,
  ) {
    super(`AI 결과를 쓰지 않습니다(${errorCode}: ${detail})`);
    this.name = 'AiOutputInvalidError';
    this.userMessage =
      errorCode === AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN
        ? `AI가 넘긴 이미지를 모두 읽었다고 답하지 않아 결과를 쓰지 않았습니다(${detail}). 다시 실행해 보세요.`
        : `AI 결과가 정해진 형식과 달라 쓰지 않았습니다(${detail}). 다시 실행해 보세요.`;
  }
}

/** 규칙 8: exit code ≠ 0·AGY_ERROR·시간 제한 */
export class AiCallFailedError extends AiExecutionError {
  readonly failureKind = 'AI' as const;
  readonly userMessage: string;

  constructor(
    readonly engine: AiEngineCode,
    readonly errorCode:
      | typeof AI_RUN_ERROR_CODES.AGY_ERROR
      | typeof AI_RUN_ERROR_CODES.CLI_FAILED
      | typeof AI_RUN_ERROR_CODES.TIMEOUT,
    readonly detail: string,
  ) {
    super(`AI CLI 호출 실패(${engine}, ${errorCode}: ${detail})`);
    this.name = 'AiCallFailedError';
    const label = AI_ENGINE_LABEL[engine];
    this.userMessage =
      errorCode === AI_RUN_ERROR_CODES.TIMEOUT
        ? `${label} 응답이 시간 제한(${detail}) 안에 오지 않아 멈췄습니다. 다시 실행해 보세요.`
        : errorCode === AI_RUN_ERROR_CODES.AGY_ERROR
          ? `${label}가 오류(AGY_ERROR)를 알렸습니다. 다시 실행해 보고, 계속되면 'AI 엔진' 설정에서 연결 테스트를 해 보세요.`
          : `${label} 호출이 오류로 끝났습니다(${detail}). 다시 실행해 보고, 계속되면 'AI 엔진' 설정에서 연결 테스트를 해 보세요.`;
  }
}

/** 규칙 14에서 찾은 것 하나(값은 담지 않는다) */
export interface AiGuardFinding {
  /** -1 = 지시문, 0부터 = 데이터 블록 순서 */
  block: number;
  kind: 'NAVER_SOURCE' | 'SECRET' | 'PERSONAL';
  /** 패턴·출처 이름(예: 'Bearer 토큰', 'NAVER_DATALAB', '이메일') */
  what: string;
}

/** 규칙 14: 비밀·개인정보·네이버 출처 데이터가 들어 있어 보내지 않는다(spawn·call_log 없음) */
export class AiInputBlockedError extends AiExecutionError {
  readonly errorCode = AI_RUN_ERROR_CODES.INPUT_BLOCKED;
  readonly failureKind = 'INPUT_VALIDATION' as const;
  readonly userMessage: string;

  constructor(readonly findings: readonly AiGuardFinding[]) {
    const kinds = [...new Set(findings.map((f) => f.what))].join(', ');
    super(`AI 입력 차단: ${kinds}`);
    this.name = 'AiInputBlockedError';
    this.userMessage = `AI에 보낼 입력에 보내면 안 되는 내용(${kinds})이 있어 보내지 않았습니다.`;
  }
}

/** 규칙 7을 어긴 스키마(앱 코드의 잘못 — 호출 전에 거부한다). step-engine은 앱 오류(INTERNAL_ERROR)로 남긴다 */
export class AiSchemaRuleError extends Error {
  constructor(readonly violations: readonly string[]) {
    super(`AI 결과 스키마 규칙 위반: ${violations.join(' / ')}`);
    this.name = 'AiSchemaRuleError';
  }
}

export function isAiExecutionError(error: unknown): error is AiExecutionError {
  return error instanceof AiExecutionError;
}
