import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { detailText, findWords, quoted, resultOf } from './check-helpers.js';

/** 판매국(일본)의 한국어 나라 이름(⑥-2 원산지 사전 `content.originCountries` 마지막 조각) */
export const SELLER_COUNTRY_NAME = '일본';

/**
 * `JAPAN_WORDING`(F-AP-17, PRD §8.5 판매국·제조국 혼동 [Must], P4-02 규칙 9): 제조국이 일본이 아니면 상품명·`detailContent`에
 * 혼동 표현(설정 `safety.originConfusionWords` — 내장 '일본 제품'·'일본산')이 없다. 제조국을 모르면(⑥-2 원산지 없음) 일본이 아닌
 * 것으로 보고 검사한다(막는 쪽). 일치 방식은 `findWords`(NFKC·소문자·공백 무시 부분 일치).
 */
export function japanWordingCheck(ctx: PreValidationContext): PreValidationCheck {
  const countries = ctx.inputs.facts?.origin?.countries ?? [];
  if (countries.length > 0 && countries.every((country) => country === SELLER_COUNTRY_NAME)) {
    return resultOf('JAPAN_WORDING', []);
  }
  const product = ctx.draft.requestJson.originProduct;
  const found = findWords(
    [product.name ?? '', detailText(product.detailContent)],
    ctx.inputs.settings.originConfusionWords,
  );
  if (found.length === 0) return resultOf('JAPAN_WORDING', []);
  const where =
    countries.length > 0 ? `제조국이 ${countries.join('·')}인데` : '제조국이 일본이 아닌데';
  return resultOf('JAPAN_WORDING', [
    {
      message: `${where} 상품명·상세에 ${quoted(found)} 표현이 있습니다`,
      stepCode: 'NOTICE_HTML',
    },
  ]);
}
