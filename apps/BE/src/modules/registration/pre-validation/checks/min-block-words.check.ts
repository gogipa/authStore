import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { detailText, findWords, quoted, resultOf } from './check-helpers.js';

/**
 * `MIN_BLOCK_WORDS`(F-AP-18, D-11·②-11, P4-02 규칙 9): 상품명·상세에 최소 차단어(설정 `safety.minBlockWords` — 내장 '반품 불가'·
 * '환불 불가'·'최저가'·'공식'·'정품 100%')가 없다. 부분 일치라 '비공식'도 걸린다(Proposed — 막는 쪽). 전체 문구 린터(CT-05)는 M2.
 */
export function minBlockWordsCheck(ctx: PreValidationContext): PreValidationCheck {
  const product = ctx.draft.requestJson.originProduct;
  const found = findWords(
    [product.name ?? '', detailText(product.detailContent)],
    ctx.inputs.settings.minBlockWords,
  );
  return resultOf(
    'MIN_BLOCK_WORDS',
    found.length > 0
      ? [{ message: `최소 차단어가 있습니다: ${quoted(found)}`, stepCode: 'NOTICE_HTML' }]
      : [],
  );
}
