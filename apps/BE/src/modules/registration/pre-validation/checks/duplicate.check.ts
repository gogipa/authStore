import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf } from './check-helpers.js';

/**
 * `DUPLICATE`(F-AP-36 일부, RG-12, P4-02 §5): 로컬 DB에 같은 `item_code + selected_color`의 진행 중·등록됨 등록 기록(`failed_at` 없음 —
 * `uq_registration_live_key`와 같은 조건)이 있으면 실패. 커머스API SELLER_CODE 교차 조회와 `SAME_MODEL_REGISTERED` 경고는 P4-03이
 * 같은 항목에 더한다.
 */
export function duplicateCheck(ctx: PreValidationContext): PreValidationCheck {
  const duplicate = ctx.inputs.registrations.duplicate;
  if (!duplicate) return resultOf('DUPLICATE', []);
  const product = duplicate.originProductNo ? ` · 상품 번호 ${duplicate.originProductNo}` : '';
  return resultOf('DUPLICATE', [
    {
      message: `같은 상품·색상이 이미 등록돼 있습니다(등록 기록 #${duplicate.registrationId}${product})`,
      stepCode: null,
    },
  ]);
}
