import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import type { TagCandidate } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import type {
  TagCandidateFilterReason,
  TagCandidateItemDto,
  TagCandidateOutcome,
  TagSetOutputDto,
  TagStepRunStatus,
} from './dto/tags.dto.js';
import { isDictionaryUnregistered, toSellerTag } from './pipeline/request-format.js';
import { readTagSet } from './tag-set.store.js';
import { tagsOutputNotFound } from './tags-run.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/** 조회 쿼리(stepRunId만) — 어기면 422 INVALID_QUERY_PARAMETER */
export function parseTagSetQuery(query: Record<string, unknown>): { stepRunId: number | null } {
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

export function toTagCandidateItem(row: TagCandidate): TagCandidateItemDto {
  return {
    id: row.id,
    text: row.text,
    textKey: row.textKey,
    code: row.code,
    inRecommend: row.inRecommend,
    inCompetitor: row.inCompetitor,
    ownerAdded: row.ownerAdded,
    competitorBestRank: row.competitorBestRank,
    competitorFrequency: row.competitorFrequency,
    inputOrder: row.inputOrder,
    outcome: row.outcome as TagCandidateOutcome,
    filterReason: (row.filterReason as TagCandidateFilterReason | null) ?? null,
    filterDetail: row.filterDetail,
    restricted: row.restricted,
    finalOrder: row.finalOrder,
    dictionaryUnregistered: isDictionaryUnregistered(row),
    score: null,
  };
}

/**
 * ⑦ 산출물 조회(05-2 `getCandidateTagSet`, F-TG-13·14, P3-05). 기본 현재 버전, `?stepRunId=`면 그 버전(이 후보의 ⑦ 실행이
 * 아니면 404 STEP_RUN_NOT_FOUND — ⑥과 같은 규칙), 실행 전·산출물 없음(실행 중·실패) 404 STEP_OUTPUT_NOT_FOUND.
 * `dictionaryUnregistered`(오너 추가 + code 없음)·`finalTags`(SELECTED를 final_order 순 — `{code, text}` 또는 `{text}`)는 계산한다.
 * `score`는 M2(점수화)부터라 null. 뺀 태그 = outcome FILTERED·RESTRICTED·OWNER_REMOVED(화면이 나눈다)
 */
@Injectable()
export class TagSetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
  ) {}

  async get(candidateId: number, rawQuery: Record<string, unknown>): Promise<TagSetOutputDto> {
    const query = parseTagSetQuery(rawQuery);
    await this.guard.findOr404(this.prisma, candidateId);
    const step = await this.prisma.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'TAGS' } },
      select: { currentStepRunId: true },
    });
    const currentId = step?.currentStepRunId ?? null;
    let runId: number;
    if (query.stepRunId !== null) {
      const found = await this.prisma.stepRun.findUnique({ where: { id: query.stepRunId } });
      if (!found || found.candidateId !== candidateId || found.stepCode !== 'TAGS') {
        throw new ApiException('STEP_RUN_NOT_FOUND', { details: { stepRunId: query.stepRunId } });
      }
      runId = found.id;
    } else {
      if (currentId === null) throw tagsOutputNotFound();
      runId = currentId;
    }
    const run = await this.prisma.stepRun.findUniqueOrThrow({ where: { id: runId } });
    const set = await readTagSet(this.prisma, run.id);
    if (!set) throw tagsOutputNotFound();
    const finalTags = set.candidates
      .filter((c): c is TagCandidate & { finalOrder: number } => c.finalOrder !== null)
      .filter((c) => c.outcome === 'SELECTED')
      .sort((a, b) => a.finalOrder - b.finalOrder)
      .map((c) => ({ ...toSellerTag(c), finalOrder: c.finalOrder }));
    return {
      stepRunId: run.id,
      candidateId,
      version: run.version,
      stepRunStatus: run.status as TagStepRunStatus,
      isCurrent: currentId === run.id,
      tagSetId: set.id,
      recommendKeywords: set.recommendKeywords,
      leafCategoryId: set.leafCategoryId,
      restrictedCheckedAt: set.restrictedCheckedAt?.toISOString() ?? null,
      aiRelevanceEnabled: set.aiRelevanceEnabled,
      createdAt: set.createdAt.toISOString(),
      competitorInputIds: set.competitorInputIds,
      candidates: set.candidates.map(toTagCandidateItem),
      finalTags,
      ownerEdits: set.edits.map((edit) => ({
        id: edit.id,
        action: edit.action as 'ADD' | 'REMOVE',
        text: edit.text,
        textKey: edit.textKey,
        editedAt: edit.editedAt.toISOString(),
        editSource: null,
      })),
    };
  }
}
