import { rateTableVersionLabel } from '@/features/settings';
import {
  domesticPriceEntry,
  fxRecord,
  judgementSize,
  priceJudgement,
  rateTableDetail,
  rateTableSummary,
} from '@/test/fixtures/pricing';
import { DEMO_IDS, MINUTES_AGO as M, STORY, type DemoClock } from './story';
import type { Ok, Schema } from './types';

/** 고른 상품 SKU id(사이즈 → ショップA 페이지 스냅샷의 SKU, sample/sourcing과 같은 순서) */
const SKU_ID: Readonly<Record<number, number>> = { 250: 1, 255: 2, 260: 3, 265: 4, 275: 6 };

/** 세관 환율은 주마다 고시된다(지난 고시, 몇 분 전) */
const CUSTOMS_REFERENCE_AGO = 3 * 24 * 60;

/** 최신 환율 3종(원가 JPY(100) 876 · 과세 JPY(100) 876 · 과세 USD 1,358.72 — FE fixture 값) */
function fxRecords(clock: DemoClock): Schema<'FxRateRecord'>[] {
  return [
    fxRecord({
      id: 1,
      referenceAt: clock.ago(M.fxCollected),
      collectedAt: clock.ago(M.fxCollected),
    }),
    fxRecord({
      id: 2,
      rateKind: 'CUSTOMS',
      source: 'CUSTOMS_SERVICE',
      referenceAt: clock.ago(CUSTOMS_REFERENCE_AGO),
      collectedAt: clock.ago(M.fxCollected),
    }),
    fxRecord({
      id: 3,
      rateKind: 'CUSTOMS',
      currency: 'USD',
      rateValue: 1358.72,
      unit: 1,
      source: 'CUSTOMS_SERVICE',
      referenceAt: clock.ago(CUSTOMS_REFERENCE_AGO),
      collectedAt: clock.ago(M.fxCollected),
    }),
  ];
}

export function fxLatest(clock: DemoClock): Ok<'/fx-rates/latest'> {
  return { items: fxRecords(clock), warnings: [] };
}

export function fxRatePage(
  clock: DemoClock,
  query: { rateKind: string | null; currency: string | null; size: number },
): Ok<'/fx-rates'> {
  const content = fxRecords(clock)
    .filter((r) => (query.rateKind ? r.rateKind === query.rateKind : true))
    .filter((r) => (query.currency ? r.currency === query.currency : true))
    .slice(0, query.size);
  return {
    content,
    page: {
      number: 0,
      size: query.size,
      totalElements: content.length,
      totalPages: content.length > 0 ? 1 : 0,
    },
  };
}

/** 고른 상품 SKU id를 사이즈별로(위 `SKU_ID`) — 판정 사이즈 표 */
const JUDGED_SIZES = STORY.saleSizesMm;

/** 최소 판매가 P_min(모든 판매 사이즈가 같은 SKU가라 같다 — PRD §8.3 예 153,100원) */
const P_MIN_KRW = 153_100;
/** 판정 여유(설정 `costs.judgementMarginPct` 1%): P_min이 국내 기준가의 99%를 넘으면 판매 불가(`P_MIN_OVER_REF`) */
const PRICE_LIMIT_PCT = 99;

/**
 * 체험에서 받는 국내 기준가의 하한. 이보다 낮으면 실제 BE는 '판매 후보 아님'으로 여정을 제외하는데, 체험은 거기서 이어 갈 수 없어
 * (다시 작업은 따라 하기 밖) 입력 단계에서 막는다. P_min 153,100원 > 기준가 × 99% ⇔ 기준가 < 154,647원
 */
export const MIN_DOMESTIC_PRICE_KRW = Math.ceil((P_MIN_KRW * 100) / PRICE_LIMIT_PCT);

/**
 * 판매 사이즈 하나의 계산(BE `profitAt` 그대로, 설정 기본값): 상품원가 107,748원(¥12,000 × 8.76 × 1.025) · 배대지 15,000원 · 기타 3,000원
 * · 판매수수료 3% + Npay 3.63% · 모드 A 부가세. 국내 기준가 169,000원이면 판매가 167,300원 · 순이익 27,418원 · 16.4%.
 * 판매가 = max(기준가 × 99%를 100원 단위 내림, 최소 판매가).
 */
export function judgeSale(pRefKrw: number) {
  const salePriceKrw = Math.max(Math.floor((pRefKrw * PRICE_LIMIT_PCT) / 10_000) * 100, P_MIN_KRW);
  const base = salePriceKrw - 107_748 - 15_000;
  const cMktKrw = Math.round((salePriceKrw * 3) / 100) + Math.round((salePriceKrw * 363) / 10_000);
  const vatAKrw = Math.round((base - cMktKrw) / 11);
  const vatBKrw = Math.round((salePriceKrw - cMktKrw) / 11);
  const profitAKrw = base - cMktKrw - vatAKrw - 3_000;
  const profitBKrw = base - cMktKrw - vatBKrw - 3_000;
  const marginRateA = Math.round((profitAKrw / salePriceKrw) * 10_000) / 10_000;
  return { salePriceKrw, cMktKrw, vatAKrw, vatBKrw, profitAKrw, profitBKrw, marginRateA };
}

/** ③ 판정 스냅샷에 들어가는 현재 실행·입력 */
export interface JudgementInput {
  stepRunId: number;
  version: number;
  stepStatus: Schema<'StepStatus'>;
  isCurrent: boolean;
  candidateId: number;
  /** 라쿠텐 페이지를 읽은 시각(ms) */
  pageCollectedAt: number;
  domesticPriceId: number;
  pRefKrw: number;
  /** 판정을 끝낸 시각(ms) */
  judgedAt: number;
}

/** ③ 판정(PRD §8.3 예: ¥12,000 · 환율 8.76 · 국내 기준가 169,000원 → 판매가 167,300원 · 순이익 27,418원 · 16.4%) */
export function priceJudgementOf(
  clock: DemoClock,
  input: JudgementInput,
): Ok<'/candidates/{candidateId}/price-judgement'> {
  const [cost, customsJpy, customsUsd] = fxRecords(clock);
  const sale = judgeSale(input.pRefKrw);
  return priceJudgement({
    id: DEMO_IDS.priceJudgement,
    stepRunId: input.stepRunId,
    candidateId: input.candidateId,
    version: input.version,
    stepStatus: input.stepStatus,
    isCurrent: input.isCurrent,
    rakutenItemId: DEMO_IDS.rakutenItem,
    rakutenPageCollectedAt: new Date(input.pageCollectedAt).toISOString(),
    // 라쿠텐 페이지 수집 시각 + 설정 판정 유효 시간 6시간
    pageValidUntil: new Date(input.pageCollectedAt + 6 * 60 * 60_000).toISOString(),
    domesticPriceId: input.domesticPriceId,
    pRefKrw: input.pRefKrw,
    costFxRate: cost,
    customsJpyFxRate: customsJpy,
    customsUsdFxRate: customsUsd,
    forwarderRateTableId: DEMO_IDS.forwarderRateTable,
    chargeableWeightKg: 1.2,
    fwdAssumed: false,
    salePriceKrw: sale.salePriceKrw,
    judgedAt: new Date(input.judgedAt).toISOString(),
    sizes: JUDGED_SIZES.map((sizeMm, i) =>
      judgementSize({
        id: i + 1,
        sizeMm,
        rakutenSkuId: SKU_ID[sizeMm] ?? null,
        pMinKrw: P_MIN_KRW,
        sizeSalePriceKrw: sale.salePriceKrw,
        cMktKrw: sale.cMktKrw,
        vatAKrw: sale.vatAKrw,
        vatBKrw: sale.vatBKrw,
        profitAKrw: sale.profitAKrw,
        profitBKrw: sale.profitBKrw,
        marginRateA: sale.marginRateA,
      }),
    ),
  });
}

/** 판정 결과가 같은지 보는 지문(G2 구성값: 판매 사이즈와 사이즈별 판매가·옵션가 — 같은 판매가면 ③을 다시 돌려도 G2는 그대로다) */
export function judgementFingerprint(pRefKrw: number): string {
  const sale = judgeSale(pRefKrw);
  return `${STORY.itemCode}|${STORY.selectedColor}|${JUDGED_SIZES.map((mm) => `${mm}:${sale.salePriceKrw}:0`).join(',')}`;
}

/** 국내 기준가 입력 기록 한 건 */
export interface DomesticPriceRec {
  id: number;
  pRefKrw: number;
  sourceUrl: string | null;
  /** 입력한 시각(ms) */
  enteredAt: number;
}

export function domesticPriceEntryOf(
  candidateId: number,
  rec: DomesticPriceRec,
): Schema<'DomesticPriceEntry'> {
  return domesticPriceEntry({
    id: rec.id,
    candidateId,
    pRefKrw: rec.pRefKrw,
    sourceUrl: rec.sourceUrl,
    enteredAt: new Date(rec.enteredAt).toISOString(),
  });
}

/**
 * 네이버쇼핑 링크(출처 키워드 → 앵커 型番, 값이 있는 것만). 주소는 스킴 없이 둔다(소스 규칙 15 — fixture와 같다). 체험에서는 어차피
 * 열지 않는 꺼진 링크로 보인다.
 */
export function naverShoppingLinksOf(input: {
  sourceKeyword: string | null;
  anchorModelCode: string | null;
}): Ok<'/candidates/{candidateId}/naver-shopping-links'> {
  const items: Schema<'NaverShoppingLink'>[] = [];
  const keyword = input.sourceKeyword?.trim();
  if (keyword) {
    items.push({
      kind: 'SOURCE_KEYWORD',
      query: keyword,
      url: `search.shopping.naver.com/search/all?query=${encodeURIComponent(keyword)}`,
    });
  }
  const model = input.anchorModelCode?.trim();
  if (model) {
    items.push({
      kind: 'MODEL_CODE',
      query: model,
      url: `search.shopping.naver.com/search/all?query=${encodeURIComponent(model)}`,
    });
  }
  return { items };
}

/**
 * 배대지 요금표(활성 — 0.5kg 9,000원 · 1.2kg 15,000원 · 2kg 18,000원). 화면의 버전 'vYYYY-MM'은 API에 이름 칸이 없어 가져온 달(KST)로
 * 만든다(`rateTableVersionLabel`). 가져온 시각이 체험을 켠 때 기준이라 파일 이름도 같은 달로 맞춘다(fixture의 고정 이름
 * 'rate-table-v2026-09.csv'를 두면 화면 'v2026-10'과 어긋난다).
 */
export function forwarderRateTable(clock: DemoClock): Ok<'/forwarder-rate-tables/{rateTableId}'> {
  const importedAt = clock.ago(M.rateTableImported);
  return rateTableDetail({
    id: DEMO_IDS.forwarderRateTable,
    sourceFileName: `rate-table-${rateTableVersionLabel({ importedAt })}.csv`,
    importedAt,
    activatedAt: importedAt,
  });
}

export function forwarderRateTablePage(clock: DemoClock): Ok<'/forwarder-rate-tables'> {
  const detail = forwarderRateTable(clock);
  const content = [
    rateTableSummary({
      id: detail.id,
      sourceFileName: detail.sourceFileName,
      rowCount: detail.tiers.length,
      importedAt: detail.importedAt,
      activatedAt: detail.activatedAt,
    }),
  ];
  return { content, page: { number: 0, size: 20, totalElements: 1, totalPages: 1 } };
}
