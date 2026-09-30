import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import {
  parsePageRequest,
  toPage,
  type PageQueryInput,
} from '../../../common/paging/page-request.js';
import type { StepRun, StepRunInput } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import type { GateFlags } from '../domain/resume.js';
import { STEP_FLOW, type StepCode, type StepStatus, type StepStatusMap } from '../domain/steps.js';
import type {
  CandidateStepRailDto,
  CandidateStepRailItemDto,
  StepActionStateDto,
  StepRunDetailDto,
  StepRunVersionPageDto,
} from '../dto/step-run-response.dto.js';
import { asStartCandidate, type StartConditionCandidate } from '../execution/start-conditions.js';
import {
  checkStepEditable,
  checkStepRunnable,
  toBlockReason,
  type StepBlock,
} from '../execution/step-blocks.js';
import { loadStepRows, stepStatusMapOf } from '../execution/step-run-store.js';
import { stepWarnings } from '../execution/step-warnings.js';
import { BEFORE_G2_CHAIN_STARTS } from '../continuous/chain-planner.js';
import { GATE_VALIDITY, toGateFlags, type GateValidityPort } from '../ports/gate-validity.port.js';
import { StepRunnerRegistry } from '../runner/step-runner.registry.js';
import { toInputItem, toStepRunSummary } from './step-run-view.js';

/** 연속 실행만의 막힌 이유(연속 실행 API의 409와 같은 코드·문구, P1-06) */
type ChainOnlyBlock =
  | { code: 'CONTINUOUS_RUN_BEFORE_G2' }
  | { code: 'CONTINUOUS_RUN_ALREADY_OPEN'; stepChainId: number };

/** 후보 자체가 막힌 이유(연속 실행 API가 열린 묶음·G2보다 먼저 검사한다) */
const CANDIDATE_BLOCK_CODES: readonly string[] = [
  'INVALID_STEP_CODE',
  'CANDIDATE_LOCKED',
  'CANDIDATE_EXCLUDED',
  'TEMP_CANDIDATE_NOT_ALLOWED',
];

/** 막힌 이유 → 버튼 상태 */
export function actionState(block: StepBlock | ChainOnlyBlock | null): StepActionStateDto {
  if (!block) return { enabled: true, disabledReason: null };
  if (block.code === 'CONTINUOUS_RUN_BEFORE_G2') {
    return {
      enabled: false,
      disabledReason: { code: block.code, message: formatErrorMessage(block.code) },
    };
  }
  if (block.code === 'CONTINUOUS_RUN_ALREADY_OPEN') {
    return {
      enabled: false,
      disabledReason: {
        code: block.code,
        message: formatErrorMessage(block.code),
        details: { stepChainId: block.stepChainId },
      },
    };
  }
  const reason = toBlockReason(block);
  return {
    enabled: false,
    disabledReason: {
      code: reason.code,
      message: reason.message,
      ...(reason.details ? { details: reason.details } : {}),
    },
  };
}

/**
 * 레일 버튼 세 개(F-CW-11·13·18). `run`의 꺼진 이유는 단계 실행 API의 409·422 코드와 같은 함수(checkStepRunnable)로
 * 계산한다. `continuousRun`은 연속 실행 API(P1-06)와 같은 순서: 후보(잠금·제외·단계 코드) → 열린 묶음(409
 * CONTINUOUS_RUN_ALREADY_OPEN, 규칙 7) → G2 전에는 ②·③에서만(409 CONTINUOUS_RUN_BEFORE_G2, 규칙 4) → 고른 단계를
 * 지금 실행할 수 있는가. `edit`은 오너 수정 API(EDIT)와 같은 함수(checkStepEditable).
 */
export function stepActions(
  stepCode: StepCode,
  candidate: StartConditionCandidate,
  steps: StepStatusMap,
  gates: GateFlags,
  options: { hasRunner: boolean; settingsLoaded: boolean; openStepChainId?: number | null },
): CandidateStepRailItemDto['actions'] {
  const runBlock = checkStepRunnable(stepCode, candidate, steps, gates, {
    mode: 'run',
    hasRunner: options.hasRunner,
    settingsLoaded: options.settingsLoaded,
  });
  const chainBlock: StepBlock | ChainOnlyBlock | null =
    runBlock && CANDIDATE_BLOCK_CODES.includes(runBlock.code)
      ? runBlock
      : options.openStepChainId != null
        ? { code: 'CONTINUOUS_RUN_ALREADY_OPEN', stepChainId: options.openStepChainId }
        : !gates.G2 && !BEFORE_G2_CHAIN_STARTS.includes(stepCode)
          ? { code: 'CONTINUOUS_RUN_BEFORE_G2' }
          : runBlock;
  return {
    run: actionState(runBlock),
    continuousRun: actionState(chainBlock),
    edit: actionState(
      checkStepEditable(stepCode, candidate, steps, { hasRunner: options.hasRunner }),
    ),
  };
}

/**
 * 단계 레일·버전 이력·실행 한 건 조회(05-2 listCandidateSteps·listCandidateStepRuns·getStepRun).
 */
@Injectable()
export class StepRailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
    private readonly settings: SettingsService,
    private readonly registry: StepRunnerRegistry,
    @Inject(GATE_VALIDITY) private readonly gateValidity: GateValidityPort,
  ) {}

  /** 단계 레일 10칸(페이징 없음): 상태·현재 버전·입력 출처·재실행 사유·버튼·경고 */
  async rail(candidateId: number): Promise<CandidateStepRailDto> {
    const candidate = await this.guard.findOr404(this.prisma, candidateId);
    const rows = await loadStepRows(this.prisma, candidateId);
    const steps = stepStatusMapOf(rows);
    const gates = toGateFlags(await this.gateValidity.evaluate(this.prisma, candidateId));
    const currentIds = rows
      .map((row) => row.currentStepRunId)
      .filter((id): id is number => id !== null);
    const runs = await this.prisma.stepRun.findMany({
      where: { id: { in: currentIds } },
      include: { inputs: { orderBy: { inputKey: 'asc' } } },
    });
    const runById = new Map(runs.map((run) => [run.id, run]));
    const settingsLoaded = this.settings.currentOrNull() !== null;
    const start = asStartCandidate(candidate);
    const openChain = await this.prisma.stepChain.findFirst({
      where: { candidateId, endedAt: null },
      select: { id: true },
    });

    const items = STEP_FLOW.map((stepCode): CandidateStepRailItemDto => {
      const row = rows.find((r) => r.stepCode === stepCode);
      const run = row?.currentStepRunId ? runById.get(row.currentStepRunId) : undefined;
      return {
        id: row?.id ?? 0,
        stepCode,
        status: (row?.status ?? 'NOT_RUN') as StepStatus,
        currentStepRunId: row?.currentStepRunId ?? null,
        lastVersion: row?.lastVersion ?? 0,
        staleInputs: row?.staleInputs ?? [],
        staleSince: row?.staleSince ? row.staleSince.toISOString() : null,
        updatedAt: (row?.updatedAt ?? candidate.updatedAt).toISOString(),
        currentRun: run ? toStepRunSummary(run) : null,
        inputs: run ? run.inputs.map(toInputItem) : [],
        actions: stepActions(stepCode, start, steps, gates, {
          hasRunner: this.registry.has(stepCode),
          settingsLoaded,
          openStepChainId: openChain?.id ?? null,
        }),
        warnings: stepWarnings(stepCode, steps, gates),
      };
    });
    return { items };
  }

  /** 단계별 버전 이력(sort=version, 기본 version,desc). isCurrent = candidate_step.current_step_run_id와 같은가 */
  async runs(
    candidateId: number,
    stepCode: StepCode,
    query: PageQueryInput,
  ): Promise<StepRunVersionPageDto> {
    const page = parsePageRequest('/candidates/{candidateId}/steps/{stepCode}/runs', query);
    await this.guard.findOr404(this.prisma, candidateId);
    const where = { candidateId, stepCode };
    const [total, rows, step] = await Promise.all([
      this.prisma.stepRun.count({ where }),
      this.prisma.stepRun.findMany({
        where,
        orderBy: page.sort.map((s) => ({ [s.field]: s.direction })),
        skip: page.skip,
        take: page.take,
      }),
      this.prisma.candidateStep.findUnique({
        where: { candidateId_stepCode: { candidateId, stepCode } },
        select: { currentStepRunId: true },
      }),
    ]);
    return toPage(
      rows.map((run) => ({
        ...toStepRunSummary(run),
        isCurrent: run.id === step?.currentStepRunId,
      })),
      page,
      total,
    );
  }

  /** 실행 한 건 + 입력 출처(없으면 404 STEP_RUN_NOT_FOUND) */
  async stepRun(stepRunId: number): Promise<StepRunDetailDto> {
    const run = await this.prisma.stepRun.findUnique({
      where: { id: stepRunId },
      include: { inputs: { orderBy: { inputKey: 'asc' } } },
    });
    if (!run) throw new ApiException('STEP_RUN_NOT_FOUND');
    return this.toDetail(run);
  }

  private async toDetail(run: StepRun & { inputs: StepRunInput[] }): Promise<StepRunDetailDto> {
    const step = await this.prisma.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId: run.candidateId, stepCode: run.stepCode } },
      select: { currentStepRunId: true },
    });
    return {
      ...toStepRunSummary(run),
      isCurrent: step?.currentStepRunId === run.id,
      inputs: run.inputs.map(toInputItem),
    };
  }
}
