import { normalizeTagText, TAG_TEXT_MAX, tagKeyOf } from './normalize.js';
import type { CompetitorTagRow, TagEdit, TagPoolEntry } from './tag-pipeline.types.js';

/**
 * 후보 모으기(P3-05 규칙 2·7). 순수 함수.
 * - 추천(사전) 태그: 키워드 순 → 응답 순. 키가 같은 추천이 여럿이면 처음 것의 `code`·`text`를 쓴다
 * - 경쟁 태그: 입력 순서대로(입력 `imported_at`·id 순 → `seq`). 추천과 키가 같으면 추천 행에 `in_competitor`만 켠다
 *   (추천의 text·code를 그대로 — 규칙 7). 최고 순위 = 가장 작은 `source_rank`, 빈도 = 가장 큰 `frequency`(빈도 있는 입력만,
 *   같은 태그를 여러 입력에 넣어도 두 번 세지 않는다 — Proposed), 입력 순서 = 처음 나온 순서(1부터)
 * - 오너 편집(`applyEdits`): ADD는 `owner_added`(없던 태그면 새 후보), REMOVE는 결과에서 OWNER_REMOVED로 표시할 키
 */

export interface RecommendGroup {
  keyword: string;
  tags: readonly { code: string; text: string }[];
}

function emptyEntry(text: string, textKey: string): TagPoolEntry {
  return {
    text,
    textKey,
    code: null,
    inRecommend: false,
    inCompetitor: false,
    ownerAdded: false,
    competitorBestRank: null,
    competitorFrequency: null,
    inputOrder: null,
    recommendOrder: null,
  };
}

export function buildTagPool(
  recommend: readonly RecommendGroup[],
  competitor: readonly CompetitorTagRow[],
): TagPoolEntry[] {
  const byKey = new Map<string, TagPoolEntry>();
  const order: TagPoolEntry[] = [];
  let recommendOrder = 0;
  for (const group of recommend) {
    for (const tag of group.tags) {
      const key = tagKeyOf(tag.text);
      if (key.length === 0 || key.length > TAG_TEXT_MAX || byKey.has(key)) continue;
      const entry = emptyEntry(tag.text.trim().slice(0, TAG_TEXT_MAX), key);
      entry.code = tag.code;
      entry.inRecommend = true;
      entry.recommendOrder = recommendOrder++;
      byKey.set(key, entry);
      order.push(entry);
    }
  }
  let inputOrder = 0;
  for (const row of competitor) {
    const key = tagKeyOf(row.tagText);
    if (key.length === 0 || key.length > TAG_TEXT_MAX) continue;
    let entry = byKey.get(key);
    if (!entry) {
      entry = emptyEntry(key, key);
      byKey.set(key, entry);
      order.push(entry);
    }
    if (!entry.inCompetitor) {
      entry.inCompetitor = true;
      entry.inputOrder = ++inputOrder;
    }
    if (row.sourceRank !== null && row.sourceRank >= 1) {
      entry.competitorBestRank =
        entry.competitorBestRank === null
          ? row.sourceRank
          : Math.min(entry.competitorBestRank, row.sourceRank);
    }
    if (row.frequency !== null && row.frequency >= 1) {
      entry.competitorFrequency =
        entry.competitorFrequency === null
          ? row.frequency
          : Math.max(entry.competitorFrequency, row.frequency);
    }
  }
  return order;
}

/**
 * 오너 편집을 후보에 다시 적용한다(규칙 13·14). ADD 키가 후보에 있으면 `owner_added`만 켜고(추천이면 code를 그대로 가진다),
 * 없으면 새 후보(정규화 글자)를 뒤에 붙인다. REMOVE 키는 돌려주는 `removedKeys`로 — 판정에서 OWNER_REMOVED가 된다.
 * 원래 후보 목록은 바꾸지 않는다(복사본을 돌려준다).
 */
export function applyEdits(
  pool: readonly TagPoolEntry[],
  edits: readonly TagEdit[],
): { pool: TagPoolEntry[]; removedKeys: Set<string>; addedKeys: string[] } {
  const next = pool.map((entry) => ({ ...entry }));
  const byKey = new Map(next.map((entry) => [entry.textKey, entry]));
  const removedKeys = new Set<string>();
  const addedKeys: string[] = [];
  // 편집 순(시각 → 같은 시각이면 목록 순서 — 안정 정렬)
  const sorted = [...edits].sort((a, b) => a.editedAt.localeCompare(b.editedAt));
  for (const edit of sorted) {
    if (edit.action === 'REMOVE') {
      removedKeys.add(edit.textKey);
      continue;
    }
    let entry = byKey.get(edit.textKey);
    if (!entry) {
      entry = emptyEntry(edit.text, edit.textKey);
      byKey.set(edit.textKey, entry);
      next.push(entry);
    }
    entry.ownerAdded = true;
    addedKeys.push(edit.textKey);
  }
  return { pool: next, removedKeys, addedKeys };
}

/**
 * 편집 목록에 이번 편집(add·remove)을 더한다(규칙 13). 키마다 한 줄(ux_tag_owner_edit) — 같은 동작이 이미 있으면 처음 시각을
 * 지키고(`edited_at` 유지), 반대 동작이면 이번 동작·시각으로 바꾼다. 결과는 처음 편집한 순서(같은 시각이면 뺌 → 더함).
 */
export function mergeEdits(
  previous: readonly TagEdit[],
  add: readonly string[],
  remove: readonly string[],
  now: Date,
): TagEdit[] {
  const byKey = new Map(previous.map((edit) => [edit.textKey, { ...edit }]));
  const at = now.toISOString();
  const put = (action: TagEdit['action'], raw: string) => {
    const text = normalizeTagText(raw);
    if (text.length === 0) return;
    const existing = byKey.get(text);
    if (existing && existing.action === action) return;
    byKey.delete(text);
    byKey.set(text, { action, text, textKey: text, editedAt: at });
  };
  for (const raw of remove) put('REMOVE', raw);
  for (const raw of add) put('ADD', raw);
  // 처음 편집한 순서(시각 → 같은 시각이면 넣은 순서: 이전 목록 → 이번 뺌 → 이번 더함, 안정 정렬)
  return [...byKey.values()].sort((a, b) => a.editedAt.localeCompare(b.editedAt));
}
