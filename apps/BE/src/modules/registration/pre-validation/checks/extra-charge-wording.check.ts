import { extractDisclosureBlocks } from '../../../../common/rules/detail-html.js';
import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { detailText, findWords, quoted, resultOf, type CheckProblem } from './check-helpers.js';

/** 관부가세·배송 안내 고지 블록(구매대행 고지 — 판매가 포함·무료배송과 맞아야 한다) */
export const CHARGE_NOTICE_BLOCK_IDS = ['CUSTOMS_DUTY', 'DELIVERY'] as const;

/**
 * `EXTRA_CHARGE_WORDING`(F-AP-20, PRD §8.7 가격·배송비 표시, P4-02 규칙 9): 상품명·상세·카피에 나중에 돈을 더 받는다는 표현(설정
 * `safety.extraChargeWords` — 내장 '관부가세 별도'·'통관비 별도 청구')이 없다. 배송비가 무료(`deliveryFeeType=FREE`)이고, 관부가세
 * 포함(`customsTaxType=INCLUDED`)이며, 최종 상세에 고지의 관부가세·배송 안내(CUSTOMS_DUTY·DELIVERY 블록)가 있어 서로 맞는다.
 */
export function extraChargeWordingCheck(ctx: PreValidationContext): PreValidationCheck {
  const product = ctx.draft.requestJson.originProduct;
  const words = ctx.inputs.settings.extraChargeWords;
  const problems: CheckProblem[] = [];
  const inNameOrDetail = findWords([product.name ?? '', detailText(product.detailContent)], words);
  const inCopy = findWords(ctx.inputs.copy?.texts ?? [], words).filter(
    (word) => !inNameOrDetail.includes(word),
  );
  if (inNameOrDetail.length > 0) {
    problems.push({
      message: `추가 청구 표현이 있습니다: ${quoted(inNameOrDetail)}`,
      stepCode: 'NOTICE_HTML',
    });
  }
  if (inCopy.length > 0) {
    problems.push({
      message: `카피에 추가 청구 표현이 있습니다: ${quoted(inCopy)}`,
      stepCode: 'COPY',
    });
  }
  const fee = product.deliveryInfo?.deliveryFee?.deliveryFeeType ?? null;
  if (fee !== 'FREE') {
    problems.push({
      message: `배송비가 무료가 아닙니다(${fee ?? '정보 없음'})`,
      stepCode: null,
    });
  }
  const customs = product.detailAttribute.customsTaxType;
  if (customs !== 'INCLUDED') {
    problems.push({
      message: `관부가세가 판매가에 포함(INCLUDED)되어 있지 않습니다(${customs ?? '정보 없음'})`,
      stepCode: null,
    });
  }
  const ids = new Set(extractDisclosureBlocks(product.detailContent ?? '').map((b) => b.blockId));
  const missing = CHARGE_NOTICE_BLOCK_IDS.filter((id) => !ids.has(id));
  if (missing.length > 0) {
    problems.push({
      message: `고지의 관부가세·배송 안내가 없어 무료배송·관부가세 포함과 맞는지 확인할 수 없습니다(${missing.join(', ')})`,
      stepCode: 'NOTICE_HTML',
    });
  }
  return resultOf('EXTRA_CHARGE_WORDING', problems);
}
