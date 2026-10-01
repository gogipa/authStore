import type { Prisma, TagCandidate, TagOwnerEdit } from '../../generated/prisma/client.js';
import {
  type TagDraft,
  type TagEdit,
  type TagFilterReason,
  type TagOutcome,
  type TagPoolEntry,
} from './pipeline/tag-pipeline.types.js';

type Db = Prisma.TransactionClient;

/**
 * ⑦ 산출물 저장·읽기(P3-05 — ERD §3.9 `tag_set`·`tag_candidate`·`tag_owner_edit`·`tag_set_competitor_input`). 네 표는
 * `trg_output_frozen` 대상이라 실행이 열려 있을 때(끝 트랜잭션의 `persist`) 한 번에 쓰고 고치지 않는다. 다른 버전으로는
 * 복사(이전 버전 다시 고르기)만 한다.
 */

/** 버전 하나의 산출물(실행기 결과 → persist) */
export interface TagSetDraft {
  recommendKeywords: string[];
  leafCategoryId: string | null;
  /** 1차 restricted-tags 검증 시각(ISO). 한 번도 부르지 않았으면 null */
  restrictedCheckedAt: string | null;
  aiRelevanceEnabled: boolean;
  competitorInputIds: number[];
  /** 행 순서 = 후보 순서(추천 응답 순 → 경쟁 입력 순 → 오너 추가) */
  candidates: TagDraft[];
  edits: TagEdit[];
}

export interface StoredTagSet {
  id: number;
  stepRunId: number;
  recommendKeywords: string[];
  leafCategoryId: string | null;
  restrictedCheckedAt: Date | null;
  aiRelevanceEnabled: boolean;
  createdAt: Date;
  competitorInputIds: number[];
  /** id 순 */
  candidates: TagCandidate[];
  /** 편집 순(edited_at → id) */
  edits: TagOwnerEdit[];
}

export async function insertTagSet(tx: Db, stepRunId: number, draft: TagSetDraft): Promise<number> {
  const set = await tx.tagSet.create({
    data: {
      stepRunId,
      recommendKeywords: draft.recommendKeywords,
      leafCategoryId: draft.leafCategoryId,
      restrictedCheckedAt: draft.restrictedCheckedAt ? new Date(draft.restrictedCheckedAt) : null,
      aiRelevanceEnabled: draft.aiRelevanceEnabled,
    },
  });
  if (draft.competitorInputIds.length > 0) {
    await tx.tagSetCompetitorInput.createMany({
      data: draft.competitorInputIds.map((id) => ({ tagSetId: set.id, tagCompetitorInputId: id })),
    });
  }
  // 행 순서를 지키려고 하나씩 넣는다(id 순 = 후보 순 — 추천 응답 순서를 다시 읽을 때 쓴다)
  for (const c of draft.candidates) {
    await tx.tagCandidate.create({
      data: {
        tagSetId: set.id,
        text: c.text,
        textKey: c.textKey,
        code: c.code,
        inRecommend: c.inRecommend,
        inCompetitor: c.inCompetitor,
        ownerAdded: c.ownerAdded,
        competitorBestRank: c.competitorBestRank,
        competitorFrequency: c.competitorFrequency,
        inputOrder: c.inputOrder,
        outcome: c.outcome,
        filterReason: c.filterReason,
        filterDetail: c.filterDetail,
        restricted: c.restricted,
        finalOrder: c.finalOrder,
      },
    });
  }
  if (draft.edits.length > 0) {
    await tx.tagOwnerEdit.createMany({
      data: draft.edits.map((e) => ({
        tagSetId: set.id,
        action: e.action,
        text: e.text,
        textKey: e.textKey,
        editedAt: new Date(e.editedAt),
      })),
    });
  }
  return set.id;
}

export async function readTagSet(db: Db, stepRunId: number): Promise<StoredTagSet | null> {
  const set = await db.tagSet.findUnique({ where: { stepRunId } });
  if (!set) return null;
  const [candidates, edits, links] = await Promise.all([
    db.tagCandidate.findMany({ where: { tagSetId: set.id }, orderBy: { id: 'asc' } }),
    db.tagOwnerEdit.findMany({
      where: { tagSetId: set.id },
      orderBy: [{ editedAt: 'asc' }, { id: 'asc' }],
    }),
    db.tagSetCompetitorInput.findMany({
      where: { tagSetId: set.id },
      orderBy: { tagCompetitorInputId: 'asc' },
    }),
  ]);
  return {
    id: set.id,
    stepRunId: set.stepRunId,
    recommendKeywords: set.recommendKeywords,
    leafCategoryId: set.leafCategoryId,
    restrictedCheckedAt: set.restrictedCheckedAt,
    aiRelevanceEnabled: set.aiRelevanceEnabled,
    createdAt: set.createdAt,
    competitorInputIds: links.map((link) => link.tagCompetitorInputId),
    candidates,
    edits,
  };
}

/**
 * 이 후보의 ⑦ 버전 가운데 `beforeVersion`보다 앞서고 산출물이 있는 가장 늦은 버전(다시 실행이 편집 목록을 가져올 '직전 버전' —
 * 규칙 14). 실패한 버전(산출물 없음)은 건너뛴다. 재실행 필요로 닫힌 오너 수정 버전도 산출물이 있으면 쓴다
 */
export async function latestTagSetBefore(
  db: Db,
  candidateId: number,
  beforeVersion: number,
): Promise<StoredTagSet | null> {
  const run = await db.stepRun.findFirst({
    where: {
      candidateId,
      stepCode: 'TAGS',
      version: { lt: beforeVersion },
      tagSet: { isNot: null },
    },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  return run ? readTagSet(db, run.id) : null;
}

/** 산출물 복사(이전 버전 다시 고르기 — 편집 목록·후보·읽은 경쟁 입력을 그대로, `edited_at` 유지) */
export async function copyTagSet(
  tx: Db,
  fromStepRunId: number,
  toStepRunId: number,
): Promise<boolean> {
  const from = await readTagSet(tx, fromStepRunId);
  if (!from) return false;
  await insertTagSet(tx, toStepRunId, {
    recommendKeywords: from.recommendKeywords,
    leafCategoryId: from.leafCategoryId,
    restrictedCheckedAt: from.restrictedCheckedAt?.toISOString() ?? null,
    aiRelevanceEnabled: from.aiRelevanceEnabled,
    competitorInputIds: from.competitorInputIds,
    candidates: from.candidates.map(draftOfRow),
    edits: from.edits.map(editOfRow),
  });
  return true;
}

/** 저장 행 → 판정 결과(복사용). 추천 순서는 행 순서로 다시 매긴다 */
export function draftOfRow(row: TagCandidate): TagDraft {
  return {
    text: row.text,
    textKey: row.textKey,
    code: row.code,
    inRecommend: row.inRecommend,
    inCompetitor: row.inCompetitor,
    ownerAdded: row.ownerAdded,
    competitorBestRank: row.competitorBestRank,
    competitorFrequency: row.competitorFrequency,
    inputOrder: row.inputOrder,
    recommendOrder: null,
    outcome: row.outcome as TagOutcome,
    filterReason: (row.filterReason as TagFilterReason | null) ?? null,
    filterDetail: row.filterDetail,
    restricted: row.restricted,
    finalOrder: row.finalOrder,
  };
}

export function editOfRow(row: TagOwnerEdit): TagEdit {
  return {
    action: row.action as TagEdit['action'],
    text: row.text,
    textKey: row.textKey,
    editedAt: row.editedAt.toISOString(),
  };
}

/**
 * 오너 수정 버전의 후보 바탕(Proposed): 바탕 버전 후보 가운데 추천·경쟁에서 온 것(오너 추가만인 행은 편집 목록이 다시 만든다).
 * 출처·순위·빈도·입력 순서는 그대로, 추천 순서는 추천 행의 순서로 다시 매기고 오너 추가 표시는 지운다
 */
export function poolOfStored(rows: readonly TagCandidate[]): TagPoolEntry[] {
  let recommendOrder = 0;
  return rows
    .filter((row) => row.inRecommend || row.inCompetitor)
    .map((row) => ({
      text: row.text,
      textKey: row.textKey,
      code: row.code,
      inRecommend: row.inRecommend,
      inCompetitor: row.inCompetitor,
      ownerAdded: false,
      competitorBestRank: row.competitorBestRank,
      competitorFrequency: row.competitorFrequency,
      inputOrder: row.inputOrder,
      recommendOrder: row.inRecommend ? recommendOrder++ : null,
    }));
}

/** 바탕 버전의 최종 태그 키(final_order 순) */
export function finalKeysOf(rows: readonly TagCandidate[]): string[] {
  return rows
    .filter((row) => row.outcome === 'SELECTED' && row.finalOrder !== null)
    .sort((a, b) => (a.finalOrder ?? 0) - (b.finalOrder ?? 0))
    .map((row) => row.textKey);
}
