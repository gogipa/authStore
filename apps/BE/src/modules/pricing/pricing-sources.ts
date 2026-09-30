import type { DomesticPrice, Prisma } from '../../generated/prisma/client.js';
import type { ActiveRateTable } from '../settings/forwarder-rate-tables/forwarder-rate-tables.service.js';
import type {
  SourcingSelectionView,
  SourcingTargetSkus,
} from '../step-engine/ports/sourcing-selection.port.js';
import type { StepEngineApi } from '../step-engine/step-engine.api.js';
import type { FxRatesForJudgement, FxRatesService } from './fx/fx-rates.service.js';
import type { ForwarderRateTablesService } from '../settings/forwarder-rate-tables/forwarder-rate-tables.service.js';
import type { JudgeSizeInput } from './calc/price-judgement.calc.js';
import type { RateTableInput } from './calc/chargeable-weight.js';

type Db = Prisma.TransactionClient;

/**
 * ③ 판정이 읽는 원천(P2-05 규칙 1·2): ② 소싱 선택·목표 사이즈 SKU(step-engine 창구로만 — sourcing을 import하지 않는다),
 * 환율 3종(P2-04 `getLatestForJudgement` — 없으면 409 FX_RATE_UNAVAILABLE), 활성 요금표, URL 후보 쿠폰 최신 행,
 * 국내 기준가 최신 행. 실행기 `readInputs`(값 해시)와 `run`(계산·스냅샷)이 같은 함수로 읽는다.
 */
export interface PricingSources {
  sourcingStepRunId: number | null;
  selection: SourcingSelectionView | null;
  targets: SourcingTargetSkus | null;
  fx: FxRatesForJudgement;
  rateTable: ActiveRateTable | null;
  /** URL 후보(비교하지 않은 버전) 쿠폰 입력 최신 행. 비교한 후보·입력 없음이면 null */
  couponInput: { id: number; couponYen: number } | null;
  /** 국내 기준가 최신 행(없으면 입력 대기) */
  domesticPrice: DomesticPrice | null;
}

export interface PricingSourceDeps {
  api: StepEngineApi;
  fxRates: FxRatesService;
  rateTables: ForwarderRateTablesService;
}

/** URL 후보 쿠폰 최신 행(pricing_coupon_input, (candidate_id, entered_at DESC)) */
export function latestCouponInput(db: Db, candidateId: number) {
  return db.pricingCouponInput.findFirst({
    where: { candidateId },
    orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
    select: { id: true, couponYen: true },
  });
}

/** 국내 기준가 최신 행 */
export function latestDomesticPrice(db: Db, candidateId: number): Promise<DomesticPrice | null> {
  return db.domesticPrice.findFirst({
    where: { candidateId },
    orderBy: [{ enteredAt: 'desc' }, { id: 'desc' }],
  });
}

export async function loadPricingSources(
  deps: PricingSourceDeps,
  db: Db,
  input: {
    candidateId: number;
    gender: 'MALE' | 'FEMALE' | null;
    sourcingStepRunId: number | null;
  },
): Promise<PricingSources> {
  const { sourcingStepRunId } = input;
  const selection =
    sourcingStepRunId !== null ? await deps.api.readSourcingSelection(sourcingStepRunId, db) : null;
  const targets =
    selection && sourcingStepRunId !== null && input.gender
      ? await deps.api.readSourcingTargetSkus(sourcingStepRunId, input.gender, db)
      : null;
  const fx = await deps.fxRates.getLatestForJudgement(db);
  const rateTable = await deps.rateTables.activeForJudgement(db);
  const couponInput =
    selection && !selection.comparisonPerformed
      ? await latestCouponInput(db, input.candidateId)
      : null;
  const domesticPrice = await latestDomesticPrice(db, input.candidateId);
  return { sourcingStepRunId, selection, targets, fx, rateTable, couponInput, domesticPrice };
}

/** 판정 대상 = 재고 있는 목표 사이즈(가격을 아는 SKU) */
export function judgeSizesOf(targets: SourcingTargetSkus | null): JudgeSizeInput[] {
  if (!targets) return [];
  return targets.sizes
    .filter((s) => s.status === 'IN_STOCK' && s.taxIncludedPriceYen !== null)
    .map((s) => ({
      sizeMm: s.sizeMm,
      rakutenSkuId: s.rakutenSkuId,
      skuPriceYen: s.taxIncludedPriceYen!,
    }));
}

/** 쿠폰(엔): 비교를 한 버전은 ② 고른 행 값, URL 후보는 쿠폰 입력 최신 행(없으면 0) */
export function couponYenOf(sources: Pick<PricingSources, 'selection' | 'couponInput'>): number {
  if (!sources.selection) return 0;
  return sources.selection.comparisonPerformed
    ? sources.selection.couponYen
    : (sources.couponInput?.couponYen ?? 0);
}

/** 활성 요금표 → 계산 입력(무게는 number) */
export function rateTableInputOf(table: ActiveRateTable | null): RateTableInput | null {
  if (!table) return null;
  return {
    id: table.id,
    tiers: table.tiers.map((tier) => ({
      weightMaxKg: tier.weightMaxKg.toNumber(),
      fee: tier.fee,
      currency: tier.currency,
      volumetricDivisor: tier.volumetricDivisor,
      volumetricAppliesWhen: tier.volumetricAppliesWhen,
    })),
  };
}
