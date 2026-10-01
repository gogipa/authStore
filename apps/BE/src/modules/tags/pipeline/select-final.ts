import {
  FINAL_TAG_LIMIT,
  type TagDraft,
  type TagFilterReason,
  type TagOutcome,
  type TagPoolEntry,
} from './tag-pipeline.types.js';

/**
 * ⑦ 최종 태그 고르기(F-TG-11, PRD §8.6 6, P3-05 규칙 11). 순수 함수.
 *
 * 판정(`judgeTags`): OWNER_REMOVED(오너가 뺀 키) → FILTERED(규칙 필터 사유) → RESTRICTED(restricted-tags true) → 고를 수 있음.
 *
 * 다시 실행(`selectFinal`): 최대 10개.
 * - 오너가 더한 태그(편집 목록 ADD, 고를 수 있는 것)를 먼저 넣는다 — 다시 실행해도 남는다(규칙 14)
 * - 남은 자리를 선정 순서로 채운다: ① 추천과 정확히(정규화 키) 같은 경쟁 태그 → ② 나머지 경쟁 태그 → ③ 추천(사전) 태그.
 *   ①②는 빈도가 있으면 빈도 큰 순, 없으면 입력 순서, ③은 추천 응답 순. 경쟁 태그가 없으면 추천만으로 고르고 10개를 억지로
 *   채우지 않는다(US-18 AC5)
 * - 최종 순서(`final_order`): ① → ② → 오너가 더한 태그(①②가 아닌 것, 편집 순) → ③ (시안 순서: 추천·경쟁 · 경쟁 · 직접 · 추천)
 *
 * 오너 수정 버전(`selectOwnerEdit`, Proposed): 바탕 버전의 최종 태그에서 뺀 태그·이제 고를 수 없는 태그를 빼고, 더한 태그를 편집
 * 순으로 뒤에 붙인다. 순위 밖 태그로 빈자리를 채우지 않는다('하나를 지운 뒤 넣어 주세요'가 성립하게). 다시 실행하면 위 규칙으로
 * 빈자리를 채운다.
 */

export interface JudgeInput {
  entry: TagPoolEntry;
  filter: { reason: TagFilterReason; detail: string } | null;
  /** restricted-tags 결과(null = 조회 안 함) */
  restricted: boolean | null;
  removed: boolean;
}

/** 후보 하나의 판정(선정 전). 고를 수 있으면 outcome = null */
export function judgeTag(input: JudgeInput): Omit<TagDraft, 'finalOrder' | 'outcome'> & {
  outcome: TagOutcome | null;
} {
  const base = { ...input.entry, filterReason: null, filterDetail: null, restricted: null };
  if (input.removed) return { ...base, outcome: 'OWNER_REMOVED' };
  if (input.filter) {
    return {
      ...base,
      outcome: 'FILTERED',
      filterReason: input.filter.reason,
      filterDetail: input.filter.detail,
    };
  }
  if (input.restricted === true) return { ...base, outcome: 'RESTRICTED', restricted: true };
  return { ...base, outcome: null, restricted: input.restricted };
}

type Judged = ReturnType<typeof judgeTag>;

/** 경쟁 태그 순서: 빈도 큰 순(빈도 없는 것은 뒤) → 입력 순서 → 키 */
function competitorCompare(a: TagPoolEntry, b: TagPoolEntry): number {
  const fa = a.competitorFrequency ?? -1;
  const fb = b.competitorFrequency ?? -1;
  if (fa !== fb) return fb - fa;
  const oa = a.inputOrder ?? Number.MAX_SAFE_INTEGER;
  const ob = b.inputOrder ?? Number.MAX_SAFE_INTEGER;
  if (oa !== ob) return oa - ob;
  return a.textKey.localeCompare(b.textKey);
}

function recommendCompare(a: TagPoolEntry, b: TagPoolEntry): number {
  const oa = a.recommendOrder ?? Number.MAX_SAFE_INTEGER;
  const ob = b.recommendOrder ?? Number.MAX_SAFE_INTEGER;
  return oa - ob || a.textKey.localeCompare(b.textKey);
}

/** 선정 그룹(작을수록 앞): 0 추천∩경쟁, 1 경쟁, 2 오너 추가(경쟁 아님), 3 추천 */
export function selectionGroup(entry: TagPoolEntry): 0 | 1 | 2 | 3 {
  if (entry.inCompetitor && entry.inRecommend) return 0;
  if (entry.inCompetitor) return 1;
  if (entry.ownerAdded) return 2;
  return 3;
}

/** 그룹 안 순서까지 넣은 비교(최종 순서) */
export function finalOrderCompare(
  addedOrder: ReadonlyMap<string, number>,
): (a: TagPoolEntry, b: TagPoolEntry) => number {
  return (a, b) => {
    const ga = selectionGroup(a);
    const gb = selectionGroup(b);
    if (ga !== gb) return ga - gb;
    if (ga === 0 || ga === 1) return competitorCompare(a, b);
    if (ga === 2) {
      const oa = addedOrder.get(a.textKey) ?? Number.MAX_SAFE_INTEGER;
      const ob = addedOrder.get(b.textKey) ?? Number.MAX_SAFE_INTEGER;
      return oa - ob || a.textKey.localeCompare(b.textKey);
    }
    return recommendCompare(a, b);
  };
}

function finish(judged: readonly Judged[], chosen: readonly Judged[]): TagDraft[] {
  const order = new Map(chosen.map((entry, i) => [entry.textKey, i + 1]));
  return judged.map((entry) => {
    const finalOrder = order.get(entry.textKey) ?? null;
    const outcome: TagOutcome =
      entry.outcome ?? (finalOrder !== null ? 'SELECTED' : 'NOT_SELECTED');
    return { ...entry, outcome, finalOrder };
  });
}

/**
 * 다시 실행의 선정. `addedKeys` = 편집 목록 ADD 키(편집 순). 결과는 받은 순서 그대로(행 순서), `final_order`만 채운다.
 */
export function selectFinal(
  judged: readonly Judged[],
  addedKeys: readonly string[],
  limit = FINAL_TAG_LIMIT,
): TagDraft[] {
  const eligible = judged.filter((entry) => entry.outcome === null);
  const addedOrder = new Map(addedKeys.map((key, i) => [key, i]));
  const guaranteed = eligible
    .filter((entry) => entry.ownerAdded && addedOrder.has(entry.textKey))
    .sort(
      (a, b) =>
        (addedOrder.get(a.textKey) ?? 0) - (addedOrder.get(b.textKey) ?? 0) ||
        a.textKey.localeCompare(b.textKey),
    )
    .slice(0, limit);
  const taken = new Set(guaranteed.map((entry) => entry.textKey));
  const rest = eligible
    .filter((entry) => !taken.has(entry.textKey) && selectionGroup(entry) !== 2)
    .sort((a, b) => {
      const ga = selectionGroup(a);
      const gb = selectionGroup(b);
      if (ga !== gb) return ga - gb;
      return ga === 3 ? recommendCompare(a, b) : competitorCompare(a, b);
    });
  const chosen = [...guaranteed, ...rest.slice(0, Math.max(0, limit - guaranteed.length))].sort(
    finalOrderCompare(addedOrder),
  );
  return finish(judged, chosen);
}

/**
 * 오너 수정 버전의 선정. `baseFinalKeys` = 바탕 버전 최종 태그 키(final_order 순), `addedKeys` = 이번에 더한 키(편집 순).
 */
export function selectOwnerEdit(
  judged: readonly Judged[],
  baseFinalKeys: readonly string[],
  addedKeys: readonly string[],
  limit = FINAL_TAG_LIMIT,
): TagDraft[] {
  const eligible = new Map(
    judged.filter((entry) => entry.outcome === null).map((entry) => [entry.textKey, entry]),
  );
  const chosen: Judged[] = [];
  const taken = new Set<string>();
  for (const key of [...baseFinalKeys, ...addedKeys]) {
    const entry = eligible.get(key);
    if (!entry || taken.has(key) || chosen.length >= limit) continue;
    taken.add(key);
    chosen.push(entry);
  }
  return finish(judged, chosen);
}

/** 최종 태그 수(선정 결과) */
export function finalCount(drafts: readonly TagDraft[]): number {
  return drafts.filter((draft) => draft.outcome === 'SELECTED').length;
}
