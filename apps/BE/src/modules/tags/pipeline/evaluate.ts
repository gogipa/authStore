import { checkRestricted } from './restricted-check.js';
import { filterTag, type TagRuleContext } from './rule-filter.js';
import { judgeTag } from './select-final.js';
import type { TagPoolEntry } from './tag-pipeline.types.js';

/**
 * 정규화한 후보 → 규칙 필터 → 1차 restricted 검증 → 판정(P3-05 규칙 8·10·13·14). 오너가 뺀 키는 OWNER_REMOVED(조회 안 함),
 * 규칙에 걸린 후보는 FILTERED(조회 안 함 — restricted=NULL), 나머지만 restricted-tags로 확인한다. 오너가 더한 태그도 같은 검사를
 * 거친다. 선정은 부르는 쪽(select-final)이 한다.
 */
export async function evaluatePool(args: {
  pool: readonly TagPoolEntry[];
  removedKeys: ReadonlySet<string>;
  ruleContext: TagRuleContext;
  batchSize: number;
  restricted: (batch: string[]) => Promise<{ tag: string; restricted: boolean }[]>;
}): Promise<{ judged: ReturnType<typeof judgeTag>[]; calls: number }> {
  const filters = new Map(
    args.pool.map((entry) => [
      entry.textKey,
      args.removedKeys.has(entry.textKey) ? null : filterTag(entry, args.ruleContext),
    ]),
  );
  const toCheck = args.pool.filter(
    (entry) => !args.removedKeys.has(entry.textKey) && filters.get(entry.textKey) === null,
  );
  const { byKey, calls } = await checkRestricted(toCheck, args.batchSize, args.restricted);
  const judged = args.pool.map((entry) =>
    judgeTag({
      entry,
      filter: filters.get(entry.textKey) ?? null,
      restricted: byKey.get(entry.textKey) ?? null,
      removed: args.removedKeys.has(entry.textKey),
    }),
  );
  return { judged, calls };
}
