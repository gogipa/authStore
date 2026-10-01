import type { RegistrationStatusChangedEvent } from '../../../common/events/progress-event.types.js';
import type { Registration } from '../../../generated/prisma/client.js';
import type { CandidateStatus } from '../../step-engine/domain/steps.js';

/**
 * ⑨ 등록 기록(`registration`) 공용 상수·도우미(P4-03). 상태 코드는 ERD `ck_reg_status`·05-2 RegistrationStatus 그대로다.
 * '진행 중'은 늘 `failed_at IS NULL`과 함께 본다(4xx 종결 기록은 status=REGISTERING으로 남는다 — 작업 지시 §8).
 */

export type RegistrationStatus =
  'VALIDATED' | 'REGISTERING' | 'RESULT_CHECK_REQUIRED' | 'REGISTERED';
export type RegistrationFailureKind = 'INVALID_INPUT_4XX' | 'NOT_FOUND_ON_CHECK';

/** 등록 기록 상태 화면 이름(후보 상태와 같은 이름 — 05-2 RegistrationStatus) */
export const REGISTRATION_STATUS_LABEL: Record<RegistrationStatus, string> = {
  VALIDATED: '검증완료',
  REGISTERING: '등록요청중',
  RESULT_CHECK_REQUIRED: '결과확인필요',
  REGISTERED: '등록됨',
};

/** 종결 사유 화면 이름 */
export const REGISTRATION_FAILURE_LABEL: Record<RegistrationFailureKind, string> = {
  INVALID_INPUT_4XX: '입력 오류로 종결',
  NOT_FOUND_ON_CHECK: '조회 결과 없음으로 종결',
};

/** 상태 글(종결이면 종결 사유) — REGISTRATION_STATUS_INVALID {상태} */
export function registrationStatusText(row: Pick<Registration, 'status' | 'failureKind'>): string {
  if (row.failureKind) {
    return (
      REGISTRATION_FAILURE_LABEL[row.failureKind as RegistrationFailureKind] ?? row.failureKind
    );
  }
  return REGISTRATION_STATUS_LABEL[row.status as RegistrationStatus] ?? row.status;
}

/**
 * 스마트스토어센터 상품 화면 주소(F-AP-37 '기존 상품 보기' — 05-1 §7.5 'P4-03 구현 결정', Proposed). 주소 형식은 문서에 없어
 * 원상품 번호로 여는 상품 수정 화면으로 정했다. 화면(FE)은 소스에 외부 주소를 두지 않으므로(FE 규칙 15) 서버가 만들어 준다.
 * 실측(M0 S3) 뒤 이 상수만 고친다.
 */
export const SMARTSTORE_PRODUCT_URL_TEMPLATE =
  'https://sell.smartstore.naver.com/#/products/edit/{originProductNo}';

export function smartstoreProductUrl(originProductNo: string | null | undefined): string | null {
  return originProductNo
    ? SMARTSTORE_PRODUCT_URL_TEMPLATE.replace('{originProductNo}', originProductNo)
    : null;
}

/** SSE `registration.status-changed` 본문(05-2 RegistrationStatusChangedEvent) */
export function registrationChangedEvent(
  row: Pick<
    Registration,
    | 'id'
    | 'stepRunId'
    | 'status'
    | 'originProductNo'
    | 'errorCode'
    | 'errorMessage'
    | 'traceId'
    | 'failureKind'
  >,
  candidateId: number,
  candidateStatus: CandidateStatus,
): RegistrationStatusChangedEvent {
  return {
    registrationId: row.id,
    candidateId,
    stepRunId: row.stepRunId,
    status: row.status as RegistrationStatus,
    originProductNo: row.originProductNo,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    traceId: row.traceId,
    failureKind: (row.failureKind as RegistrationFailureKind | null) ?? null,
    candidateStatus,
  };
}
