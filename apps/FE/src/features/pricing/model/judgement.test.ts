import { describe, expect, it } from 'vitest';
import { judgementSize, priceJudgement } from '@/test/fixtures/pricing';
import {
  breakdownCaption,
  breakdownLines,
  confirmedValuesText,
  dutyFreeLine,
  judgedWithComparison,
  marginText,
  minimumPriceKrw,
  modeBSentence,
  parseCouponYen,
  parsePriceKrw,
  pctLabel,
  pointsSentence,
  priceRuleLabel,
  sizeTableRows,
  summarySize,
  targetMarginPct,
} from './judgement';

/** ③ 판정 화면 표시 규칙(P2-05) — fixture는 PRD §8.3 예시(¥12,000 · 8.76 · 국내 기준가 169,000 · 모드 A) */
describe('판정 요약·비용 분해(PRD §8.3 예시)', () => {
  const j = priceJudgement();

  it('요약 카드: 최소 판매가 153,100 · 목표 마진 10% · 판매가 규칙 · 기준 사이즈 순이익 27,418(16.4%)', () => {
    expect(minimumPriceKrw(j)).toBe(153100);
    expect(targetMarginPct(j)).toBe(10);
    expect(priceRuleLabel(j)).toBe('국내 기준가 −1%');
    expect(summarySize(j)?.profitAKrw).toBe(27418);
    expect(marginText(summarySize(j)?.marginRateA)).toBe('16.4%');
    expect(marginText(null)).toBe('—');
  });

  it('비용 분해 줄: 물품가 105,120(¥12,000 × 8.76) · 카드 2,628 · 배대지 15,000 가정값 · 수수료 5,019 + 6,073 · 부가세 3,042', () => {
    const lines = breakdownLines(j, summarySize(j)!, '요금표 없음 · 기본값');
    const byKey = Object.fromEntries(lines.map((l) => [l.key, l]));
    expect(byKey.goods).toMatchObject({ note: '¥12,000 × 8.76', valueKrw: 105120 });
    expect(byKey.card).toMatchObject({ note: '2.5%', valueKrw: 2628 });
    expect(byKey.forwarder).toMatchObject({ assumed: true, valueKrw: 15000 });
    expect(byKey.tax).toMatchObject({ note: '면세', valueKrw: 0 });
    expect(byKey.misc).toMatchObject({ assumed: true, valueKrw: 3000 });
    expect(byKey.saleFee).toMatchObject({ note: '3.0%', valueKrw: 5019 });
    expect(byKey.npay).toMatchObject({ note: '3.63%', valueKrw: 6073 });
    expect(byKey.vat).toMatchObject({ note: '모드 A', valueKrw: 3042 });
    // 표시용으로 나눈 줄의 합은 서버 저장 합계(C_goods·C_mkt)와 같다
    expect(byKey.goods!.valueKrw + byKey.card!.valueKrw).toBe(107748);
    expect(byKey.saleFee!.valueKrw + byKey.npay!.valueKrw).toBe(11092);
    expect(breakdownCaption(j)).toBe('판매 사이즈 5개 공통 · 1켤레');
  });

  it('쿠폰·일본 내 배송비가 있으면 물품가 캡션에 식을 풀어 쓴다', () => {
    const withCoupon = priceJudgement({ couponYen: 1000, shippingYen: 500 });
    const [goods] = breakdownLines(withCoupon, summarySize(withCoupon)!, '');
    expect(goods!.note).toBe('(¥12,000 + 일본 내 배송비 ¥500 − 쿠폰 ¥1,000) × 8.76');
    expect(goods!.valueKrw).toBe(100740);
  });

  it('모드 B 문장·포인트 문장(판정용 포인트 환산을 켜면 순이익에 넣었다고 알린다)', () => {
    expect(modeBSentence(j, summarySize(j))).toBe(
      '모드 B(총액 과세)로 다시 계산한 순이익 16,259원 · 0원 이상이라 판매 가능.',
    );
    expect(pointsSentence(summarySize(j), j)).toBe('포인트 1,090pt는 참고만 · 이익에 넣지 않음');
    expect(
      pointsSentence(summarySize(j), { params: { ...j.params, pointValueFactorForMargin: 0.5 } }),
    ).toBe('포인트 1,090pt × 0.5를 순이익(모드 A)에 넣음 · 모드 B에는 넣지 않음');
    expect(pointsSentence(null)).toBeNull();
  });

  it('G2 확정한 값: 판매 사이즈 5개 · 167,300원 단일가(옵션가가 있으면 + 옵션가)', () => {
    expect(confirmedValuesText(j)).toBe('판매 사이즈 5개 · 167,300원 단일가');
    const option = priceJudgement({
      sizes: [
        judgementSize({ sizeMm: 250 }),
        judgementSize({ id: 2, sizeMm: 255, optionPriceKrw: 2200, sizeSalePriceKrw: 169500 }),
      ],
    });
    expect(confirmedValuesText(option)).toBe('판매 사이즈 2개 · 167,300원 + 옵션가');
    expect(confirmedValuesText(priceJudgement({ salePriceKrw: null }))).toBe('판매 사이즈 없음');
  });

  it('pctLabel: 정수는 소수 한 자리, 그 밖은 그대로', () => {
    expect(pctLabel(3)).toBe('3.0%');
    expect(pctLabel(3.63)).toBe('3.63%');
  });
});

describe('사이즈별 판정 표', () => {
  it('판정 행과 판정하지 않은 목표 사이즈(품절·取り寄せ·없음)를 사이즈 순으로 합친다', () => {
    const rows = sizeTableRows(priceJudgement());
    expect(rows.map((r) => [r.sizeMm, r.stock, r.verdict])).toEqual([
      [250, '있음', '판매 가능'],
      [255, '있음', '판매 가능'],
      [260, '있음', '판매 가능'],
      [265, '있음', '판매 가능'],
      [270, '품절', '제외'],
      [275, '있음', '판매 가능'],
      [280, '取り寄せ', '제외'],
      [285, '품절', '제외'],
      [290, '없음', '제외'],
    ]);
    expect(rows.find((r) => r.sizeMm === 270)).toMatchObject({
      skuPriceYen: null,
      duty: null,
      pMinKrw: null,
    });
  });

  it('판매 불가 사유·경계 배지·옵션가', () => {
    const j = priceJudgement({
      sizes: [
        judgementSize({ sizeMm: 250, isBoundary: true, optionPriceKrw: 2200 }),
        judgementSize({
          id: 2,
          sizeMm: 255,
          isDutyFree: false,
          isBoundary: true,
          isSellable: false,
          unsellableReason: 'TAXABLE',
        }),
        judgementSize({
          id: 3,
          sizeMm: 260,
          isSellable: false,
          unsellableReason: 'P_MIN_OVER_REF',
        }),
        judgementSize({
          id: 4,
          sizeMm: 265,
          isSellable: false,
          unsellableReason: 'MODE_B_NEGATIVE',
        }),
      ],
      unjudgedSizes: [],
    });
    const rows = sizeTableRows(j);
    expect(rows.map((r) => r.verdict)).toEqual([
      '판매 가능 · 옵션 +2,200원',
      '제외 · 과세',
      '제외 · 국내 기준가 초과',
      '제외 · 모드 B 음수',
    ]);
    expect(rows[1]).toMatchObject({ duty: '과세', boundary: true, sellable: false });
    expect(modeBSentence(j, summarySize(j))).toContain('뺀 사이즈: 265mm.');
  });

  it("면세 머리 문장: '면세 한도 US$145 · 1켤레 US$77.37(¥22,490까지 면세) · 2켤레면 과세'", () => {
    expect(dutyFreeLine(priceJudgement())).toBe(
      '면세 한도 US$145 · 1켤레 US$77.37(¥22,490까지 면세) · 2켤레면 과세',
    );
    const mixed = priceJudgement({
      shippingYen: 800,
      sizes: [
        judgementSize({ vUsd: 70.1, twoPairTaxable: false }),
        judgementSize({ id: 2, sizeMm: 255, vUsd: 80.25 }),
      ],
    });
    expect(dutyFreeLine(mixed)).toBe(
      '면세 한도 US$145 · 1켤레 US$70.10~80.25(일본 내 배송비 포함 ¥22,490까지 면세) · 일부 사이즈는 2켤레면 과세',
    );
  });
});

describe('입력 칸 검사', () => {
  it('쿠폰(엔): 비우면 0, 0 이상 정수(쉼표 허용), 그 밖 null', () => {
    expect(parseCouponYen('')).toBe(0);
    expect(parseCouponYen('1,000')).toBe(1000);
    expect(parseCouponYen('-1')).toBeNull();
    expect(parseCouponYen('1.5')).toBeNull();
  });

  it('국내 기준가(원): 1 이상 정수(쉼표 허용)', () => {
    expect(parsePriceKrw('169,000')).toBe(169000);
    expect(parsePriceKrw('0')).toBeNull();
    expect(parsePriceKrw('')).toBeNull();
    expect(parsePriceKrw('abc')).toBeNull();
  });

  it('판정 사본의 비교 여부(params.sourcing.comparisonPerformed)', () => {
    expect(judgedWithComparison(priceJudgement())).toBe(true);
    expect(judgedWithComparison(priceJudgement({ params: {} }))).toBeNull();
  });
});
