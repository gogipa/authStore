import type {
  Candidate,
  CandidateStatusHistory,
  CandidateStep,
  StepChain,
} from '../../../generated/prisma/client.js';
import { resumeStepCode } from '../domain/resume.js';
import {
  isLockedStatus,
  STEP_FLOW,
  toStepStatusMap,
  type CandidateExcludedReason,
  type CandidateStatus,
  type CandidateStatusReason,
  type StepCode,
} from '../domain/steps.js';
import type { CandidateWarning } from '../domain/warnings.js';
import type { CreationPath } from '../dto/candidate-request.dto.js';
import type {
  CandidateDetailDto,
  CandidateStatusChangeResultDto,
  CandidateStatusHistoryItemDto,
  CandidateStepBriefDto,
  CandidateSummaryDto,
  ContinuousRunSummaryDto,
} from '../dto/candidate-response.dto.js';
import type { CandidateGateValidity } from '../ports/gate-validity.port.js';
import type { Db } from './step-engine-tx.js';

/**
 * 후보 읽기 모델: 표시명·페이지 데이터(② 선택 상품)와 응답 매핑. step-engine이 ② 산출물(sourcing_comparison·
 * rakuten_item)을 읽기만 한다(단계 모듈끼리는 서로 부르지 않고 step-engine을 거친다, 03-ADR-003).
 */

/** ② 버전 하나의 소싱 선택 상품 */
export interface SourcingSelection {
  stepRunId: number;
  itemName: string;
  /** 선택 상품 페이지를 받은 시각(rakuten_item.collected_at). 비교표 행에 스냅샷이 아직 없으면 null */
  collectedAt: Date | null;
}

const SELECTION_SELECT = {
  id: true,
  candidateId: true,
  sourcingComparison: {
    select: {
      selectedRakutenItem: { select: { itemName: true, collectedAt: true } },
      rows: {
        where: { isSelected: true },
        take: 1,
        select: { itemName: true, rakutenItem: { select: { collectedAt: true } } },
      },
    },
  },
} as const;

type SelectionRow = {
  id: number;
  candidateId: number;
  sourcingComparison: {
    selectedRakutenItem: { itemName: string; collectedAt: Date } | null;
    rows: { itemName: string; rakutenItem: { collectedAt: Date } | null }[];
  } | null;
};

function toSelection(row: SelectionRow): SourcingSelection | null {
  const comparison = row.sourcingComparison;
  if (!comparison) return null;
  if (comparison.selectedRakutenItem) {
    return {
      stepRunId: row.id,
      itemName: comparison.selectedRakutenItem.itemName,
      collectedAt: comparison.selectedRakutenItem.collectedAt,
    };
  }
  const selected = comparison.rows[0];
  if (!selected) return null;
  return {
    stepRunId: row.id,
    itemName: selected.itemName,
    collectedAt: selected.rakutenItem?.collectedAt ?? null,
  };
}

/**
 * 후보마다 가장 최근의 소싱 선택(선택이 있는 ② 버전 중 버전이 가장 큰 것). 표시명이 쓴다.
 * ②를 다시 실행하는 동안(새 버전에 아직 선택이 없음)에도 이름이 검색어로 되돌아가지 않게 한다(Proposed).
 */
export async function loadLatestSelections(
  db: Db,
  candidateIds: readonly number[],
): Promise<Map<number, SourcingSelection>> {
  const result = new Map<number, SourcingSelection>();
  if (candidateIds.length === 0) return result;
  const rows = await db.stepRun.findMany({
    where: {
      candidateId: { in: [...candidateIds] },
      stepCode: 'SOURCING',
      sourcingComparison: {
        is: {
          OR: [{ selectedRakutenItemId: { not: null } }, { rows: { some: { isSelected: true } } }],
        },
      },
    },
    orderBy: [{ candidateId: 'asc' }, { version: 'desc' }],
    select: SELECTION_SELECT,
  });
  for (const row of rows) {
    if (result.has(row.candidateId)) continue;
    const selection = toSelection(row);
    if (selection) result.set(row.candidateId, selection);
  }
  return result;
}

/** 현재 ② 버전(candidate_step.current_step_run_id)의 소싱 선택. 페이지 데이터 수집 시각이 쓴다 */
export async function loadCurrentSelection(
  db: Db,
  currentStepRunId: number | null | undefined,
): Promise<SourcingSelection | null> {
  if (!currentStepRunId) return null;
  const row = await db.stepRun.findUnique({
    where: { id: currentStepRunId },
    select: SELECTION_SELECT,
  });
  return row ? toSelection(row) : null;
}

/**
 * 후보 표시명(05-1 §7.2-10, 05-2 displayName x-decision, P1-04 Proposed):
 * ② 선택 상품명(rakuten_item.item_name) + ' · ' + 선택 색상. ② 선택 전에는 라쿠텐 검색어, 그것도 없으면 null.
 */
export function displayNameOf(
  candidate: Pick<Candidate, 'rakutenQuery' | 'selectedColor'>,
  selection: SourcingSelection | null | undefined,
): string | null {
  if (selection) {
    return candidate.selectedColor
      ? `${selection.itemName} · ${candidate.selectedColor}`
      : selection.itemName;
  }
  return candidate.rakutenQuery ?? null;
}

/** 단계 10개를 흐름 순서로(없는 행은 NOT_RUN) */
export function toStepBriefs(
  rows: readonly Pick<CandidateStep, 'stepCode' | 'status'>[],
): CandidateStepBriefDto[] {
  const map = toStepStatusMap(rows);
  return STEP_FLOW.map((stepCode) => ({ stepCode, status: map[stepCode] ?? 'NOT_RUN' }));
}

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null | undefined): string | null =>
  date ? date.toISOString() : null;

export function toSummary(
  candidate: Candidate,
  stepRows: readonly Pick<CandidateStep, 'stepCode' | 'status'>[],
  selection: SourcingSelection | null | undefined,
): CandidateSummaryDto {
  return {
    id: candidate.id,
    creationPath: candidate.creationPath as CreationPath,
    status: candidate.status as CandidateStatus,
    statusChangedAt: iso(candidate.statusChangedAt),
    excludedReason: candidate.excludedReason as CandidateExcludedReason | null,
    displayName: displayNameOf(candidate, selection),
    rakutenQuery: candidate.rakutenQuery,
    anchorModelCode: candidate.anchorModelCode,
    itemCode: candidate.itemCode,
    selectedColor: candidate.selectedColor,
    gender: candidate.gender as 'MALE' | 'FEMALE' | null,
    resumeStepCode: resumeStepCode(toStepStatusMap(stepRows)),
    steps: toStepBriefs(stepRows),
    createdAt: iso(candidate.createdAt),
    updatedAt: iso(candidate.updatedAt),
  };
}

export function toContinuousRun(chain: StepChain | null): ContinuousRunSummaryDto | null {
  if (!chain) return null;
  return {
    id: chain.id,
    candidateId: chain.candidateId,
    kind: chain.kind,
    startStepCode: chain.startStepCode as StepCode | null,
    startedAt: iso(chain.startedAt),
    endedAt: isoOrNull(chain.endedAt),
    stopReason: chain.stopReason,
    stopStepCode: chain.stopStepCode as StepCode | null,
  };
}

export interface DetailParts {
  candidate: Candidate & { sourceKeyword: { keyword: string } | null };
  stepRows: readonly Pick<CandidateStep, 'stepCode' | 'status'>[];
  gates: CandidateGateValidity;
  latestSelection: SourcingSelection | null;
  /** 현재 ② 버전의 페이지 수집 시각(PageDataPort, P1-05) */
  pageDataCollectedAt: Date | null;
  approvedAt: Date | null;
  openChain: StepChain | null;
  now: Date;
  /** 페이지 데이터 유효 시간(설정 safety.judgementValidityHours) */
  validityHours: number;
}

export function toDetail(parts: DetailParts): CandidateDetailDto {
  const { candidate, gates } = parts;
  const collectedAt = parts.pageDataCollectedAt;
  const pageDataStale =
    collectedAt !== null &&
    parts.now.getTime() > collectedAt.getTime() + parts.validityHours * 3_600_000;
  return {
    id: candidate.id,
    creationPath: candidate.creationPath as CreationPath,
    status: candidate.status as CandidateStatus,
    statusChangedAt: iso(candidate.statusChangedAt),
    excludedReason: candidate.excludedReason as CandidateExcludedReason | null,
    displayName: displayNameOf(candidate, parts.latestSelection),
    sourceKeywordId: candidate.sourceKeywordId,
    sourceKeyword: candidate.sourceKeyword?.keyword ?? null,
    rakutenQuery: candidate.rakutenQuery,
    sourceUrl: candidate.sourceUrl,
    anchorModelCode: candidate.anchorModelCode,
    anchorItemCode: candidate.anchorItemCode,
    anchorColorCode: candidate.anchorColorCode,
    anchorFixedAt: isoOrNull(candidate.anchorFixedAt),
    itemCode: candidate.itemCode,
    selectedColor: candidate.selectedColor,
    gender: candidate.gender as 'MALE' | 'FEMALE' | null,
    genderSource: candidate.genderSource as 'STEP2' | 'OWNER' | null,
    genderRecheckRequired: candidate.genderRecheckRequired,
    leafCategoryId: candidate.leafCategoryId,
    wholeCategoryName: candidate.wholeCategoryName,
    noComparisonConfirmedAt: isoOrNull(candidate.noComparisonConfirmedAt),
    locked: isLockedStatus(candidate.status),
    pageDataCollectedAt: isoOrNull(collectedAt),
    pageDataStale,
    gates: (['G2', 'G3'] as const).map((gate) => ({
      gate,
      gatePassId: gates[gate].gatePassId,
      passedAt: isoOrNull(gates[gate].passedAt),
      valid: gates[gate].valid,
    })),
    approvedAt: isoOrNull(parts.approvedAt),
    openContinuousRun: toContinuousRun(parts.openChain),
    resumeStepCode: resumeStepCode(toStepStatusMap(parts.stepRows)),
    createdAt: iso(candidate.createdAt),
    updatedAt: iso(candidate.updatedAt),
  };
}

export function toHistoryItem(row: CandidateStatusHistory): CandidateStatusHistoryItemDto {
  return {
    id: row.id,
    candidateId: row.candidateId,
    fromStatus: row.fromStatus as CandidateStatus | null,
    toStatus: row.toStatus as CandidateStatus,
    reason: row.reason as CandidateStatusReason,
    stepRunId: row.stepRunId,
    gatePassId: row.gatePassId,
    registrationId: row.registrationId,
    changedAt: iso(row.changedAt),
  };
}

export function toStatusChangeResult(
  candidate: Pick<Candidate, 'id' | 'status' | 'excludedReason' | 'statusChangedAt'>,
  history: CandidateStatusHistory,
  warnings: CandidateWarning[],
): CandidateStatusChangeResultDto {
  return {
    candidateId: candidate.id,
    status: candidate.status as CandidateStatus,
    excludedReason: candidate.excludedReason as CandidateExcludedReason | null,
    statusChangedAt: iso(candidate.statusChangedAt),
    history: toHistoryItem(history),
    warnings,
  };
}
