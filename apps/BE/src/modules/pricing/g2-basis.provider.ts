import { Injectable } from '@nestjs/common';
import {
  g2Basis,
  GateBasisFor,
  type GateBasis,
  type GateBasisProvider,
  type GateBlocker,
} from '../step-engine/contracts/gate-basis.js';
import type { Tx } from '../step-engine/contracts/step-runner.js';

/** 판정 스냅샷 params 중 G2가 읽는 ② 출처(pricing-step.runner.ts `draftOf`) */
interface JudgementSourcingParams {
  sourcing?: { comparisonPerformed?: unknown };
}

/**
 * G2 소싱 확정 공급자(F-PJ-20·F-CW-02, P2-05 §5 `g2-basis.provider.ts`, P1-06 게이트 규약). step-engine `GateService`가
 * 통과·목록·유효성 검사 때 부른다(`@GateBasisFor('G2')` — DiscoveryService로 모은다).
 * - 지문 구성값 = 소싱 itemCode·색상(후보 현재값) + 판매 후보 여부 + 판매 사이즈 + 사이즈별 판매가·옵션가(`g2Basis`, 사이즈
 *   오름차순 정수만). P_min·환율·원가는 넣지 않는다 — ③을 다시 돌려 이 값이 같으면 G2는 그대로 유효하다
 * - 막힌 이유: 판매 후보 아님 → NOT_SALE_CANDIDATE, 비교하지 않은 URL 후보(판정이 읽은 ② 버전이 comparison_performed=false)
 *   + `candidate.no_comparison_confirmed_at` 없음 → NO_COMPARISON_NOT_CONFIRMED
 * 그 ③ 버전에 판정 스냅샷이 없으면(입력 대기·실패) 판매 여부를 null로 둬 지문이 달라진다(무효).
 */
@GateBasisFor('G2')
@Injectable()
export class PricingG2GateBasis implements GateBasisProvider {
  readonly gate = 'G2' as const;

  private judgementOf(tx: Tx, basisStepRunId: number) {
    return tx.priceJudgement.findUnique({
      where: { stepRunId: basisStepRunId },
      include: { sizes: { where: { isSellable: true }, orderBy: { sizeMm: 'asc' } } },
    });
  }

  async basis(tx: Tx, candidateId: number, basisStepRunId: number): Promise<GateBasis> {
    const candidate = await tx.candidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { itemCode: true, selectedColor: true },
    });
    const judgement = await this.judgementOf(tx, basisStepRunId);
    if (!judgement) {
      return {
        ...g2Basis({
          itemCode: candidate.itemCode,
          selectedColor: candidate.selectedColor,
          saleCandidate: false,
          saleSizes: [],
        }),
        saleCandidate: null,
      };
    }
    return g2Basis({
      itemCode: candidate.itemCode,
      selectedColor: candidate.selectedColor,
      saleCandidate: judgement.isSaleCandidate,
      saleSizes: judgement.sizes.map((size) => ({
        sizeMm: size.sizeMm,
        salePriceKrw: size.sizeSalePriceKrw,
        optionPriceKrw: size.optionPriceKrw,
      })),
    });
  }

  async blockers(tx: Tx, candidateId: number, basisStepRunId: number): Promise<GateBlocker[]> {
    const candidate = await tx.candidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { creationPath: true, noComparisonConfirmedAt: true },
    });
    const judgement = await this.judgementOf(tx, basisStepRunId);
    const out: GateBlocker[] = [];
    if (!judgement?.isSaleCandidate) {
      out.push({
        code: 'NOT_SALE_CANDIDATE',
        ...(judgement?.exclusionReason
          ? { details: { exclusionReason: judgement.exclusionReason } }
          : {}),
      });
    }
    const params = (judgement?.params ?? {}) as JudgementSourcingParams;
    const performed = params.sourcing?.comparisonPerformed;
    const compared =
      typeof performed === 'boolean' ? performed : candidate.creationPath !== 'RAKUTEN_URL';
    if (!compared && candidate.noComparisonConfirmedAt === null) {
      out.push({ code: 'NO_COMPARISON_NOT_CONFIRMED' });
    }
    return out;
  }
}
