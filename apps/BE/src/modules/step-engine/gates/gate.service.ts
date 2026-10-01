import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type {
  Candidate,
  CandidateStep,
  GatePass,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import { CandidateStatusService } from '../candidates/candidate-status.service.js';
import { StepEngineTransactions, type Db } from '../candidates/step-engine-tx.js';
import type { GateBlocker, GatePassEffect } from '../contracts/gate-basis.js';
import { upstreamSteps } from '../domain/step-graph.js';
import {
  isLockedStatus,
  STEP_FLOW,
  type CandidateStatus,
  type GateCode,
  type StepCode,
  type StepStatus,
} from '../domain/steps.js';
import type { CandidateBlockReasonDto } from '../dto/step-run-response.dto.js';
import type {
  CandidateGateListDto,
  CandidateGateStateDto,
  GatePassResultDto,
} from '../dto/gate.dto.js';
import { toBlockReason, type StepBlock } from '../execution/step-blocks.js';
import { loadStepRows } from '../execution/step-run-store.js';
import { GateBasisRegistry } from './gate-basis.registry.js';
import { gateFingerprint } from './gate-fingerprint.js';
import { GATE_BASIS_STEP, GATE_NOT_READY_MESSAGE, GATE_PASSABLE_STATUSES } from './gate-rules.js';
import { GateValidityService, type GateInspection } from './gate-validity.service.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

/** G4를 통과한 것으로 보는 후보 상태(P4-03) */
const G4_APPROVED_STATUSES = ['VALIDATED', 'REGISTERING', 'RESULT_CHECK_REQUIRED', 'REGISTERED'];

/** 경로 gateCode가 G2·G3인지(아니면 422 INVALID_GATE_CODE — G1·G4 포함) */
export function parseGateCode(value: unknown): GateCode {
  if (value === 'G2' || value === 'G3') return value;
  throw new ApiException('INVALID_GATE_CODE', {
    details: { gateCode: typeof value === 'string' ? value.slice(0, 8) : null },
  });
}

const G2_KEYS = ['basisStepRunId'] as const;
const G3_KEYS = [
  'basisStepRunId',
  'representativeImageAssetId',
  'additionalImageAssetIds',
  'checklist',
  'sameProductColorConfirmed',
] as const;

function isId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_ID;
}

/**
 * 통과 body 모양 검사(05-2 GatePassG2Request·GatePassG3Request, 표 C). 어긋나면 422 VALIDATION_FAILED.
 * G3 체크리스트 값(모두 true, 422 CHECKLIST_INCOMPLETE)·추가이미지 9장 초과(422 IMAGE_COUNT_INVALID)·이미지 규칙은 G3
 * 공급자(P3-02 thumbnails `ThumbnailG3GateBasis`)가 `blockers`로 본다. 대표이미지를 추가이미지에 다시 넣으면 모양 오류다.
 */
export function parseGatePassBody(
  gate: GateCode,
  raw: unknown,
): { basisStepRunId: number; body: Record<string, unknown> } {
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;
  const allowed: readonly string[] = gate === 'G2' ? G2_KEYS : G3_KEYS;
  const errors: FieldError[] = [];
  for (const key of Object.keys(body)) {
    if (body[key] !== undefined && !allowed.includes(key)) {
      errors.push({
        field: key,
        message: `${gate} 통과에서는 받지 않는 칸입니다.`,
        rejectedValue: body[key],
      });
    }
  }
  if (!isId(body.basisStepRunId)) {
    errors.push({
      field: 'basisStepRunId',
      message: '1 이상의 정수여야 합니다.',
      rejectedValue: body.basisStepRunId,
    });
  }
  if (gate === 'G3') {
    if (!isId(body.representativeImageAssetId)) {
      errors.push({
        field: 'representativeImageAssetId',
        message: '1 이상의 정수여야 합니다.',
        rejectedValue: body.representativeImageAssetId,
      });
    }
    // 9장 초과는 모양이 아니라 개수 규칙이라 G3 공급자가 422 IMAGE_COUNT_INVALID로 본다(P3-02 Proposed, 표 C)
    const extra = body.additionalImageAssetIds;
    if (
      !Array.isArray(extra) ||
      extra.length > 100 ||
      !extra.every(isId) ||
      new Set(extra).size !== extra.length
    ) {
      errors.push({
        field: 'additionalImageAssetIds',
        message: '서로 다른 이미지 id 목록이어야 합니다(추가이미지는 9장까지).',
        rejectedValue: extra,
      });
    } else if ((extra as unknown[]).includes(body.representativeImageAssetId)) {
      errors.push({
        field: 'additionalImageAssetIds',
        message: '대표이미지를 추가이미지에 다시 넣을 수 없습니다.',
        rejectedValue: extra,
      });
    }
    const checklist = body.checklist;
    if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
      errors.push({
        field: 'checklist',
        message: '체크리스트가 필요합니다.',
        rejectedValue: checklist,
      });
    }
    if (
      body.sameProductColorConfirmed !== undefined &&
      typeof body.sameProductColorConfirmed !== 'boolean'
    ) {
      errors.push({
        field: 'sameProductColorConfirmed',
        message: 'true·false여야 합니다.',
        rejectedValue: body.sameProductColorConfirmed,
      });
    }
  }
  if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
  return { basisStepRunId: body.basisStepRunId as number, body };
}

/** 막힌 이유 → 05-2 CandidateBlockReason */
function toReason(blocker: GateBlocker): CandidateBlockReasonDto {
  return {
    code: blocker.code,
    message: blocker.message ?? formatErrorMessage(blocker.code),
    ...(blocker.details ? { details: blocker.details } : {}),
  };
}

function stepReason(block: StepBlock): CandidateBlockReasonDto {
  const reason = toBlockReason(block);
  return {
    code: reason.code,
    message: reason.message,
    ...(reason.details ? { details: reason.details } : {}),
  };
}

function toException(reason: CandidateBlockReasonDto): ApiException {
  return new ApiException(reason.code as GateBlocker['code'], {
    message: reason.message,
    details: reason.details,
  });
}

const iso = (date: Date | null | undefined): string | null => (date ? date.toISOString() : null);

/**
 * 게이트 통과·목록(F-CW-02, 05-2 passCandidateGate·listCandidateGates, P1-06 규칙 10·11·13).
 * 통과는 웹 화면 요청(로컬 보안 가드 + X-AutoStore-Client)으로만 기록한다 — CLI(M3)가 부를 내부 창구(StepEngineApi)에
 * 열지 않는다(규칙 12). G4는 여기가 아니라 등록 기록(registration.approved_at, P4-03)이다.
 */
@Injectable()
export class GateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly validity: GateValidityService,
    private readonly registry: GateBasisRegistry,
    private readonly audit: UserActionLogService,
    private readonly events: ProgressEventsService,
  ) {}

  /** 게이트 통과를 막는 이유(목록 blockedReasons·통과 API 같은 순서). `basisStepRunId`를 주면 화면이 본 버전을 확인한다 */
  private async blockersOf(
    db: Db,
    candidate: Candidate,
    rows: readonly CandidateStep[],
    gate: GateCode,
    request: { basisStepRunId: number; body: unknown } | null,
  ): Promise<CandidateBlockReasonDto[]> {
    if (isLockedStatus(candidate.status)) {
      return [
        stepReason({ code: 'CANDIDATE_LOCKED', status: candidate.status as CandidateStatus }),
      ];
    }
    if (candidate.status === 'EXCLUDED') return [stepReason({ code: 'CANDIDATE_EXCLUDED' })];
    const provider = this.registry.get(gate);
    if (!provider) {
      return [
        toReason({
          code: 'INVALID_GATE_CODE',
          message: GATE_NOT_READY_MESSAGE,
          details: { gate, reason: 'NO_PROVIDER' },
        }),
      ];
    }
    const basisStep = GATE_BASIS_STEP[gate];
    const statusOf = (code: StepCode) =>
      (rows.find((r) => r.stepCode === code)?.status ?? 'NOT_RUN') as StepStatus;
    // 근거 단계가 읽는 앞 단계(②)가 실행 중이면 통과할 값이 바뀔 수 있다
    const upstream = upstreamSteps(basisStep);
    const running = STEP_FLOW.find((code) => upstream.has(code) && statusOf(code) === 'RUNNING');
    if (running) {
      return [
        stepReason({
          code: 'STEP_LOCKED_BY_RUNNING_STEP',
          stepCode: basisStep,
          runningStepCode: running,
        }),
      ];
    }
    const row = rows.find((r) => r.stepCode === basisStep);
    const currentId = row?.currentStepRunId ?? null;
    if (request && currentId !== request.basisStepRunId) {
      return [
        toReason({
          code: 'VERSION_NOT_CURRENT',
          details: { stepCode: basisStep, currentStepRunId: currentId },
        }),
      ];
    }
    const status = statusOf(basisStep);
    if (currentId === null || !GATE_PASSABLE_STATUSES[gate].includes(status)) {
      return [stepReason({ code: 'STEP_NOT_COMPLETED', stepCode: basisStep, status })];
    }
    const blockers = await provider.blockers(db, candidate.id, currentId, request?.body ?? null);
    return blockers.map(toReason);
  }

  /**
   * G2·G3 통과(규칙 10·11): gate_pass(추가만) + onPass + 후보 상태 재평가(이력 gate_pass_id) + user_action_log(GATE_PASSED)를
   * 한 트랜잭션으로. 지문이 최신 통과와 같으면 새 행 없이 기존 기록(200). 커밋 뒤 SSE `gate.passed`.
   */
  async pass(
    candidateId: number,
    gate: GateCode,
    rawBody: unknown,
  ): Promise<{ created: boolean; result: GatePassResultDto }> {
    const { basisStepRunId, body } = parseGatePassBody(gate, rawBody);
    await this.guard.findOr404(this.prisma, candidateId);
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      const rows = await loadStepRows(scope.tx, candidateId);
      const blocked = await this.blockersOf(scope.tx, candidate, rows, gate, {
        basisStepRunId,
        body,
      });
      if (blocked.length > 0) throw toException(blocked[0]!);
      const provider = this.registry.get(gate)!;
      const basisStepCode = GATE_BASIS_STEP[gate];
      const basis = provider.passBasis
        ? await provider.passBasis(scope.tx, candidateId, basisStepRunId, body)
        : await provider.basis(scope.tx, candidateId, basisStepRunId);
      const fingerprint = gateFingerprint(basis);
      const latest = await scope.tx.gatePass.findFirst({
        where: { candidateId, gate },
        orderBy: [{ passedAt: 'desc' }, { id: 'desc' }],
      });
      // 같은 지문이면 새 행 없이 200 — 근거 버전이 산출물을 가진(완료) 때만. 입력 대기 ⑤(G3 첫 선택)는 늘 기록하고
      // onPass로 ⑤를 끝낸다(P3-02 Proposed — 같은 해시의 선택이어도 ⑤가 입력 대기에 머물지 않게)
      const basisRow = rows.find((r) => r.stepCode === basisStepCode);
      const basisHasOutput =
        basisRow?.status === 'COMPLETED' || basisRow?.status === 'RERUN_REQUIRED';
      if (latest && latest.fingerprint === fingerprint && basisHasOutput) {
        return {
          created: false,
          result: this.toResult(latest, candidate.status as CandidateStatus, false, {}),
        };
      }
      const gatePass = await scope.tx.gatePass.create({
        data: {
          candidateId,
          gate,
          fingerprint,
          fingerprintBasis: basis as Prisma.InputJsonObject,
          basisStepRunId,
          basisStepCode,
          passedAt: scope.now,
        },
      });
      const effect = (await provider.onPass?.(scope, candidateId, gatePass.id, body)) ?? {};
      await this.status.reevaluate(scope, candidateId, { gatePassId: gatePass.id });
      // onPass(⑤ 완료 등)가 먼저 상태를 바꿨을 수도 있어 앞뒤 상태로 statusChanged를 정한다
      const after = await scope.tx.candidate.findUniqueOrThrow({
        where: { id: candidateId },
        select: { status: true },
      });
      await this.audit.record(
        {
          eventType: 'GATE_PASSED',
          candidateId,
          stepRunId: basisStepRunId,
          stepCode: basisStepCode,
          gate,
          detail: { gatePassId: gatePass.id, fingerprint },
          occurredAt: scope.now,
        },
        scope.tx,
      );
      scope.afterCommit(() => {
        this.events.publish('gate.passed', {
          candidateId,
          gate,
          gatePassId: gatePass.id,
          passedAt: gatePass.passedAt.toISOString(),
        });
      });
      return {
        created: true,
        result: this.toResult(
          gatePass,
          after.status as CandidateStatus,
          after.status !== candidate.status,
          effect,
        ),
      };
    });
  }

  private toResult(
    pass: GatePass,
    candidateStatus: CandidateStatus,
    statusChanged: boolean,
    effect: GatePassEffect,
  ): GatePassResultDto {
    return {
      gatePassId: pass.id,
      gate: pass.gate as 'G2' | 'G3',
      fingerprint: pass.fingerprint,
      basisStepRunId: pass.basisStepRunId,
      passedAt: pass.passedAt.toISOString(),
      candidateStatus,
      statusChanged,
      thumbnailSelectionId: effect.thumbnailSelectionId ?? null,
      thumbnailStepRunId: effect.thumbnailStepRunId ?? null,
      warnings: effect.warnings ?? [],
    };
  }

  /**
   * 게이트 상태 G1~G4(규칙 13, 페이징 없음). G1 = keyword.selected_at(키워드 경로만 — 다른 경로 후보는 passed false·passedAt
   * null, Proposed), G2·G3 = 최신 통과·지문 유효·바뀐 구성값·막힌 이유·경고, G4 = registration.approved_at.
   */
  async list(candidateId: number): Promise<CandidateGateListDto> {
    const db = this.prisma;
    const candidate = await this.guard.findOr404(db, candidateId);
    const [keyword, rows, inspection, approved] = await Promise.all([
      candidate.sourceKeywordId !== null
        ? db.keyword.findUnique({
            where: { id: candidate.sourceKeywordId },
            select: { selectedAt: true },
          })
        : Promise.resolve(null),
      loadStepRows(db, candidateId),
      this.validity.inspect(db, candidateId),
      db.registration.findFirst({
        where: { stepRun: { candidateId } },
        orderBy: [{ approvedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, approvedAt: true, failedAt: true },
      }),
    ]);
    const g1: CandidateGateStateDto = {
      gate: 'G1',
      passed: candidate.creationPath === 'KEYWORD' && !!keyword?.selectedAt,
      gatePassId: null,
      passedAt: candidate.creationPath === 'KEYWORD' ? iso(keyword?.selectedAt) : null,
      basisStepRunId: null,
      registrationId: null,
      fingerprintValid: null,
      changedBasisKeys: [],
      blockedReasons: [],
      warnings: [],
    };
    const gateState = async (gate: GateCode): Promise<CandidateGateStateDto> => {
      const it: GateInspection = inspection[gate];
      const provider = this.registry.get(gate);
      const currentId = it.currentRun?.id ?? null;
      const warnings =
        provider?.warnings && currentId !== null
          ? await provider.warnings(db, candidateId, currentId)
          : [];
      return {
        gate,
        passed: it.valid,
        gatePassId: it.latest?.id ?? null,
        passedAt: iso(it.latest?.passedAt),
        basisStepRunId: it.latest?.basisStepRunId ?? null,
        registrationId: null,
        fingerprintValid: it.valid,
        changedBasisKeys: it.changedBasisKeys,
        blockedReasons: await this.blockersOf(db, candidate, rows, gate, null),
        warnings,
      };
    };
    // P4-03(Proposed): G4 통과 = 마지막 등록 기록이 종결되지 않았고 후보가 승인 뒤 상태(검증완료·등록 진행·등록됨)일 때.
    // 4xx·조회 결과 없음으로 종결됐거나 차단 스위치를 꺼 승인대기로 돌아오면 다시 '확인 필요'다(기록은 그대로 남는다)
    const g4Passed =
      approved !== null &&
      approved.failedAt === null &&
      (G4_APPROVED_STATUSES as readonly string[]).includes(candidate.status);
    const g4: CandidateGateStateDto = {
      gate: 'G4',
      passed: g4Passed,
      gatePassId: null,
      passedAt: iso(approved?.approvedAt),
      basisStepRunId: null,
      registrationId: approved?.id ?? null,
      fingerprintValid: null,
      changedBasisKeys: [],
      blockedReasons: [],
      warnings: [],
    };
    return { items: [g1, await gateState('G2'), await gateState('G3'), g4] };
  }
}
