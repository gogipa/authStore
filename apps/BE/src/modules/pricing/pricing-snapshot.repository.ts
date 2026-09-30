import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Decimal } from './calc/money.js';

type Db = Prisma.TransactionClient;

/** price_judgement_size 한 행(사이즈별 비용 분해·면세·P_min·판매 가능) */
export interface PriceJudgementSizeDraft {
  sizeMm: number;
  rakutenSkuId: number | null;
  skuPriceYen: number;
  cGoodsKrw: number;
  vUsd: Decimal;
  isDutyFree: boolean;
  twoPairTaxable: boolean;
  isBoundary: boolean;
  customsValueKrw: number | null;
  cTaxKrw: number;
  pMinKrw: number | null;
  optionPriceKrw: number;
  sizeSalePriceKrw: number | null;
  cMktKrw: number | null;
  vatAKrw: number | null;
  vatBKrw: number | null;
  profitAKrw: number | null;
  profitBKrw: number | null;
  marginRateA: Decimal | null;
  pointsReferencePt: number | null;
  isSellable: boolean;
  unsellableReason: 'TAXABLE' | 'P_MIN_OVER_REF' | 'MODE_B_NEGATIVE' | null;
}

/** price_judgement 머리 행(판정 스냅샷, F-PJ-21) */
export interface PriceJudgementDraft {
  skuPriceSource: 'STEP2';
  rakutenItemId: number;
  /** ② rakuten_item.collected_at 사본(F-PJ-22 — now()를 쓰지 않는다) */
  rakutenPageCollectedAt: Date;
  domesticPriceId: number;
  couponYen: number;
  shippingYen: number;
  shippingEstimated: boolean;
  costFxRateId: number;
  customsJpyFxRateId: number;
  customsUsdFxRateId: number;
  forwarderRateTableId: number | null;
  chargeableWeightKg: Decimal | null;
  cShipIntlKrw: number | null;
  cFwdKrw: number;
  fwdCouponKrw: number;
  fwdAssumed: boolean;
  dutyFreeLimitYen: number | null;
  vatMode: 'A' | 'B' | 'C';
  pricingRule: string;
  targetMarginRate: Decimal;
  minProfitKrw: number;
  params: Prisma.InputJsonObject;
  isSaleCandidate: boolean;
  sellableSizeCount: number;
  salePriceKrw: number | null;
  exclusionReason: string | null;
  sizes: PriceJudgementSizeDraft[];
}

/** ③ 실행기 산출물(StepOutcome.output). 엔진은 해석하지 않고 persist에 그대로 넘긴다 */
export interface PricingOutput {
  kind: 'PRICE_JUDGEMENT';
  judgement: PriceJudgementDraft;
}

export function isPricingOutput(value: unknown): value is PricingOutput {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { kind?: unknown }).kind === 'PRICE_JUDGEMENT' &&
    typeof (value as { judgement?: unknown }).judgement === 'object'
  );
}

/**
 * 판정 스냅샷 저장·조회(P2-05 §5 `pricing-snapshot.repository.ts`, ERD §3.4). 판정마다 `price_judgement` 1행(step_run_id
 * UNIQUE) + 재고 있는 목표 사이즈마다 `price_judgement_size` 1행. 실행이 닫히면 고칠 수 없다(price_judgement_frozen) —
 * 끝 트랜잭션(step_run이 아직 RUNNING일 때)에서만 쓴다.
 */
@Injectable()
export class PricingSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 산출물을 쓴다. 같은 실행에 이미 있으면(입력 대기를 끝내며 다시 불린 경우) 다시 쓰지 않는다 */
  async insert(tx: Db, stepRunId: number, draft: PriceJudgementDraft): Promise<number> {
    const existing = await tx.priceJudgement.findUnique({
      where: { stepRunId },
      select: { id: true },
    });
    if (existing) return existing.id;
    const { sizes, ...head } = draft;
    const row = await tx.priceJudgement.create({ data: { ...head, stepRunId } });
    if (sizes.length > 0) {
      await tx.priceJudgementSize.createMany({
        data: sizes.map((size) => ({ ...size, priceJudgementId: row.id })),
      });
    }
    return row.id;
  }

  /** 판정 스냅샷(사이즈 오름차순) + 국내 기준가 + 환율 3종 */
  findByStepRun(stepRunId: number, db: Db = this.prisma) {
    return db.priceJudgement.findUnique({
      where: { stepRunId },
      include: {
        sizes: { orderBy: { sizeMm: 'asc' } },
        domesticPrice: true,
        costFxRate: true,
        customsJpyFxRate: true,
        customsUsdFxRate: true,
      },
    });
  }

  /** 판정에 쓴 라쿠텐 페이지 수집 시각(6시간 규칙·RG-08). 판정이 없으면 null */
  async pageCollectedAt(db: Db, stepRunId: number): Promise<Date | null> {
    const row = await db.priceJudgement.findUnique({
      where: { stepRunId },
      select: { rakutenPageCollectedAt: true },
    });
    return row?.rakutenPageCollectedAt ?? null;
  }

  /**
   * 이전 버전 다시 고르기(RESTORE_VERSION): `from` 판정을 `to` 실행으로 복사한다. 수집 시각·환율·국내 기준가 참조는 그대로
   * (그 판정의 기준값). 판정이 없으면 아무것도 하지 않는다
   */
  async copy(tx: Db, fromStepRunId: number, toStepRunId: number): Promise<void> {
    const from = await tx.priceJudgement.findUnique({
      where: { stepRunId: fromStepRunId },
      include: { sizes: true },
    });
    if (!from) return;
    const exists = await tx.priceJudgement.findUnique({
      where: { stepRunId: toStepRunId },
      select: { id: true },
    });
    if (exists) return;
    const omit = ({
      id: _id,
      sizes: _sizes,
      stepRunId: _run,
      judgedAt: _at,
      ...head
    }: typeof from) => head;
    const row = await tx.priceJudgement.create({
      data: {
        ...omit(from),
        params: from.params as Prisma.InputJsonValue,
        stepRunId: toStepRunId,
      },
    });
    const sizes = from.sizes;
    if (sizes.length > 0) {
      await tx.priceJudgementSize.createMany({
        data: sizes.map(({ id: _sid, priceJudgementId: _pj, ...size }) => ({
          ...size,
          priceJudgementId: row.id,
        })),
      });
    }
  }
}
