import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import {
  parsePageRequest,
  slicePage,
  toPage,
  type SortOrder,
} from '../../../common/paging/page-request.js';
import type { Candidate, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { checkRakutenQuery } from '../../sourcing/domain/rakuten-query.rules.js';
import { resumeTarget } from '../domain/resume.js';
import { canRunStep } from '../domain/runnable.js';
import {
  ATTENTION_STEP_STATUSES,
  CANDIDATE_STATUSES,
  IN_PROGRESS_STATUSES,
  NOT_IN_PROGRESS_STATUSES,
  STEP_FLOW,
  toStepStatusMap,
  type CandidateStatus,
  type StepCode,
  type StepFailureKind,
  type StepStatus,
} from '../domain/steps.js';
import type { CandidateWarning } from '../domain/warnings.js';
import {
  assertCreateShape,
  type CreateCandidateDto,
  type ListCandidateStepsQueryDto,
  type ListCandidatesQueryDto,
} from '../dto/candidate-request.dto.js';
import type {
  CandidateDetailDto,
  CandidatePageDto,
  CandidateResumeTargetDto,
  CandidateStatusChangeResultDto,
  CandidateStatusCountListDto,
  CandidateStatusHistoryPageDto,
  CandidateStepAttentionPageDto,
} from '../dto/candidate-response.dto.js';
import {
  CANDIDATE_CREATION_EXTENSION,
  type CandidateCreationExtension,
} from '../ports/candidate-creation.extension.js';
import { GATE_VALIDITY, toGateFlags, type GateValidityPort } from '../ports/gate-validity.port.js';
import { CandidateGuardService } from './candidate-guard.service.js';
import { CandidateIdentityService, type ItemColorKey } from './candidate-identity.service.js';
import { CandidateStatusService } from './candidate-status.service.js';
import {
  loadCurrentSelection,
  loadLatestSelections,
  toDetail,
  toHistoryItem,
  toStatusChangeResult,
  toSummary,
} from './candidate-view.js';
import { StepEngineTransactions, type Db } from './step-engine-tx.js';

/** 페이지 데이터 유효 시간 기본값(설정을 읽지 못할 때, PRD §5.3 6시간) */
const DEFAULT_VALIDITY_HOURS = 6;
/** 이어서 할 곳을 찾을 때 한 번에 읽는 후보 수 */
const RESUME_BATCH = 50;
/** 제외를 받는 상태(05-2 excludeCandidate x-decision §7.2-13) */
const EXCLUDABLE_STATUSES: readonly CandidateStatus[] = ['TEMP', 'WORKING', 'AWAITING_APPROVAL'];

type StepRow = { candidateId: number; stepCode: string; status: string };

/** 정렬 → Prisma orderBy. 같은 값끼리는 id로(첫 정렬과 같은 방향) 순서를 고정한다 */
function orderByOf<F extends string>(
  sort: readonly SortOrder<F>[],
): Record<string, Prisma.SortOrder>[] {
  const order: Record<string, Prisma.SortOrder>[] = sort.map((s) => ({ [s.field]: s.direction }));
  if (!sort.some((s) => (s.field as string) === 'id')) {
    order.push({ id: sort[0]?.direction ?? 'desc' });
  }
  return order;
}

/**
 * 후보 만들기·목록·상세·상태별 수·이어서 할 곳·상태 이력·재실행 필요 모아 보기·제외·다시 작업(P1-04).
 * 목록은 페이지의 candidate_step을 IN 한 번으로 읽는다.
 */
@Injectable()
export class CandidateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly identity: CandidateIdentityService,
    private readonly settings: SettingsService,
    @Inject(GATE_VALIDITY) private readonly gateValidity: GateValidityPort,
    @Inject(CANDIDATE_CREATION_EXTENSION)
    private readonly creationExtension: CandidateCreationExtension | null,
  ) {}

  // ── 만들기 ────────────────────────────────────────────────────────────────

  /**
   * 후보 만들기(규칙 1·2·3): candidate 1행 + candidate_step 10행(NOT_RUN, last_version 0) + 이력 1행(CREATED)을
   * 한 트랜잭션으로. RAKUTEN_URL은 진행 중 같은 itemCode+색상이면 새 행 없이 409 CANDIDATE_DUPLICATE.
   */
  async create(body: CreateCandidateDto): Promise<CandidateDetailDto> {
    assertCreateShape(body);
    const rakutenQuery = this.checkedQuery(body.rakutenQuery);

    let urlItem: { id: number; itemCode: string; itemUrl: string } | null = null;
    if (body.creationPath === 'RAKUTEN_URL') {
      urlItem = await this.prisma.rakutenItem.findUnique({
        where: { id: body.rakutenItemId! },
        select: { id: true, itemCode: true, itemUrl: true },
      });
      if (!urlItem) throw new ApiException('RAKUTEN_ITEM_NOT_FOUND');
      await this.creationExtension?.validateUrlItem?.(this.prisma, {
        rakutenItemId: urlItem.id,
        selectedColor: body.selectedColor!,
      });
    }
    const key: ItemColorKey | null = urlItem
      ? { itemCode: urlItem.itemCode, selectedColor: body.selectedColor! }
      : null;

    const candidateId = await this.identity.withDuplicateMapping(key, () =>
      this.transactions.run(async (scope) => {
        if (body.creationPath === 'KEYWORD')
          await this.assertUsableKeyword(scope.tx, body.sourceKeywordId!);
        if (key) await this.identity.assertNoDuplicate(scope.tx, key);
        const candidate = await scope.tx.candidate.create({
          data: {
            creationPath: body.creationPath,
            status: 'WORKING',
            statusChangedAt: scope.now,
            sourceKeywordId: body.creationPath === 'KEYWORD' ? body.sourceKeywordId! : null,
            rakutenQuery,
            sourceUrl: urlItem?.itemUrl ?? null,
            itemCode: key?.itemCode ?? null,
            selectedColor: key?.selectedColor ?? null,
            createdAt: scope.now,
          },
        });
        await scope.tx.candidateStep.createMany({
          data: STEP_FLOW.map((stepCode) => ({
            candidateId: candidate.id,
            stepCode,
            status: 'NOT_RUN',
            lastVersion: 0,
          })),
        });
        await this.status.recordCreated(scope, candidate);
        if (urlItem && this.creationExtension) {
          await this.creationExtension.createUrlSourcingVersion(scope, {
            candidateId: candidate.id,
            rakutenItemId: urlItem.id,
            selectedColor: body.selectedColor!,
          });
        }
        return candidate.id;
      }),
    );
    return this.detail(candidateId);
  }

  /** 검색어: 앞뒤 공백을 빼고, 비면 422 VALIDATION_FAILED, 규칙 위반이면 422 RAKUTEN_QUERY_INVALID */
  private checkedQuery(raw: string | undefined): string | null {
    if (raw === undefined) return null;
    const query = raw.trim();
    if (query === '') {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          { field: 'rakutenQuery', message: '검색어를 넣어 주세요.', rejectedValue: raw },
        ],
      });
    }
    const fieldErrors = checkRakutenQuery(query);
    if (fieldErrors.length > 0) throw new ApiException('RAKUTEN_QUERY_INVALID', { fieldErrors });
    return query;
  }

  /** KEYWORD 경로: 없는 키워드 404, 아동화 제외 409 KEYWORD_EXCLUDED, G1에서 안 고름 409 KEYWORD_NOT_SELECTED */
  private async assertUsableKeyword(db: Db, keywordId: number): Promise<void> {
    const keyword = await db.keyword.findUnique({
      where: { id: keywordId },
      select: { excludedReason: true, selectedAt: true },
    });
    if (!keyword) throw new ApiException('KEYWORD_NOT_FOUND');
    if (keyword.excludedReason !== null) throw new ApiException('KEYWORD_EXCLUDED');
    if (keyword.selectedAt === null) throw new ApiException('KEYWORD_NOT_SELECTED');
  }

  // ── 목록·상세 ─────────────────────────────────────────────────────────────

  /**
   * 후보 목록(규칙 11·13). status를 주지 않으면 EXCLUDED·REGISTERED를 뺀다. q는 型番·앵커 itemCode·itemCode·검색어
   * 부분 일치(대소문자 무시). runnableStep을 주면 그 단계를 지금 실행할 수 있는 후보만(판단 함수가 단계 상태·게이트를
   * 봐야 해서 조건에 맞는 후보를 모두 거른 뒤 메모리에서 페이지를 자른다).
   */
  async list(query: ListCandidatesQueryDto): Promise<CandidatePageDto> {
    const page = parsePageRequest('/candidates', query);
    const statuses = query.status && query.status.length > 0 ? query.status : IN_PROGRESS_STATUSES;
    const where: Prisma.CandidateWhereInput = { status: { in: [...statuses] } };
    if (query.q) {
      const contains = { contains: query.q, mode: 'insensitive' as const };
      where.OR = [
        { anchorModelCode: contains },
        { anchorItemCode: contains },
        { itemCode: contains },
        { rakutenQuery: contains },
      ];
    }
    const orderBy = orderByOf(page.sort);

    if (query.runnableStep) {
      const stepCode = query.runnableStep as StepCode;
      const all = await this.prisma.candidate.findMany({ where, orderBy });
      const steps = await this.loadStepRows(all.map((c) => c.id));
      const runnable: Candidate[] = [];
      for (const candidate of all) {
        const map = toStepStatusMap(steps.get(candidate.id) ?? []);
        const gates = toGateFlags(await this.gateValidity.evaluate(this.prisma, candidate.id));
        if (
          canRunStep(stepCode, candidate as Candidate & { status: CandidateStatus }, map, gates)
        ) {
          runnable.push(candidate);
        }
      }
      const sliced = slicePage(runnable, page);
      return { content: await this.summaries(sliced.content, steps), page: sliced.page };
    }

    const [total, rows] = await Promise.all([
      this.prisma.candidate.count({ where }),
      this.prisma.candidate.findMany({ where, orderBy, skip: page.skip, take: page.take }),
    ]);
    const steps = await this.loadStepRows(rows.map((c) => c.id));
    return toPage(await this.summaries(rows, steps), page, total);
  }

  private async summaries(rows: Candidate[], steps: Map<number, StepRow[]>) {
    const selections = await loadLatestSelections(
      this.prisma,
      rows.map((c) => c.id),
    );
    return rows.map((c) => toSummary(c, steps.get(c.id) ?? [], selections.get(c.id)));
  }

  /** 여러 후보의 candidate_step을 IN 한 번으로 */
  private async loadStepRows(candidateIds: number[]): Promise<Map<number, StepRow[]>> {
    const map = new Map<number, StepRow[]>();
    if (candidateIds.length === 0) return map;
    const rows = await this.prisma.candidateStep.findMany({
      where: { candidateId: { in: candidateIds } },
      select: { candidateId: true, stepCode: true, status: true },
    });
    for (const row of rows) {
      const list = map.get(row.candidateId) ?? [];
      list.push(row);
      map.set(row.candidateId, list);
    }
    return map;
  }

  /** 상태별 후보 수(05-2 getCandidateStatusCounts). 상태 8개를 모두 준다(없으면 0) */
  async statusCounts(): Promise<CandidateStatusCountListDto> {
    const groups = await this.prisma.candidate.groupBy({ by: ['status'], _count: { _all: true } });
    const counts = new Map(groups.map((g) => [g.status, g._count._all]));
    return {
      items: CANDIDATE_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })),
    };
  }

  /** 후보 상세(05-2 getCandidate + resumeStepCode) */
  async detail(candidateId: number): Promise<CandidateDetailDto> {
    const db = this.prisma;
    const candidate = await db.candidate.findUnique({
      where: { id: candidateId },
      include: { sourceKeyword: { select: { keyword: true } } },
    });
    if (!candidate) throw new ApiException('CANDIDATE_NOT_FOUND');
    const stepRows = await db.candidateStep.findMany({
      where: { candidateId },
      select: { stepCode: true, status: true, currentStepRunId: true },
    });
    const sourcingRunId = stepRows.find((r) => r.stepCode === 'SOURCING')?.currentStepRunId;
    const [gates, latest, current, approved, openChain] = await Promise.all([
      this.gateValidity.evaluate(db, candidateId),
      loadLatestSelections(db, [candidateId]),
      loadCurrentSelection(db, sourcingRunId),
      db.registration.findFirst({
        where: { stepRun: { candidateId } },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
        select: { approvedAt: true },
      }),
      db.stepChain.findFirst({
        where: { candidateId, endedAt: null },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return toDetail({
      candidate,
      stepRows,
      gates,
      latestSelection: latest.get(candidateId) ?? null,
      currentSelection: current,
      approvedAt: approved?.approvedAt ?? null,
      openChain,
      now: this.transactions.now(),
      validityHours:
        this.settings.currentOrNull()?.safety.judgementValidityHours ?? DEFAULT_VALIDITY_HOURS,
    });
  }

  /**
   * 이어서 할 곳 한 건(규칙 12, 05-2 x-decision §7.2-11): 진행 중 후보를 목록 기본 정렬(statusChangedAt desc)로 보며
   * 첫 이어 할 단계 또는 대기 게이트가 있는 후보의 것을 준다. 없으면 null(204). 아무것도 다시 만들지 않는다.
   */
  async resumeTarget(): Promise<CandidateResumeTargetDto | null> {
    for (let skip = 0; ; skip += RESUME_BATCH) {
      const rows = await this.prisma.candidate.findMany({
        where: { status: { in: [...IN_PROGRESS_STATUSES] } },
        orderBy: [{ statusChangedAt: 'desc' }, { id: 'desc' }],
        skip,
        take: RESUME_BATCH,
        select: { id: true, status: true },
      });
      if (rows.length === 0) return null;
      const steps = await this.loadStepRows(rows.map((r) => r.id));
      for (const row of rows) {
        const gates = toGateFlags(await this.gateValidity.evaluate(this.prisma, row.id));
        const target = resumeTarget(toStepStatusMap(steps.get(row.id) ?? []), gates);
        if (!target) continue;
        return {
          candidateId: row.id,
          candidateStatus: row.status as CandidateStatus,
          stepCode: target.kind === 'step' ? target.stepCode : null,
          stepStatus: target.kind === 'step' ? target.stepStatus : null,
          gate: target.kind === 'gate' ? target.gate : null,
        };
      }
      if (rows.length < RESUME_BATCH) return null;
    }
  }

  /** 후보 상태 전이 이력(페이징, sort changedAt) */
  async statusHistory(
    candidateId: number,
    query: { page?: unknown; size?: unknown; sort?: unknown },
  ): Promise<CandidateStatusHistoryPageDto> {
    const page = parsePageRequest('/candidates/{candidateId}/status-history', query);
    await this.guard.findOr404(this.prisma, candidateId);
    const where = { candidateId };
    const [total, rows] = await Promise.all([
      this.prisma.candidateStatusHistory.count({ where }),
      this.prisma.candidateStatusHistory.findMany({
        where,
        orderBy: orderByOf(page.sort),
        skip: page.skip,
        take: page.take,
      }),
    ]);
    return toPage(rows.map(toHistoryItem), page, total);
  }

  /**
   * 재실행 필요·멈춘 후보 단계 모아 보기(규칙 14, F-DB-01). 기본 상태 RERUN_REQUIRED·FAILED·WAITING_INPUT.
   * 진행 중 후보(제외·등록됨 아님)의 단계만 준다(Proposed). 필드별 '재확인 필요'는 합치지 않는다(§7.2-18).
   */
  async attentionSteps(query: ListCandidateStepsQueryDto): Promise<CandidateStepAttentionPageDto> {
    const page = parsePageRequest('/candidate-steps', query);
    const statuses =
      query.status && query.status.length > 0 ? query.status : ATTENTION_STEP_STATUSES;
    const where: Prisma.CandidateStepWhereInput = {
      status: { in: [...statuses] },
      candidate: { status: { notIn: [...NOT_IN_PROGRESS_STATUSES] } },
      ...(query.stepCode ? { stepCode: query.stepCode } : {}),
    };
    const orderBy: Prisma.CandidateStepOrderByWithRelationInput[] = page.sort.map((s) =>
      s.field === 'staleSince'
        ? { staleSince: { sort: s.direction, nulls: 'last' } }
        : { updatedAt: s.direction },
    );
    orderBy.push({ id: 'desc' });
    const [total, rows] = await Promise.all([
      this.prisma.candidateStep.count({ where }),
      this.prisma.candidateStep.findMany({
        where,
        orderBy,
        skip: page.skip,
        take: page.take,
        include: {
          candidate: { select: { status: true } },
          currentStepRun: { select: { failureKind: true, errorMessage: true, waitingSince: true } },
        },
      }),
    ]);
    return toPage(
      rows.map((row) => ({
        id: row.id,
        candidateId: row.candidateId,
        candidateStatus: row.candidate.status as CandidateStatus,
        stepCode: row.stepCode as StepCode,
        status: row.status as StepStatus,
        currentStepRunId: row.currentStepRunId,
        staleInputs: row.staleInputs,
        staleSince: row.staleSince ? row.staleSince.toISOString() : null,
        updatedAt: row.updatedAt.toISOString(),
        failureKind: (row.currentStepRun?.failureKind ?? null) as StepFailureKind | null,
        errorMessage: row.currentStepRun?.errorMessage ?? null,
        waitingSince: row.currentStepRun?.waitingSince
          ? row.currentStepRun.waitingSince.toISOString()
          : null,
      })),
      page,
      total,
    );
  }

  // ── 제외·다시 작업 ────────────────────────────────────────────────────────

  /**
   * 후보 제외(규칙 7, F-CW-06). TEMP·WORKING·AWAITING_APPROVAL → EXCLUDED/OWNER_EXCLUDED.
   * 이미 제외면(사유가 무엇이든) 새 이력 없이 지금 상태를 준다(OWNER_EXCLUDED 외 사유는 Proposed).
   * 검증완료 409 CANDIDATE_STATUS_INVALID, 등록 진행 409 CANDIDATE_LOCKED, 실행 중 단계 409 STEP_LOCKED_BY_RUNNING_STEP.
   */
  exclude(candidateId: number): Promise<CandidateStatusChangeResultDto> {
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertNotLocked(candidate);
      if (candidate.status === 'EXCLUDED') return this.currentResult(scope.tx, candidate, []);
      this.guard.assertStatusIn(candidate, EXCLUDABLE_STATUSES);
      this.guard.assertNoRunningStep(await this.guard.loadSteps(scope.tx, candidateId));
      await this.status.transition(scope, candidate, {
        toStatus: 'EXCLUDED',
        reason: 'OWNER_EXCLUDED',
      });
      return this.currentResult(scope.tx, { id: candidateId }, []);
    });
  }

  /**
   * 제외된 후보 다시 작업(규칙 8): EXCLUDED → WORKING(REOPENED, excluded_reason NULL). 이미 WORKING이면 같은 응답.
   * 진행 중 같은 itemCode+색상이 있으면 409 CANDIDATE_DUPLICATE(details.existingCandidateId), 앵커 키만 같으면
   * 경고 ANCHOR_KEY_DUPLICATE. '기준·입력을 바꿨는지'는 검사하지 않는다(§7.2-14).
   */
  async reopen(candidateId: number): Promise<CandidateStatusChangeResultDto> {
    const before = await this.guard.findOr404(this.prisma, candidateId);
    const key =
      before.itemCode !== null && before.selectedColor !== null
        ? { itemCode: before.itemCode, selectedColor: before.selectedColor }
        : null;
    return this.identity.withDuplicateMapping(
      key,
      () =>
        this.transactions.run(async (scope) => {
          const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
          this.guard.assertNotLocked(candidate);
          const warnings = await this.identity.anchorDuplicateWarnings(
            scope.tx,
            candidate,
            candidateId,
          );
          if (candidate.status === 'WORKING')
            return this.currentResult(scope.tx, candidate, warnings);
          this.guard.assertStatusIn(candidate, ['EXCLUDED']);
          if (candidate.itemCode !== null && candidate.selectedColor !== null) {
            await this.identity.assertNoDuplicate(
              scope.tx,
              { itemCode: candidate.itemCode, selectedColor: candidate.selectedColor },
              candidateId,
            );
          }
          await this.status.transition(scope, candidate, {
            toStatus: 'WORKING',
            reason: 'REOPENED',
          });
          return this.currentResult(scope.tx, { id: candidateId }, warnings);
        }),
      candidateId,
    );
  }

  /** 지금 상태 + 이 상태가 된 마지막 전이 기록 */
  private async currentResult(
    db: Db,
    candidate: Pick<Candidate, 'id'>,
    warnings: CandidateWarning[],
  ): Promise<CandidateStatusChangeResultDto> {
    const row = await db.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
    const history = await db.candidateStatusHistory.findFirstOrThrow({
      where: { candidateId: candidate.id },
      orderBy: [{ changedAt: 'desc' }, { id: 'desc' }],
    });
    return toStatusChangeResult(row, history, warnings);
  }
}
