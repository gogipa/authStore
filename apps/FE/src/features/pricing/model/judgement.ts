import type { components } from '@/shared/api/schema';
import { EMPTY_VALUE, formatKrw, formatYen } from '@/shared/lib/format';

export type PriceJudgementDetail = components['schemas']['PriceJudgementDetail'];
export type PriceJudgementSize = components['schemas']['PriceJudgementSizeBreakdown'];
export type PriceJudgementUnjudgedSize = components['schemas']['PriceJudgementUnjudgedSize'];
export type DomesticPriceCreateRequest = components['schemas']['DomesticPriceCreateRequest'];
export type DomesticPriceEntry = components['schemas']['DomesticPriceEntry'];
export type DomesticPriceCreated = components['schemas']['DomesticPriceCreated'];
export type DomesticPricePage = components['schemas']['DomesticPricePage'];
export type NaverShoppingLink = components['schemas']['NaverShoppingLink'];

/**
 * ③ 판정 화면(SCR-04) 표시 규칙(P2-05). 계산은 서버가 한다(`judgePrice`) — 여기서는 스냅샷 값을 보드 문구로 바꾼다.
 * 비용 분해의 '물품가'·'카드 가산'·'판매수수료'·'Npay 수수료' 줄은 저장 열이 합계(C_goods·C_mkt)뿐이라 표시용으로 나눈다
 * (합은 서버 값과 늘 같다 — 나머지 한 줄이 차이를 가진다, Proposed).
 */

/** params 읽기(서버 `price_judgement.params` — 설정 퍼센트 수와 판정 입력 사본) */
function num(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function nested(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** 퍼센트 표기(3 → '3.0%', 3.63 → '3.63%', 2.5 → '2.5%'). 보드 '판매수수료 3.0%' */
export function pctLabel(pct: number): string {
  const text = Number.isInteger(pct) ? pct.toFixed(1) : String(pct);
  return `${text}%`;
}

/** ② 판정에 쓴 버전이 비교를 한 버전인가(params.sourcing.comparisonPerformed) */
export function judgedWithComparison(j: PriceJudgementDetail): boolean | null {
  const v = nested(j.params, 'sourcing').comparisonPerformed;
  return typeof v === 'boolean' ? v : null;
}

export function sellableSizes(j: PriceJudgementDetail): PriceJudgementSize[] {
  return j.sizes.filter((s) => s.isSellable);
}

/** 요약 '최소 판매가': 판매 가능 사이즈 P_min 중 가장 큰 값(판매가의 하한). 판매 가능이 없으면 전체 중 가장 큰 값 */
export function minimumPriceKrw(j: PriceJudgementDetail): number | null {
  const pick = (sizes: PriceJudgementSize[]) =>
    sizes.map((s) => s.pMinKrw).filter((v): v is number => typeof v === 'number');
  const sellable = pick(sellableSizes(j));
  const values = sellable.length > 0 ? sellable : pick(j.sizes);
  return values.length > 0 ? Math.max(...values) : null;
}

/** 요약·비용 분해의 기준 사이즈: 판매 가능 사이즈 중 순이익(모드 A)이 가장 낮은 사이즈(보수적). 없으면 null */
export function summarySize(j: PriceJudgementDetail): PriceJudgementSize | null {
  let found: PriceJudgementSize | null = null;
  for (const s of sellableSizes(j)) {
    if (typeof s.profitAKrw !== 'number') continue;
    if (!found || s.profitAKrw < (found.profitAKrw ?? Infinity)) found = s;
  }
  return found;
}

/** 판매 사이즈가 모두 같은 값인가(보드 '판매 사이즈 5개 공통') */
export function breakdownIsCommon(j: PriceJudgementDetail): boolean {
  const sizes = sellableSizes(j);
  if (sizes.length === 0) return false;
  const [first] = sizes;
  return sizes.every(
    (s) =>
      s.cGoodsKrw === first!.cGoodsKrw &&
      s.cTaxKrw === first!.cTaxKrw &&
      s.sizeSalePriceKrw === first!.sizeSalePriceKrw,
  );
}

/** 비용 분해 머리 캡션 */
export function breakdownCaption(j: PriceJudgementDetail): string {
  const size = summarySize(j);
  if (!size) return '판매 가능 사이즈 없음';
  return breakdownIsCommon(j)
    ? `판매 사이즈 ${sellableSizes(j).length}개 공통 · 1켤레`
    : `${size.sizeMm}mm 기준(순이익이 가장 낮은 사이즈) · 1켤레`;
}

/** 목표 마진 퍼센트(0.1 → 10) */
export function targetMarginPct(j: PriceJudgementDetail): number {
  return Math.round(j.targetMarginRate * 10000) / 100;
}

/** 요약 '판매가 · 국내 기준가 −1%' 등(가격 책정 규칙) */
export function priceRuleLabel(j: Pick<PriceJudgementDetail, 'pricingRule' | 'params'>): string {
  switch (j.pricingRule) {
    case 'REF_MINUS_1PCT':
      return `국내 기준가 −${num(j.params, 'refDiscountPct') ?? 1}%`;
    case 'REF_MINUS_100':
      return '국내 기준가 −100원';
    case 'MAX_SKU_SINGLE':
      return '가장 비싼 사이즈 기준';
    case 'OPTION_PRICE':
      return '최소가 + 옵션가';
  }
}

/** 면세 판정 기준(달러) = 한도 − 버퍼 */
export function dutyFreeThresholdUsd(j: PriceJudgementDetail): number {
  return (
    num(j.params, 'dutyFreeThresholdUsd') ??
    (num(j.params, 'dutyFreeLimitUsd') ?? 150) - (num(j.params, 'dutyFreeBufferUsd') ?? 5)
  );
}

const usd = (v: number) =>
  `US$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usdLimit = (v: number) => `US$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** 사이즈 표 머리 문장(보드 '면세 한도 US$145 · 1켤레 US$77.37(¥22,490까지 면세) · 2켤레면 과세') */
export function dutyFreeLine(j: PriceJudgementDetail): string {
  const parts = [`면세 한도 ${usdLimit(dutyFreeThresholdUsd(j))}`];
  if (j.sizes.length > 0) {
    const values = j.sizes.map((s) => s.vUsd);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const amount = min === max ? usd(min) : `${usd(min)}~${usd(max).replace('US$', '')}`;
    const limitYen = j.dutyFreeLimitYen ?? null;
    const limit =
      limitYen !== null
        ? `(${j.shippingYen > 0 ? '일본 내 배송비 포함 ' : ''}${formatYen(limitYen)}까지 면세)`
        : '';
    parts.push(`1켤레 ${amount}${limit}`);
    const two = j.sizes.filter((s) => s.twoPairTaxable).length;
    parts.push(
      two === j.sizes.length
        ? '2켤레면 과세'
        : two === 0
          ? '2켤레도 면세'
          : '일부 사이즈는 2켤레면 과세',
    );
  }
  return parts.join(' · ');
}

export type StockLabel = '있음' | '품절' | '取り寄せ' | '없음';

const STOCK_LABEL: Record<PriceJudgementUnjudgedSize['stockStatus'], StockLabel> = {
  SOLD_OUT: '품절',
  BACK_ORDER: '取り寄せ',
  NONE: '없음',
};

const UNSELLABLE_TEXT: Record<NonNullable<PriceJudgementSize['unsellableReason']>, string> = {
  TAXABLE: '제외 · 과세',
  P_MIN_OVER_REF: '제외 · 국내 기준가 초과',
  MODE_B_NEGATIVE: '제외 · 모드 B 음수',
};

/** 사이즈 표 한 줄(판정 사이즈 + 판정하지 않은 목표 사이즈) */
export interface SizeTableRow {
  sizeMm: number;
  stock: StockLabel;
  skuPriceYen: number | null;
  /** '면세'·'과세'. 판정하지 않은 사이즈는 null */
  duty: '면세' | '과세' | null;
  boundary: boolean;
  pMinKrw: number | null;
  verdict: string;
  sellable: boolean;
}

export function sizeTableRows(j: PriceJudgementDetail): SizeTableRow[] {
  const rows: SizeTableRow[] = j.sizes.map((s) => ({
    sizeMm: s.sizeMm,
    stock: '있음',
    skuPriceYen: s.skuPriceYen,
    duty: s.isDutyFree ? '면세' : '과세',
    boundary: s.isBoundary,
    pMinKrw: s.pMinKrw ?? null,
    verdict: s.isSellable
      ? s.optionPriceKrw > 0
        ? `판매 가능 · 옵션 +${formatKrw(s.optionPriceKrw)}`
        : '판매 가능'
      : s.unsellableReason
        ? UNSELLABLE_TEXT[s.unsellableReason]
        : '제외',
    sellable: s.isSellable,
  }));
  for (const u of j.unjudgedSizes) {
    rows.push({
      sizeMm: u.sizeMm,
      stock: STOCK_LABEL[u.stockStatus],
      skuPriceYen: null,
      duty: null,
      boundary: false,
      pMinKrw: null,
      verdict: '제외',
      sellable: false,
    });
  }
  return rows.sort((a, b) => a.sizeMm - b.sizeMm);
}

/** 계산용 원가 환율(원/엔) = rateValue / unit */
export function costPerUnit(j: Pick<PriceJudgementDetail, 'costFxRate'>): number {
  return j.costFxRate.rateValue / j.costFxRate.unit;
}

/** 원가 환율 표기(8.76) */
export function rateText(value: number): string {
  return value.toLocaleString('ko-KR', { maximumFractionDigits: 4 });
}

export interface BreakdownLine {
  key: string;
  label: string;
  /** 줄 옆 캡션(예 '¥12,000 × 8.76') */
  note: string | null;
  /** '가정값' 칩 */
  assumed: boolean;
  valueKrw: number;
}

/**
 * 비용 분해 줄(보드: 물품가 · 카드 가산 · 배대지 · 관부가세 · 기타비용 · 판매수수료 · Npay 수수료 · 부가세 모드 A).
 * `forwarderNote`는 화면이 요금표 버전으로 만든다(예 '요금표 v2026-09 · 1.2kg').
 */
export function breakdownLines(
  j: PriceJudgementDetail,
  size: PriceJudgementSize,
  forwarderNote: string,
): BreakdownLine[] {
  const rate = costPerUnit(j);
  const goodsYen = Math.max(0, size.skuPriceYen + j.shippingYen - j.couponYen);
  const goodsBase = Math.round(goodsYen * rate);
  const card = size.cGoodsKrw - goodsBase;
  const salePrice = size.sizeSalePriceKrw ?? 0;
  const saleFeePct = num(j.params, 'saleFeePct') ?? 0;
  const npayPct = num(j.params, 'npayFeePct') ?? 0;
  const saleFee = Math.round((salePrice * Math.round(saleFeePct * 1000)) / 100000);
  const cMkt = size.cMktKrw ?? 0;
  const vat = j.vatMode === 'A' ? (size.vatAKrw ?? 0) : j.vatMode === 'B' ? (size.vatBKrw ?? 0) : 0;
  const goodsNote = [
    formatYen(size.skuPriceYen),
    j.shippingYen > 0 ? ` + 일본 내 배송비 ${formatYen(j.shippingYen)}` : '',
    j.couponYen > 0 ? ` − 쿠폰 ${formatYen(j.couponYen)}` : '',
  ].join('');
  return [
    {
      key: 'goods',
      label: '물품가',
      note: `${j.shippingYen > 0 || j.couponYen > 0 ? `(${goodsNote})` : goodsNote} × ${rateText(rate)}`,
      assumed: false,
      valueKrw: goodsBase,
    },
    {
      key: 'card',
      label: '카드 가산',
      note: pctLabel(num(j.params, 'cardSurchargePct') ?? 0).replace('.0%', '%'),
      assumed: false,
      valueKrw: card,
    },
    {
      key: 'forwarder',
      label: '배대지',
      note: forwarderNote,
      assumed: j.fwdAssumed,
      valueKrw: j.cFwdKrw,
    },
    {
      key: 'tax',
      label: '관부가세',
      note: size.isDutyFree ? '면세' : '과세 예상액',
      assumed: false,
      valueKrw: size.cTaxKrw,
    },
    {
      key: 'misc',
      label: '기타비용',
      note: null,
      assumed: true,
      valueKrw: num(j.params, 'miscCostKrw') ?? 0,
    },
    {
      key: 'saleFee',
      label: '판매수수료',
      note: pctLabel(saleFeePct),
      assumed: false,
      valueKrw: saleFee,
    },
    {
      key: 'npay',
      label: 'Npay 수수료',
      note: pctLabel(npayPct),
      assumed: false,
      valueKrw: cMkt - saleFee,
    },
    { key: 'vat', label: '부가세', note: `모드 ${j.vatMode}`, assumed: false, valueKrw: vat },
  ];
}

/** 마진율 표기(0.1639 → '16.4%') */
export function marginText(rate: number | null | undefined): string {
  if (rate === null || rate === undefined) return EMPTY_VALUE;
  return `${(Math.round(rate * 1000) / 10).toFixed(1)}%`;
}

/** 보드 '모드 B(총액 과세)로 다시 계산한 순이익 16,259원 · 0원 이상이라 판매 가능.' */
export function modeBSentence(j: PriceJudgementDetail, size: PriceJudgementSize | null): string {
  const excluded = j.sizes.filter((s) => s.unsellableReason === 'MODE_B_NEGATIVE');
  const dropped =
    excluded.length > 0
      ? ` 모드 B 순이익이 0원보다 적어 뺀 사이즈: ${excluded.map((s) => `${s.sizeMm}mm`).join(', ')}.`
      : '';
  const profitB = size?.profitBKrw ?? null;
  if (profitB === null) return `모드 B(총액 과세) 순이익을 계산할 판매가가 없습니다.${dropped}`;
  const verdict = profitB >= 0 ? '0원 이상이라 판매 가능.' : '0원보다 적어 판매 불가.';
  return `모드 B(총액 과세)로 다시 계산한 순이익 ${formatKrw(profitB)} · ${verdict}${dropped}`;
}

/**
 * 보드 '포인트 1,090pt는 참고만 · 이익에 넣지 않음'. 판정용 포인트 환산(설정 `costs.pointValueFactorForMargin`, 기본 0)을
 * 켜 두었으면 모드 A 순이익에 그만큼 들어가 있어 그렇게 알린다(모드 B 게이트에는 넣지 않는다)
 */
export function pointsSentence(
  size: PriceJudgementSize | null,
  judgement?: Pick<PriceJudgementDetail, 'params'>,
): string | null {
  const points = size?.pointsReferencePt ?? null;
  if (points === null) return null;
  const factor = judgement ? (num(judgement.params, 'pointValueFactorForMargin') ?? 0) : 0;
  const text = `포인트 ${points.toLocaleString('ko-KR')}pt`;
  return factor > 0
    ? `${text} × ${factor}를 순이익(모드 A)에 넣음 · 모드 B에는 넣지 않음`
    : `${text}는 참고만 · 이익에 넣지 않음`;
}

/** G2 '확정한 값: 판매 사이즈 5개 · 167,300원 단일가' */
export function confirmedValuesText(j: PriceJudgementDetail): string {
  const sizes = sellableSizes(j);
  const salePrice = j.salePriceKrw ?? null;
  if (salePrice === null || sizes.length === 0) return '판매 사이즈 없음';
  const options = sizes.some((s) => s.optionPriceKrw > 0);
  return `판매 사이즈 ${sizes.length}개 · ${formatKrw(salePrice)} ${options ? '+ 옵션가' : '단일가'}`;
}

/** 쿠폰 입력 값(엔) 검사: 비우면 0, 0 이상 정수만 */
export function parseCouponYen(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (cleaned === '') return 0;
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** 국내 기준가 입력 값(원) 검사: 1 이상 정수(쉼표 허용). 아니면 null */
export function parsePriceKrw(text: string): number | null {
  const cleaned = text.replace(/[,\s]/g, '');
  if (!/^\d{1,10}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return value >= 1 && value <= 2_147_483_647 ? value : null;
}
