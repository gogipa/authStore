import type { Prisma } from '../../generated/prisma/client.js';
import type {
  SourcingSelectionReader,
  SourcingSelectionView,
} from '../step-engine/ports/sourcing-selection.port.js';

type Db = Prisma.TransactionClient;

/**
 * ② 소싱 선택 읽기(ERD `sourcing_comparison` '소싱 선택 읽기 규칙', P2-02). 순수 DB 읽기 — sourcing이 앱 시작 때
 * `StepEngineApi.registerSourcingSelectionReader`로 등록하고, ③·⑤·⑥은 step-engine을 거쳐 이것만 쓴다.
 * - 비교를 한 버전(`comparison_performed=true`): `is_selected` 행(검증 행)의 rakuten_item·대표 SKU·송료·쿠폰
 * - 비교를 하지 않은 버전(URL로 만들기·그 재조회): 머리 행의 `selected_rakuten_item_id`·송료. 쿠폰은 0(③ 입력)
 * 선택이 없으면(검색 뒤 앵커·선택 대기, 색상 선택 전) null.
 */
export async function readSourcingSelection(
  db: Db,
  sourcingStepRunId: number,
): Promise<SourcingSelectionView | null> {
  const head = await db.sourcingComparison.findUnique({
    where: { stepRunId: sourcingStepRunId },
    include: {
      selectedRakutenItem: true,
      rows: { where: { isSelected: true }, take: 1, include: { rakutenItem: true } },
    },
  });
  if (!head) return null;
  const base = {
    sourcingStepRunId,
    sourcingComparisonId: head.id,
    action: head.action as SourcingSelectionView['action'],
    comparisonPerformed: head.comparisonPerformed,
    anchorColorLabel: head.anchorColorLabel,
    anchorColorCode: head.anchorColorCode,
    adultProductConfirmedAt: head.adultProductConfirmedAt,
  };
  if (!head.comparisonPerformed) {
    const item = head.selectedRakutenItem;
    if (!item) return null;
    return {
      ...base,
      rakutenItemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemUrl: item.itemUrl,
      collectedAt: item.collectedAt,
      representativeRakutenSkuId: null,
      shippingYen: head.shippingYen,
      shippingSource: head.shippingSource,
      couponYen: 0,
    };
  }
  const row = head.rows[0];
  if (!row?.rakutenItem) return null;
  return {
    ...base,
    rakutenItemId: row.rakutenItem.id,
    itemCode: row.itemCode,
    itemName: row.itemName,
    itemUrl: row.itemUrl,
    collectedAt: row.rakutenItem.collectedAt,
    representativeRakutenSkuId: row.representativeRakutenSkuId,
    shippingYen: row.shippingYen,
    shippingSource: row.shippingSource,
    couponYen: row.couponYen,
  };
}

export const sourcingSelectionReader: SourcingSelectionReader = { read: readSourcingSelection };

/**
 * 재조회할 바탕 버전(F-SO-17): 이 후보의 ② 버전 중 소싱 선택이 있는 가장 최근 버전(완료·재실행 필요). `beforeRunId`를 주면
 * 그보다 앞 버전만 본다(재조회 실행 자신을 빼려고). 없으면 null → 409 SOURCING_SELECTION_REQUIRED.
 */
export async function latestSelectionBase(
  db: Db,
  candidateId: number,
  beforeRunId?: number,
): Promise<SourcingSelectionView | null> {
  const runs = await db.stepRun.findMany({
    where: {
      candidateId,
      stepCode: 'SOURCING',
      status: { in: ['COMPLETED', 'RERUN_REQUIRED'] },
      ...(beforeRunId !== undefined ? { id: { lt: beforeRunId } } : {}),
    },
    orderBy: { version: 'desc' },
    select: { id: true },
    take: 20,
  });
  for (const run of runs) {
    const selection = await readSourcingSelection(db, run.id);
    if (selection) return selection;
  }
  return null;
}
