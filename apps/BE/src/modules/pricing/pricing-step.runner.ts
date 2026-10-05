import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { toKstDate } from '../../common/time/kst.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import { ForwarderRateTablesService } from '../settings/forwarder-rate-tables/forwarder-rate-tables.service.js';
import { rateTableStepInput } from '../settings/forwarder-rate-tables/rate-table-input.js';
import {
  StepRunnerFor,
  type CandidateEffects,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepRunContext,
  type StepRunner,
  type StepStartContext,
  type Tx,
} from '../step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { judgePrice, type PriceJudgementResult } from './calc/price-judgement.calc.js';
import { pctRate, roundTo } from './calc/money.js';
import { pricingParamsOf, type PricingParams } from './calc/pricing-params.js';
import { fxStepInputs } from './fx/fx-step-inputs.js';
import { FxRatesService } from './fx/fx-rates.service.js';
import {
  PricingSnapshotRepository,
  isPricingOutput,
  type PriceJudgementDraft,
  type PricingOutput,
} from './pricing-snapshot.repository.js';
import {
  couponYenOf,
  judgeSizesOf,
  loadPricingSources,
  rateTableInputOf,
  type PricingSources,
} from './pricing-sources.js';

/** ③ 입력 대기 이유(Proposed): 국내 기준가 행이 없다 → POST /candidates/{id}/domestic-prices로 이어 간다 */
export const PRICING_WAITING_REASON = {
  code: 'PRICING_DOMESTIC_PRICE_REQUIRED',
  pending: [INPUT_KEYS.ownerDomesticPrice],
} as const;

type Gender = 'MALE' | 'FEMALE';

function genderOf(value: unknown): Gender | null {
  return value === 'MALE' || value === 'FEMALE' ? value : null;
}

/**
 * ③ PRICING 실행기(P2-05 §5 `pricing-step.runner.ts`, F-PJ-14·21·22, P1-05 실행기 규약). pricing 모듈 provider로
 * step-engine 레지스트리에 등록된다(`@StepRunnerFor('PRICING')`).
 * - 입력(규칙 1): ② 목표 사이즈 SKU가·재고·송료·쿠폰(`sourcing.targetSkus`, PREV_STEP — step-engine 창구로만 읽는다),
 *   후보 성별, URL 후보 쿠폰(`owner.coupon`, 시작 조건), 설정(`settings.costs`·`settings.pricing`·
 *   `settings.sourcing.minSizeCount`), 환율 3종(`fx.*`, 없으면 409 FX_RATE_UNAVAILABLE), 활성 요금표(`forwarder.rateTable`),
 *   국내 기준가(`owner.domesticPrice`, 실행 중 오너 입력 — 지문 밖)
 * - URL 후보 쿠폰(규칙 2): 실행 body `ownerInputs.couponYen`은 `prepareInputs`에서 입력 지문 **전에** pricing_coupon_input
 *   새 행으로 넣는다. 비교를 한 후보가 보내면 422 COUPON_NOT_ALLOWED
 * - 국내 기준가가 없으면 WAITING_INPUT(`owner.domesticPrice`). 있으면 최신 행으로 판정(`judgePrice`) → 스냅샷
 * - 판매 후보 아님이면 후보 효과 `exclusion: NOT_SALE_CANDIDATE`(같은 완료 트랜잭션에서 후보 EXCLUDED — step-engine이 쓴다)
 * - 판정에 쓴 라쿠텐 페이지 수집 시각은 ② `rakuten_item.collected_at` 사본(③만 다시 돌려도 새로 찍지 않는다, F-PJ-22)
 */
@StepRunnerFor('PRICING')
@Injectable()
export class PricingStepRunner implements StepRunner {
  readonly stepCode = 'PRICING' as const;
  readonly usesAi = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: StepEngineApi,
    private readonly fxRates: FxRatesService,
    private readonly rateTables: ForwarderRateTablesService,
    private readonly snapshots: PricingSnapshotRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private sources(
    db: Tx,
    input: { candidateId: number; gender: Gender | null; sourcingStepRunId: number | null },
  ): Promise<PricingSources> {
    return loadPricingSources(
      { api: this.api, fxRates: this.fxRates, rateTables: this.rateTables },
      db,
      input,
    );
  }

  /** 규칙 2: URL 후보 쿠폰을 시작 조건 행으로(입력 지문 전에). 비교를 한 후보면 422 COUPON_NOT_ALLOWED */
  async prepareInputs(ctx: StepStartContext): Promise<void> {
    const coupon = ctx.ownerInputs.couponYen;
    if (coupon === undefined || coupon === null) return;
    const sourcing = await this.api.currentCompletedRun(ctx.candidate.id, 'SOURCING', ctx.db);
    const selection = sourcing ? await this.api.readSourcingSelection(sourcing.id, ctx.db) : null;
    if (!selection || selection.comparisonPerformed) {
      throw new ApiException('COUPON_NOT_ALLOWED', {
        fieldErrors: [
          {
            field: 'ownerInputs.couponYen',
            message: '비교표가 있는 여정은 비교표 행에서 쿠폰을 넣어 주세요.',
            rejectedValue: coupon,
          },
        ],
      });
    }
    if (typeof coupon !== 'number' || !Number.isInteger(coupon) || coupon < 0) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          {
            field: 'ownerInputs.couponYen',
            message: '0 이상의 정수여야 합니다.',
            rejectedValue: coupon,
          },
        ],
      });
    }
    await ctx.db.pricingCouponInput.create({
      data: { candidateId: ctx.candidate.id, couponYen: coupon },
    });
  }

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const sourcingStepRunId = ctx.completedRunId('SOURCING');
    const gender = genderOf(ctx.candidate.gender);
    const s = await this.sources(ctx.db, {
      candidateId: ctx.candidate.id,
      gender,
      sourcingStepRunId,
    });
    const selection = s.selection;
    const targetValue =
      selection && s.targets
        ? {
            rakutenItemId: selection.rakutenItemId,
            itemCode: selection.itemCode,
            comparisonPerformed: selection.comparisonPerformed,
            shippingYen: selection.shippingYen,
            shippingSource: selection.shippingSource,
            // 비교를 한 버전의 행 쿠폰(URL 후보 쿠폰은 owner.coupon)
            rowCouponYen: selection.comparisonPerformed ? selection.couponYen : null,
            sizes: judgeSizesOf(s.targets),
          }
        : null;
    const genderInput: StepInput =
      ctx.candidate.genderSource === 'STEP2' && sourcingStepRunId !== null
        ? {
            inputKey: INPUT_KEYS.candidateGender,
            sourceType: 'PREV_STEP',
            sourceStepRunId: sourcingStepRunId,
            isStartCondition: true,
            required: true,
            value: gender,
          }
        : {
            inputKey: INPUT_KEYS.candidateGender,
            sourceType: 'OWNER_INPUT',
            isStartCondition: true,
            required: true,
            value: gender,
          };
    return [
      {
        inputKey: INPUT_KEYS.sourcingTargetSkus,
        sourceType: 'PREV_STEP',
        sourceStepRunId: sourcingStepRunId,
        isStartCondition: true,
        required: true,
        value: targetValue,
      },
      genderInput,
      {
        inputKey: INPUT_KEYS.ownerCoupon,
        sourceType: 'OWNER_INPUT',
        isStartCondition: true,
        required: false,
        // URL 후보만(비교를 한 후보는 null). 값만 해시한다 — 같은 금액을 다시 넣어도 재실행 필요가 되지 않는다
        value:
          selection && !selection.comparisonPerformed
            ? { couponYen: s.couponInput?.couponYen ?? 0 }
            : null,
      },
      {
        inputKey: INPUT_KEYS.settingsCosts,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.costs,
      },
      {
        inputKey: INPUT_KEYS.settingsPricing,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.pricing,
      },
      {
        inputKey: INPUT_KEYS.settingsMinSizeCount,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.sourcing.minSizeCount,
      },
      ...fxStepInputs(s.fx),
      rateTableStepInput(s.rateTable?.id ?? null),
      {
        inputKey: INPUT_KEYS.ownerDomesticPrice,
        sourceType: 'OWNER_INPUT',
        isStartCondition: false,
        required: false,
        // 값만 해시(Proposed): 같은 금액을 다시 넣으면 재실행 필요가 되지 않는다
        value: s.domesticPrice ? { pRefKrw: s.domesticPrice.pRefKrw } : null,
      },
    ];
  }

  async run(ctx: StepRunContext): Promise<StepOutcome> {
    const targetInput = ctx.inputs.find((i) => i.inputKey === INPUT_KEYS.sourcingTargetSkus);
    const genderInput = ctx.inputs.find((i) => i.inputKey === INPUT_KEYS.candidateGender);
    const s = await this.sources(this.prisma, {
      candidateId: ctx.candidateId,
      gender: genderOf(genderInput?.value),
      sourcingStepRunId: targetInput?.sourceStepRunId ?? null,
    });
    if (!s.domesticPrice) {
      return {
        kind: 'WAITING_INPUT',
        waitingReasonCode: PRICING_WAITING_REASON.code,
        pendingInputs: [...PRICING_WAITING_REASON.pending],
      };
    }
    if (!s.selection || !s.targets || s.sourcingStepRunId === null) {
      return {
        kind: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'SOURCING_SELECTION_REQUIRED',
        errorMessage: '② 소싱 선택과 목표 사이즈 SKU를 읽지 못했습니다. ②를 확인해 주세요.',
      };
    }
    const params = pricingParamsOf(ctx.settings);
    const fwdCouponKrw = await this.sellerlifeCouponKrw(ctx.candidateId, params);
    const result = judgePrice({
      sizes: judgeSizesOf(s.targets),
      shippingYen: s.selection.shippingYen ?? 0,
      couponYen: couponYenOf(s),
      fx: {
        costPerUnit: s.fx.cost.perUnit,
        customsJpyPerUnit: s.fx.customsJpy.perUnit,
        customsUsdPerUnit: s.fx.customsUsd.perUnit,
      },
      forwarder: rateTableInputOf(s.rateTable),
      fwdCouponKrw,
      pRefKrw: s.domesticPrice.pRefKrw,
      pointsPt: s.targets.pointsTotalPt,
      params,
    });
    const output: PricingOutput = {
      kind: 'PRICE_JUDGEMENT',
      judgement: draftOf(s, params, result),
    };
    const effects: CandidateEffects | undefined = result.isSaleCandidate
      ? undefined
      : { exclusion: 'NOT_SALE_CANDIDATE' };
    return { kind: 'COMPLETED', output, candidateEffects: effects };
  }

  /**
   * 셀러라이프 배대지 쿠폰(F-ST-05, Proposed): 켜져 있고 금액·월 한도가 0보다 크며, 이번 달(KST) 쿠폰을 적용한 판정의 다른
   * 후보 수가 한도보다 적으면 적용한다(같은 후보의 다시 판정은 한 장으로 센다). 기본(월 한도 0)은 적용하지 않는다
   */
  private async sellerlifeCouponKrw(candidateId: number, params: PricingParams): Promise<number> {
    const c = params.sellerlifeCoupon;
    if (!c.enabled || c.amountKrw <= 0 || c.monthlyLimit <= 0) return 0;
    const month = toKstDate(this.clock.now()).slice(0, 7);
    const monthStart = new Date(`${month}-01T00:00:00+09:00`);
    const used = await this.prisma.priceJudgement.findMany({
      where: {
        fwdCouponKrw: { gt: 0 },
        judgedAt: { gte: monthStart },
        stepRun: { candidateId: { not: candidateId } },
      },
      select: { stepRun: { select: { candidateId: true } } },
    });
    return sellerlifeCouponAmount(c, new Set(used.map((row) => row.stepRun.candidateId)).size);
  }

  async persist(tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void> {
    if (outcome.kind !== 'COMPLETED' || !isPricingOutput(outcome.output)) return;
    await this.snapshots.insert(tx, stepRunId, outcome.output.judgement);
  }

  async copyOutput(tx: Tx, fromStepRunId: number, toStepRunId: number): Promise<void> {
    await this.snapshots.copy(tx, fromStepRunId, toStepRunId);
  }

  judgementPageCollectedAt(db: Tx, stepRunId: number): Promise<Date | null> {
    return this.snapshots.pageCollectedAt(db, stepRunId);
  }
}

/**
 * 셀러라이프 배대지 쿠폰 적용 금액(F-ST-05, Proposed 순수 규칙): 켜져 있고 금액·월 한도가 0보다 크며, 이번 달(KST) 쿠폰을
 * 적용한 **다른** 후보 수가 한도보다 적으면 쿠폰 1장 금액, 아니면 0(기본 월 한도 0 → 적용 안 함)
 */
export function sellerlifeCouponAmount(
  coupon: PricingParams['sellerlifeCoupon'],
  usedOtherCandidates: number,
): number {
  if (!coupon.enabled || coupon.amountKrw <= 0 || coupon.monthlyLimit <= 0) return 0;
  return usedOtherCandidates < coupon.monthlyLimit ? coupon.amountKrw : 0;
}

/** 판정 결과 → price_judgement(+ 사이즈) 행. 열로 뺀 값 밖의 기준값은 params(적용 기준값 사본) */
export function draftOf(
  s: PricingSources,
  params: PricingParams,
  result: PriceJudgementResult,
): PriceJudgementDraft {
  const selection = s.selection!;
  const targets = s.targets!;
  const domestic = s.domesticPrice!;
  const judgedSizes = new Set(result.sizes.map((size) => size.sizeMm));
  const jsonParams = {
    ...params,
    // 판정에 쓴 환율 값(열은 id)과 ② 출처(F-PJ-21 '사이즈별 가격과 그 출처')
    fx: {
      costPerUnit: s.fx.cost.perUnit.toString(),
      customsJpyPerUnit: s.fx.customsJpy.perUnit.toString(),
      customsUsdPerUnit: s.fx.customsUsd.perUnit.toString(),
    },
    sourcing: {
      stepRunId: s.sourcingStepRunId,
      action: selection.action,
      comparisonPerformed: selection.comparisonPerformed,
      shippingSource: selection.shippingSource,
      gender: targets.gender,
    },
    domesticPrice: { id: domestic.id, pRefKrw: domestic.pRefKrw },
    couponInputId: s.couponInput?.id ?? null,
    dutyFreeThresholdUsd: result.dutyFreeThresholdUsd,
    forwarder: {
      activeRateTableId: s.rateTable?.id ?? null,
      fallbackReason: result.forwarder.fallbackReason,
      tierWeightMaxKg: result.forwarder.tierWeightMaxKg,
      handlingFeeKrw: result.forwarder.handlingFeeKrw,
    },
    gateRounds: result.gateRounds,
    // 판정하지 않은 목표 사이즈(② 재고 칸: 품절·取り寄せ·없음 — 화면 사이즈 표 '제외' 줄, Proposed)
    unjudgedSizes: targets.sizes
      .filter((size) => !judgedSizes.has(size.sizeMm))
      .map((size) => ({
        sizeMm: size.sizeMm,
        stockStatus: size.status === 'IN_STOCK' ? 'NONE' : size.status,
      })),
  } satisfies Record<string, unknown>;
  return {
    skuPriceSource: 'STEP2',
    rakutenItemId: selection.rakutenItemId,
    rakutenPageCollectedAt: selection.collectedAt,
    domesticPriceId: domestic.id,
    couponYen: couponYenOf(s),
    shippingYen: selection.shippingYen ?? 0,
    shippingEstimated: selection.shippingSource === 'DEFAULT_ESTIMATE',
    costFxRateId: s.fx.cost.id,
    customsJpyFxRateId: s.fx.customsJpy.id,
    customsUsdFxRateId: s.fx.customsUsd.id,
    forwarderRateTableId: result.forwarder.rateTableId,
    chargeableWeightKg: result.forwarder.chargeableWeightKg,
    cShipIntlKrw: result.forwarder.cShipIntlKrw,
    cFwdKrw: result.forwarder.cFwdKrw,
    fwdCouponKrw: result.forwarder.fwdCouponKrw,
    fwdAssumed: result.forwarder.fwdAssumed,
    dutyFreeLimitYen: result.dutyFreeLimitYen,
    vatMode: params.vatMode,
    pricingRule: result.pricingRule,
    targetMarginRate: roundTo(pctRate(params.targetMarginPct), 4),
    minProfitKrw: params.minProfitKrw,
    params: JSON.parse(JSON.stringify(jsonParams)) as Prisma.InputJsonObject,
    isSaleCandidate: result.isSaleCandidate,
    sellableSizeCount: result.sellableSizeCount,
    salePriceKrw: result.salePriceKrw,
    exclusionReason: result.exclusionReason,
    sizes: result.sizes.map((size) => ({
      sizeMm: size.sizeMm,
      rakutenSkuId: size.rakutenSkuId,
      skuPriceYen: size.skuPriceYen,
      cGoodsKrw: size.cGoodsKrw,
      vUsd: size.vUsd,
      isDutyFree: size.isDutyFree,
      twoPairTaxable: size.twoPairTaxable,
      isBoundary: size.isBoundary,
      customsValueKrw: size.customsValueKrw,
      cTaxKrw: size.cTaxKrw,
      pMinKrw: size.pMinKrw,
      optionPriceKrw: size.optionPriceKrw,
      sizeSalePriceKrw: size.sizeSalePriceKrw,
      cMktKrw: size.breakdown?.cMktKrw ?? null,
      vatAKrw: size.breakdown?.vatAKrw ?? null,
      vatBKrw: size.breakdown?.vatBKrw ?? null,
      profitAKrw: size.breakdown?.profitAKrw ?? null,
      profitBKrw: size.breakdown?.profitBKrw ?? null,
      marginRateA: size.breakdown?.marginRateA ?? null,
      pointsReferencePt: size.pointsReferencePt,
      isSellable: size.isSellable,
      unsellableReason: size.unsellableReason,
    })),
  };
}
