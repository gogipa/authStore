import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/**
 * `DUPLICATE`(F-AP-36, RG-12, US-22 AC2 — P4-02 로컬 + P4-03 커머스API 교차): 둘 중 하나라도 있으면 실패(이 검사는 설정으로 끌 수 없다).
 * - 로컬 DB: 같은 `item_code + selected_color`의 진행 중·등록됨 등록 기록(`failed_at` 없음 — `uq_registration_live_key`와 같은 조건)
 * - 커머스API: 요청 초안의 판매자관리코드로 상품 검색(SELLER_CODE)에 상품이 있음(`ctx.sellerCode` — `DuplicateService`)
 * 조회가 실패하면(키 없음·외부·인증) 중복이 아닌지 모르므로 이 항목만 실패(사유에 원인 — §7.5-37과 같은 방식). 미리보기(`sellerCode`
 * 없음)는 로컬만 본다. 같은 모델·색상이 다른 샵으로 등록된 것은 막지 않는 경고 `SAME_MODEL_REGISTERED`(서비스가 `warnings[]`에 넣는다).
 */
export function duplicateCheck(ctx: PreValidationContext): PreValidationCheck {
  const problems: CheckProblem[] = [];
  const duplicate = ctx.inputs.registrations.duplicate;
  if (duplicate) {
    const product = duplicate.originProductNo ? ` · 상품 번호 ${duplicate.originProductNo}` : '';
    problems.push({
      message: `같은 상품·색상이 이미 등록돼 있습니다(등록 기록 #${duplicate.registrationId}${product})`,
      stepCode: null,
    });
  }
  const lookup = ctx.sellerCode ?? null;
  if (lookup && !lookup.ok) {
    problems.push({
      message: `커머스API에서 판매자관리코드로 중복을 확인하지 못했습니다(${lookup.reason})`,
      stepCode: null,
    });
  } else if (lookup?.ok && lookup.product && !duplicate) {
    problems.push({
      message: `커머스API에 같은 판매자관리코드(${ctx.draft.sellerManagementCode ?? ''}) 상품이 이미 있습니다(상품 번호 ${lookup.product.originProductNo})`,
      stepCode: null,
    });
  }
  return resultOf('DUPLICATE', problems);
}
