import type {
  PricingOutputReader,
  PricingSaleSizesView,
} from '../step-engine/ports/step-output-readers.port.js';
import type { Db } from '../step-engine/candidates/step-engine-tx.js';

/**
 * ③ 판정 읽기(P3-04 Proposed — step-engine 창구 `StepEngineApi.readPricingSaleSizes`, C4 §3.1). ⑥-3이 판매 사이즈(시작 조건
 * '③ 판매 사이즈 집합')를 읽는다. 판매 사이즈 = 그 판정의 `price_judgement_size.is_sellable` 사이즈(mm 오름차순). 판정가는
 * PR-07(모드 A 판매가 구성)을 켤 때만 읽는데 M1은 켜는 설정이 없어 넣지 않는다.
 */
export async function readPricingSaleSizes(
  db: Db,
  pricingStepRunId: number,
): Promise<PricingSaleSizesView | null> {
  const row = await db.priceJudgement.findUnique({
    where: { stepRunId: pricingStepRunId },
    select: {
      sizes: { where: { isSellable: true }, select: { sizeMm: true }, orderBy: { sizeMm: 'asc' } },
    },
  });
  if (!row) return null;
  return { pricingStepRunId, saleSizesMm: row.sizes.map((size) => size.sizeMm) };
}

export const pricingOutputReader: PricingOutputReader = { readSaleSizes: readPricingSaleSizes };
