import { PRE_VALIDATION_CHECKS } from './checks/index.js';
import {
  PRE_VALIDATION_CHECK_CODES,
  type PreValidationCheck,
  type PreValidationContext,
} from './pre-validation.types.js';

/** 검사 15개를 05-3 §5.3 순서로 돌린다(순수) */
export function runPreValidationChecks(ctx: PreValidationContext): PreValidationCheck[] {
  return PRE_VALIDATION_CHECK_CODES.map((code) => PRE_VALIDATION_CHECKS[code](ctx));
}

/** 승인할 수 있는가 = BLOCK 항목이 모두 통과(P4-02 규칙 2) */
export function isApprovable(checks: readonly PreValidationCheck[]): boolean {
  return checks.every((check) => check.severity !== 'BLOCK' || check.passed);
}
