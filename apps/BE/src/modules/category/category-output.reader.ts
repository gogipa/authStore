import type { Db } from '../step-engine/candidates/step-engine-tx.js';
import type {
  CategoryDecisionView,
  CategoryOutputReader,
} from '../step-engine/ports/step-output-readers.port.js';

/**
 * ④ 카테고리 결정 읽기(P4-02 Proposed — step-engine 창구 `StepEngineApi.readCategoryDecision`, C4 §3.1). 최종 승인 사전 검증
 * `CATEGORY`(F-AP-24 — 리프·성별 일치·KC 처리)와 요청 초안(`certificationTargetExcludeContent`)이 읽는다. registration은 category를
 * import하지 않는다(03-ADR-003). `category_decision` 행 그대로이고, 결정 행이 없으면 null.
 */
export async function readCategoryDecision(
  db: Db,
  categoryStepRunId: number,
): Promise<CategoryDecisionView | null> {
  const row = await db.categoryDecision.findUnique({ where: { stepRunId: categoryStepRunId } });
  if (!row) return null;
  return {
    categoryStepRunId,
    gender: row.gender,
    leafCategoryId: row.leafCategoryId,
    wholeCategoryName: row.wholeCategoryName,
    genderPathMatch: row.genderPathMatch,
    exceptionDecision: row.exceptionDecision,
    certificationExcludeContent: row.certificationExcludeContent ?? null,
    kcExemptAdultConfirmedAt: row.kcExemptAdultConfirmedAt,
    decidedAt: row.decidedAt,
  };
}

export const categoryOutputReader: CategoryOutputReader = { readDecision: readCategoryDecision };
