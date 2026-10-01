import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { judgementFreshnessCheck } from '../pre-validation/checks/judgement-freshness.check.js';
import type { PreValidationContext } from '../pre-validation/pre-validation.types.js';

/** 05-2 ApprovalDisabledReason */
export interface ApproveDisabledReason {
  code: string;
  message: string;
}

const GATE_TEXT = { G2: 'G2 판정 확정', G3: 'G3 썸네일 선택' } as const;

/** 표준형 옵션을 쓸 수 없는 카테고리·옵션(P4-03 F-AP-41 — 이유는 `draft.standardOption.reason`) */
export const STANDARD_OPTION_UNSUPPORTED_MESSAGE =
  '이 상품은 표준형 옵션으로 등록할 수 없습니다. 조합형으로 승인해 주세요.';

/**
 * 승인 버튼 꺼짐 이유(05-2 `ApprovalPreview.approveEnabled`·`approveDisabledReason`, P4-02 규칙 14). 미리보기는 외부 호출이 없어 로컬로
 * 알 수 있는 것만 보고, 코드는 승인 API(P4-03)가 같은 이유로 돌려줄 409·422 코드와 같다. 순서는 P4-03 규칙 5의 409 순서를 따른다:
 * 진행 중 기록 `REGISTRATION_IN_PROGRESS` → G2·G3 무효 `GATE_NOT_PASSED` → 판정 유효 시간 초과 `JUDGEMENT_EXPIRED` → 로컬 중복
 * `DUPLICATE_REGISTRATION` → 표준형을 쓸 수 없는 카테고리·옵션 `VALIDATION_FAILED`(P4-03 F-AP-41). 후보 상태·버전은 미리보기 자체가 승인대기·현재 버전이라 넣지
 * 않는다. 사전 검증 결과(BLOCK 실패 → 422 `PRE_VALIDATION_FAILED`)는 화면이 따로 합친다. 켜져 있으면 null.
 */
export function approveDisabledReasonOf(ctx: PreValidationContext): ApproveDisabledReason | null {
  const { inputs, draft } = ctx;
  if (inputs.registrations.inProgress) {
    return {
      code: 'REGISTRATION_IN_PROGRESS',
      message: formatErrorMessage('REGISTRATION_IN_PROGRESS'),
    };
  }
  for (const gate of ['G2', 'G3'] as const) {
    if (!inputs.gates[gate].valid) {
      return {
        code: 'GATE_NOT_PASSED',
        message: formatErrorMessage('GATE_NOT_PASSED', { 게이트: GATE_TEXT[gate] }),
      };
    }
  }
  if (!judgementFreshnessCheck(ctx).passed) {
    return {
      code: 'JUDGEMENT_EXPIRED',
      message: formatErrorMessage('JUDGEMENT_EXPIRED', {
        n: inputs.settings.judgementValidityHours,
      }),
    };
  }
  if (inputs.registrations.duplicate) {
    return {
      code: 'DUPLICATE_REGISTRATION',
      message: formatErrorMessage('DUPLICATE_REGISTRATION'),
    };
  }
  if (draft.optionType === 'STANDARD' && !draft.standardOption.supported) {
    return {
      code: 'VALIDATION_FAILED',
      message: `${STANDARD_OPTION_UNSUPPORTED_MESSAGE}${draft.standardOption.reason ? ` ${draft.standardOption.reason}` : ''}`,
    };
  }
  return null;
}
