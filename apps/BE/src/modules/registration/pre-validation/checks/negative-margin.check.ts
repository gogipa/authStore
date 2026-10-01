import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/**
 * numeric 비율 글자(`price_judgement.target_margin_rate` numeric(7,4), 예 '0.1000') → 만분율 정수(1000). 부동소수 오차 없이 비교하려고
 * 정수로 바꾼다. 읽지 못하면 null.
 */
export function rateBasisPoints(text: string): number | null {
  const match = /^\s*(\d+)(?:\.(\d+))?\s*$/.exec(text);
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(4, '0');
  if (fraction.length > 4 && /[1-9]/.test(fraction.slice(4))) return null;
  return Number(match[1]) * 10_000 + Number(fraction.slice(0, 4));
}

/**
 * `NEGATIVE_MARGIN`(F-AP-19, PRD §8.7 가격 행·§8.3 10, P4-02 규칙 10): 판정 스냅샷의 모든 판매 사이즈에서 모드 B 이익
 * `profit_b_krw ≥ 0`이고 모드 A 이익 `profit_a_krw ≥ max(target_margin_rate × size_sale_price_krw, min_profit_krw)`다. 비교는 정수
 * 만분율로 한다(m × P를 원 단위로 반올림하지 않는다 — 16,729.x < 16,730이면 실패).
 */
export function negativeMarginCheck(ctx: PreValidationContext): PreValidationCheck {
  const judgement = ctx.inputs.judgement;
  if (!judgement) {
    return resultOf('NEGATIVE_MARGIN', [
      { message: '③ 판정 결과가 없습니다', stepCode: 'PRICING' },
    ]);
  }
  const rateBp = rateBasisPoints(judgement.targetMarginRate);
  const problems: CheckProblem[] = [];
  const sellable = judgement.sizes.filter((size) => size.isSellable);
  if (sellable.length === 0) {
    problems.push({ message: '판매 사이즈가 없습니다', stepCode: 'PRICING' });
  }
  for (const size of sellable) {
    const price = size.sizeSalePriceKrw;
    const profitB = size.profitBKrw;
    const profitA = size.profitAKrw;
    if (profitB === null || profitB < 0) {
      problems.push({
        message: `${size.sizeMm}mm: 모드 B 순이익 ${profitB === null ? '없음' : `${profitB.toLocaleString('ko-KR')}원`} < 0`,
        stepCode: 'PRICING',
      });
      continue;
    }
    if (price === null || profitA === null || rateBp === null) {
      problems.push({
        message: `${size.sizeMm}mm: 판매가·순이익 값이 없습니다`,
        stepCode: 'PRICING',
      });
      continue;
    }
    const belowMargin = profitA * 10_000 < rateBp * price;
    const belowMin = profitA < judgement.minProfitKrw;
    if (belowMargin || belowMin) {
      const target = Math.max(Math.ceil((rateBp * price) / 10_000), judgement.minProfitKrw);
      problems.push({
        message: `${size.sizeMm}mm: 모드 A 순이익 ${profitA.toLocaleString('ko-KR')}원 < 목표 ${target.toLocaleString('ko-KR')}원`,
        stepCode: 'PRICING',
      });
    }
  }
  return resultOf('NEGATIVE_MARGIN', problems);
}
