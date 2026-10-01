import type { Prisma } from '../../../generated/prisma/client.js';
import type { CreateProductResult } from '../../integrations/naver-commerce/commerce-products.port.js';
import type { StepOutcome } from '../../step-engine/contracts/step-runner.js';
import type { CandidateStatus, CandidateStatusReason } from '../../step-engine/domain/steps.js';
import { translateRegistrationError } from '../errors/invalid-inputs.translator.js';

/**
 * 등록 호출 결과 → 등록 기록·⑨·후보에 쓸 값(P4-03 규칙 8 — 순수 함수, ERD `registration` '⑨ StepRun과의 대응' ③).
 * - 2xx(SUCCESS) → 기록 `REGISTERED`(상품 번호 숫자 글자·registered_at·response_received_at·http_status·trace_id), ⑨ `COMPLETED`,
 *   후보 `REGISTERED`(`REGISTER_SUCCEEDED`)
 * - 4xx(CLIENT_ERROR) → 기록 상태는 `REGISTERING` 그대로 + `failed_at`·`failure_kind=INVALID_INPUT_4XX`·http_status·error_code·한국어
 *   error_message·invalid_inputs 원문·trace_id, ⑨ `FAILED`(EXTERNAL_API), 후보 `AWAITING_APPROVAL`(`REGISTER_4XX`)
 * - 타임아웃·5xx·연결 오류(UNKNOWN) → 기록 `RESULT_CHECK_REQUIRED`, ⑨ `FAILED`(EXTERNAL_API), 후보 `RESULT_CHECK_REQUIRED`
 *   (`REGISTER_UNKNOWN`). 자동 재시도 없음
 */
export interface RegisterOutcome {
  /** 등록 기록 UPDATE 값 */
  registration: Prisma.RegistrationUpdateInput;
  /** ⑨ 닫기 */
  step: StepOutcome;
  /** 후보 전이 */
  candidate: { toStatus: CandidateStatus; reason: CandidateStatusReason };
  /** 화면·로그 분류 */
  kind: 'REGISTERED' | 'INVALID_INPUT_4XX' | 'RESULT_CHECK_REQUIRED';
}

/** 응답 불명 사유 글 */
const UNKNOWN_REASON_TEXT: Readonly<Record<string, string>> = {
  TIMEOUT: '응답 시간 초과',
  NETWORK_ERROR: '연결 실패',
  INVALID_RESPONSE: '응답을 읽지 못함',
};

/** 응답 불명 안내(Proposed) */
export function unknownResultMessage(
  result: Extract<CreateProductResult, { kind: 'UNKNOWN' }>,
): string {
  const reason =
    result.httpStatus !== null && result.errorCode !== 'INVALID_RESPONSE'
      ? `HTTP ${result.httpStatus}`
      : (UNKNOWN_REASON_TEXT[result.errorCode] ?? result.errorCode);
  return `커머스API 응답을 받지 못해 등록됐는지 알 수 없습니다(${reason}). 다시 승인하지 말고 '결과 확인'으로 판매자관리코드를 조회해 주세요.`;
}

export function registerOutcomeOf(result: CreateProductResult, now: Date): RegisterOutcome {
  if (result.kind === 'SUCCESS') {
    return {
      kind: 'REGISTERED',
      registration: {
        status: 'REGISTERED',
        originProductNo: result.originProductNo,
        channelProductNo: result.channelProductNo,
        registeredAt: now,
        responseReceivedAt: now,
        httpStatus: result.httpStatus,
        traceId: result.traceId,
        errorCode: null,
        errorMessage: null,
      },
      step: { kind: 'COMPLETED', output: { originProductNo: result.originProductNo } },
      candidate: { toStatus: 'REGISTERED', reason: 'REGISTER_SUCCEEDED' },
    };
  }
  if (result.kind === 'CLIENT_ERROR') {
    const message = translateRegistrationError({
      httpStatus: result.httpStatus,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      invalidInputs: result.invalidInputs,
    });
    return {
      kind: 'INVALID_INPUT_4XX',
      registration: {
        failedAt: now,
        failureKind: 'INVALID_INPUT_4XX',
        responseReceivedAt: now,
        httpStatus: result.httpStatus,
        errorCode: result.errorCode.slice(0, 100),
        errorMessage: message,
        invalidInputs: result.invalidInputs as unknown as Prisma.InputJsonArray,
        traceId: result.traceId,
      },
      step: {
        kind: 'FAILED',
        failureKind: 'EXTERNAL_API',
        errorCode: result.errorCode.slice(0, 100),
        errorMessage: message,
      },
      candidate: { toStatus: 'AWAITING_APPROVAL', reason: 'REGISTER_4XX' },
    };
  }
  const message = unknownResultMessage(result);
  return {
    kind: 'RESULT_CHECK_REQUIRED',
    registration: {
      status: 'RESULT_CHECK_REQUIRED',
      responseReceivedAt: result.httpStatus !== null ? now : null,
      httpStatus: result.httpStatus,
      errorCode: result.errorCode.slice(0, 100),
      errorMessage: message,
      traceId: result.traceId,
    },
    step: {
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: result.errorCode.slice(0, 100),
      errorMessage: message,
    },
    candidate: { toStatus: 'RESULT_CHECK_REQUIRED', reason: 'REGISTER_UNKNOWN' },
  };
}
