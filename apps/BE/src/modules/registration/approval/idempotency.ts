import { ApiException } from '../../../common/errors/api.exception.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import type { Registration } from '../../../generated/prisma/client.js';
import type { Db } from '../../step-engine/candidates/step-engine-tx.js';
import {
  REGISTRATION_OPTION_TYPES,
  type RegistrationOptionType,
} from '../draft/approval-inputs.js';

/**
 * G4 승인 요청의 멱등(P4-03 §5 `approval/idempotency.ts`, 05-1 §1.7, 규칙 5). 키는 `registration.idempotency_key`(UNIQUE)에 남는다.
 * - 헤더가 없거나 비었으면 400 `IDEMPOTENCY_KEY_REQUIRED`
 * - UUID 모양이 아니면 422 `VALIDATION_FAILED`(fieldErrors `Idempotency-Key`) — 문서에 없어 정했다(Proposed, 05-1 §7.5)
 * - 같은 키 기록이 있으면 '같은 본문'인지 본다: 후보(경로)·`option_type`·`upload_result_id`·`price_judgement_id`가 모두 같으면 첫 응답
 *   (202 `RegistrationAccepted`)을 그대로, 하나라도 다르면 422 `IDEMPOTENCY_KEY_REUSED`. 후보까지 비교하는 것은 Proposed다
 */

/** 요청 헤더 이름(Express는 소문자로 준다) */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 승인 body(05-2 RegistrationCreateRequest) */
export interface ApprovalBody {
  optionType: RegistrationOptionType;
  expectedUploadResultId: number;
  expectedPriceJudgementId: number;
}

/** 같은 본문 비교 대상 */
export interface ApprovalIdentity {
  candidateId: number;
  optionType: string;
  uploadResultId: number;
  priceJudgementId: number;
}

/** 05-2 RegistrationAccepted(202 본문) */
export interface RegistrationAccepted {
  registrationId: number;
  stepRunId: number;
  candidateId: number;
  status: 'VALIDATED' | 'REGISTERING';
  sellerManagementCode: string;
  displayStatusType: 'SUSPENSION' | 'ON';
  approvedAt: string;
}

/** 헤더 → 키(소문자 UUID). 없으면 400, 모양이 틀리면 422 */
export function parseIdempotencyKey(raw: unknown): string {
  const value: unknown = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiException('IDEMPOTENCY_KEY_REQUIRED');
  }
  const key = value.trim();
  if (!UUID_PATTERN.test(key)) {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [{ field: 'Idempotency-Key', message: 'UUID 형식이어야 합니다.' }],
    });
  }
  return key.toLowerCase();
}

const ID_MAX = 2_147_483_647;

function positiveInt(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= ID_MAX
    ? value
    : null;
}

/** body 검사(05-2 RegistrationCreateRequest — 정의 밖 칸·빠진 칸·형식 → 422 VALIDATION_FAILED) */
export function parseApprovalBody(raw: unknown): ApprovalBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [{ field: 'body', message: '요청 본문은 객체여야 합니다.' }],
    });
  }
  const body = raw as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const key of Object.keys(body)) {
    if (!['optionType', 'expectedUploadResultId', 'expectedPriceJudgementId'].includes(key)) {
      errors.push({ field: key, message: '받지 않는 칸입니다.' });
    }
  }
  const optionType = body.optionType;
  if (
    typeof optionType !== 'string' ||
    !(REGISTRATION_OPTION_TYPES as readonly string[]).includes(optionType)
  ) {
    errors.push({ field: 'optionType', message: 'COMBINATION·STANDARD 중 하나여야 합니다.' });
  }
  const upload = positiveInt(body.expectedUploadResultId);
  if (upload === null) {
    errors.push({ field: 'expectedUploadResultId', message: '1 이상의 정수여야 합니다.' });
  }
  const judgement = positiveInt(body.expectedPriceJudgementId);
  if (judgement === null) {
    errors.push({ field: 'expectedPriceJudgementId', message: '1 이상의 정수여야 합니다.' });
  }
  if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
  return {
    optionType: optionType as RegistrationOptionType,
    expectedUploadResultId: upload!,
    expectedPriceJudgementId: judgement!,
  };
}

/** 같은 본문인가(후보·옵션 방식·⑧ 산출물·③ 판정) */
export function isSameApproval(stored: ApprovalIdentity, request: ApprovalIdentity): boolean {
  return (
    stored.candidateId === request.candidateId &&
    stored.optionType === request.optionType &&
    stored.uploadResultId === request.uploadResultId &&
    stored.priceJudgementId === request.priceJudgementId
  );
}

/** 등록 기록 → 202 본문(첫 응답 — 지금 상태가 아니라 승인 때 상태: 드라이런 VALIDATED / 실제 REGISTERING) */
export function acceptedOf(
  row: Pick<
    Registration,
    'id' | 'stepRunId' | 'status' | 'sellerManagementCode' | 'displayStatusType' | 'approvedAt'
  >,
  candidateId: number,
): RegistrationAccepted {
  return {
    registrationId: row.id,
    stepRunId: row.stepRunId,
    candidateId,
    status: row.status === 'VALIDATED' ? 'VALIDATED' : 'REGISTERING',
    sellerManagementCode: row.sellerManagementCode,
    displayStatusType: row.displayStatusType === 'ON' ? 'ON' : 'SUSPENSION',
    approvedAt: row.approvedAt.toISOString(),
  };
}

/** 같은 키 기록이 있으면 첫 응답, 다른 본문이면 422 IDEMPOTENCY_KEY_REUSED. 없으면 null */
export async function replayIdempotentApproval(
  db: Db,
  key: string,
  request: ApprovalIdentity,
): Promise<RegistrationAccepted | null> {
  const row = await db.registration.findUnique({
    where: { idempotencyKey: key },
    include: { stepRun: { select: { candidateId: true } } },
  });
  if (!row) return null;
  const stored: ApprovalIdentity = {
    candidateId: row.stepRun.candidateId,
    optionType: row.optionType,
    uploadResultId: row.uploadResultId,
    priceJudgementId: row.priceJudgementId,
  };
  if (!isSameApproval(stored, request)) {
    throw new ApiException('IDEMPOTENCY_KEY_REUSED', {
      details: { registrationId: row.id },
    });
  }
  return acceptedOf(row, stored.candidateId);
}
