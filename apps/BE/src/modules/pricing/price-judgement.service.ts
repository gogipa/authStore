import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { PriceJudgementDetailDto, UnjudgedStockStatus } from './dto/price-judgement.dto.js';
import { UNJUDGED_STOCK_STATUSES } from './dto/price-judgement.dto.js';
import { toFxRateRecordDto } from './fx/fx-rates.service.js';
import { PricingSnapshotRepository } from './pricing-snapshot.repository.js';

/** 판정 유효 시간 기본값(설정이 없을 때, safety.judgementValidityHours 기본) */
const DEFAULT_VALIDITY_HOURS = 6;
const MAX_ID = 2_147_483_647;

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

export function outputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '③ 판정' }),
    details: { stepCode: 'PRICING' },
  });
}

/** 쿼리(05-2 getPriceJudgement: stepRunId만) — 어기면 422 INVALID_QUERY_PARAMETER */
export function parsePriceJudgementQuery(query: Record<string, unknown>): {
  stepRunId: number | null;
} {
  for (const key of Object.keys(query)) {
    if (key !== 'stepRunId') throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  if (query.stepRunId === undefined) return { stepRunId: null };
  const raw = typeof query.stepRunId === 'string' ? query.stepRunId : '';
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > MAX_ID) {
    throw invalidQuery('stepRunId', '1 이상의 정수여야 합니다.');
  }
  return { stepRunId: Number(raw) };
}

function unjudgedOf(params: unknown): { sizeMm: number; stockStatus: UnjudgedStockStatus }[] {
  const list = (params as { unjudgedSizes?: unknown } | null)?.unjudgedSizes;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (v): v is { sizeMm: number; stockStatus: UnjudgedStockStatus } =>
        !!v &&
        typeof v === 'object' &&
        Number.isInteger((v as { sizeMm?: unknown }).sizeMm) &&
        (UNJUDGED_STOCK_STATUSES as readonly unknown[]).includes(
          (v as { stockStatus?: unknown }).stockStatus,
        ),
    )
    .map((v) => ({ sizeMm: v.sizeMm, stockStatus: v.stockStatus }));
}

/**
 * ③ 판정 결과 조회(05-2 getPriceJudgement, F-PJ-11·15~19·21·22). 현재 버전(candidate_step.current_step_run_id) 또는
 * `?stepRunId=` 버전의 `price_judgement` + `price_judgement_size` + 판정에 쓴 환율 3종·국내 기준가.
 * - 없는 후보 404 CANDIDATE_NOT_FOUND, 없는 실행 404 STEP_RUN_NOT_FOUND, 다른 후보·단계의 실행 422 INVALID_QUERY_PARAMETER,
 *   산출물 없음(실행 전·입력 대기·실패) 404 STEP_OUTPUT_NOT_FOUND(details.stepCode=PRICING)
 * - `pageValidUntil` = 판정에 쓴 라쿠텐 페이지 수집 시각 + 설정 판정 유효 시간(safety.judgementValidityHours, 6시간 초과 불가)
 * - `unjudgedSizes`(P2-05 Proposed): 판정하지 않은 목표 사이즈(② 재고 칸 품절·取り寄せ·없음). 스냅샷 params 사본에서 준다
 */
@Injectable()
export class PriceJudgementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly snapshots: PricingSnapshotRepository,
    private readonly settings: SettingsService,
  ) {}

  async get(
    candidateId: number,
    rawQuery: Record<string, unknown>,
  ): Promise<PriceJudgementDetailDto> {
    const query = parsePriceJudgementQuery(rawQuery);
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true },
    });
    if (!candidate) throw new ApiException('CANDIDATE_NOT_FOUND');
    const step = await this.prisma.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'PRICING' } },
      select: { currentStepRunId: true },
    });
    const runId = query.stepRunId ?? step?.currentStepRunId ?? null;
    if (runId === null) throw outputNotFound();
    const run = await this.prisma.stepRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiException('STEP_RUN_NOT_FOUND');
    if (run.candidateId !== candidateId || run.stepCode !== 'PRICING') {
      throw invalidQuery('stepRunId', '이 여정의 ③ 판정 실행이 아닙니다.');
    }
    const pj = await this.snapshots.findByStepRun(run.id);
    if (!pj) throw outputNotFound();
    const hours =
      this.settings.currentOrNull()?.safety.judgementValidityHours ?? DEFAULT_VALIDITY_HOURS;
    const collectedAt = pj.rakutenPageCollectedAt;
    return {
      id: pj.id,
      stepRunId: run.id,
      candidateId,
      version: run.version,
      stepStatus: run.status as PriceJudgementDetailDto['stepStatus'],
      isCurrent: step?.currentStepRunId === run.id,
      skuPriceSource: pj.skuPriceSource as PriceJudgementDetailDto['skuPriceSource'],
      rakutenItemId: pj.rakutenItemId,
      rakutenPageCollectedAt: collectedAt ? collectedAt.toISOString() : null,
      pageValidUntil: collectedAt
        ? new Date(collectedAt.getTime() + hours * 3_600_000).toISOString()
        : null,
      domesticPriceId: pj.domesticPriceId,
      pRefKrw: pj.domesticPrice.pRefKrw,
      couponYen: pj.couponYen,
      shippingYen: pj.shippingYen,
      shippingEstimated: pj.shippingEstimated,
      costFxRate: toFxRateRecordDto(pj.costFxRate),
      customsJpyFxRate: toFxRateRecordDto(pj.customsJpyFxRate),
      customsUsdFxRate: toFxRateRecordDto(pj.customsUsdFxRate),
      forwarderRateTableId: pj.forwarderRateTableId,
      chargeableWeightKg: pj.chargeableWeightKg ? pj.chargeableWeightKg.toNumber() : null,
      cShipIntlKrw: pj.cShipIntlKrw,
      cFwdKrw: pj.cFwdKrw,
      fwdCouponKrw: pj.fwdCouponKrw,
      fwdAssumed: pj.fwdAssumed,
      dutyFreeLimitYen: pj.dutyFreeLimitYen,
      vatMode: pj.vatMode as PriceJudgementDetailDto['vatMode'],
      pricingRule: pj.pricingRule as PriceJudgementDetailDto['pricingRule'],
      targetMarginRate: pj.targetMarginRate.toNumber(),
      minProfitKrw: pj.minProfitKrw,
      params: (pj.params ?? {}) as Record<string, unknown>,
      isSaleCandidate: pj.isSaleCandidate,
      sellableSizeCount: pj.sellableSizeCount,
      salePriceKrw: pj.salePriceKrw,
      exclusionReason: pj.exclusionReason,
      judgedAt: pj.judgedAt.toISOString(),
      sizes: pj.sizes.map((size) => ({
        id: size.id,
        sizeMm: size.sizeMm,
        rakutenSkuId: size.rakutenSkuId,
        skuPriceYen: size.skuPriceYen,
        cGoodsKrw: size.cGoodsKrw,
        vUsd: size.vUsd.toNumber(),
        isDutyFree: size.isDutyFree,
        twoPairTaxable: size.twoPairTaxable,
        isBoundary: size.isBoundary,
        customsValueKrw: size.customsValueKrw,
        cTaxKrw: size.cTaxKrw,
        pMinKrw: size.pMinKrw,
        optionPriceKrw: size.optionPriceKrw,
        sizeSalePriceKrw: size.sizeSalePriceKrw,
        cMktKrw: size.cMktKrw,
        vatAKrw: size.vatAKrw,
        vatBKrw: size.vatBKrw,
        profitAKrw: size.profitAKrw,
        profitBKrw: size.profitBKrw,
        marginRateA: size.marginRateA ? size.marginRateA.toNumber() : null,
        pointsReferencePt: size.pointsReferencePt,
        isSellable: size.isSellable,
        unsellableReason:
          size.unsellableReason as PriceJudgementDetailDto['sizes'][number]['unsellableReason'],
      })),
      unjudgedSizes: unjudgedOf(pj.params),
    };
  }
}
