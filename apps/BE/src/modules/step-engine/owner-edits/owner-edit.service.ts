import { Inject, Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { StepRun } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import { CandidateStatusService } from '../candidates/candidate-status.service.js';
import { StepEngineTransactions, type StepEngineTx } from '../candidates/step-engine-tx.js';
import type { StepRunner } from '../contracts/step-runner.js';
import { changedInputKeys, fingerprint } from '../domain/fingerprint.js';
import { type StepCode, type StepStatus } from '../domain/steps.js';
import type { CandidateWarning } from '../domain/warnings.js';
import { EDITABLE_STEPS, toApiException } from '../execution/step-blocks.js';
import { publishAfterCommit } from '../execution/step-events.js';
import { StepExecutionService, type StartStepResult } from '../execution/step-execution.service.js';
import { editLockBlock } from '../execution/step-locks.js';
import {
  hashesOf,
  inputContextOf,
  insertInputRows,
  loadInputRows,
  loadStepRows,
  nextVersion,
  readResolvedInputs,
  stepStatusMapOf,
} from '../execution/step-run-store.js';
import { GATE_VALIDITY, type GateValidityPort } from '../ports/gate-validity.port.js';
import { PropagationService } from '../propagation/propagation.service.js';
import { StepRunnerRegistry } from '../runner/step-runner.registry.js';

export const OWNER_ACTIONS = ['EDIT', 'KEEP_AS_IS', 'RESTORE_VERSION'] as const;
export type OwnerAction = (typeof OWNER_ACTIONS)[number];

/** 오너 수정 body(05-2 StepOwnerEditRequest oneOf). 모양은 `parseOwnerEditBody`가 본다 */
export interface OwnerEditBody {
  ownerAction?: unknown;
  baseStepRunId?: unknown;
  fields?: unknown;
  add?: unknown;
  remove?: unknown;
}

export interface OwnerEditFieldInput {
  fieldKey: string;
  value?: unknown;
  evidenceUrl?: string;
  choose?: 'OWNER' | 'GENERATED';
  recheckConfirmed?: boolean;
}

/** 검사한 오너 수정 요청 */
export type ParsedOwnerEdit =
  | { ownerAction: 'EDIT'; baseStepRunId: number; fields: OwnerEditFieldInput[] }
  | { ownerAction: 'EDIT'; baseStepRunId: number; add: string[]; remove: string[] }
  | { ownerAction: 'KEEP_AS_IS'; baseStepRunId: number }
  | { ownerAction: 'RESTORE_VERSION'; baseStepRunId: number };

/** 05-2 StepOwnerEditResult */
export interface StepOwnerEditResult {
  stepRunId: number;
  candidateId: number;
  stepCode: StepCode;
  version: number;
  executionMode: 'OWNER_EDIT';
  ownerAction: OwnerAction;
  baseStepRunId: number;
  status: Exclude<StepStatus, 'NOT_RUN'>;
  staleDownstreamSteps: StepCode[];
  propagatedSteps: StepCode[];
  warnings: CandidateWarning[];
}

export type OwnerEditOutcome =
  | { kind: 'CREATED'; result: StepOwnerEditResult }
  | { kind: 'ACCEPTED'; accepted: StartStepResult };

/** content_draft_field.field_key 형식(05-2 OwnerEditFieldInput.fieldKey) */
const FIELD_KEY_PATTERN = /^((copy|fact|notice)\.[a-z0-9_.]+|product_name)$/;
const FIELD_ITEM_KEYS = ['fieldKey', 'value', 'evidenceUrl', 'choose', 'recheckConfirmed'];

function isPositiveInt(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2_147_483_647
  );
}

function isUri(value: string): boolean {
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}

function tagList(value: unknown, field: string, errors: FieldError[]): string[] {
  if (!Array.isArray(value)) {
    errors.push({ field, message: '태그 목록(배열)이 필요합니다.', rejectedValue: value });
    return [];
  }
  value.forEach((tag, index) => {
    if (typeof tag !== 'string' || tag.length < 1 || tag.length > 100) {
      errors.push({
        field: `${field}[${index}]`,
        message: '태그는 1~100자 글자여야 합니다.',
        rejectedValue: tag,
      });
    }
  });
  return value.filter((tag): tag is string => typeof tag === 'string');
}

function fieldList(value: unknown, errors: FieldError[]): OwnerEditFieldInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({
      field: 'fields',
      message: '고칠 항목이 1개 이상 필요합니다.',
      rejectedValue: value,
    });
    return [];
  }
  const out: OwnerEditFieldInput[] = [];
  value.forEach((item, index) => {
    const at = `fields[${index}]`;
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      errors.push({ field: at, message: '항목 모양이 맞지 않습니다.', rejectedValue: item });
      return;
    }
    const record = item as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!FIELD_ITEM_KEYS.includes(key)) {
        errors.push({
          field: `${at}.${key}`,
          message: '받지 않는 값입니다.',
          rejectedValue: record[key],
        });
      }
    }
    const fieldKey = record.fieldKey;
    if (typeof fieldKey !== 'string' || fieldKey.length > 48 || !FIELD_KEY_PATTERN.test(fieldKey)) {
      errors.push({
        field: `${at}.fieldKey`,
        message: 'copy.*·fact.*·notice.*·product_name 형식(48자 이하)이어야 합니다.',
        rejectedValue: fieldKey,
      });
    }
    if (
      record.evidenceUrl !== undefined &&
      (typeof record.evidenceUrl !== 'string' ||
        record.evidenceUrl.length > 2048 ||
        !isUri(record.evidenceUrl))
    ) {
      errors.push({
        field: `${at}.evidenceUrl`,
        message: '근거 URL 형식이 아닙니다.',
        rejectedValue: record.evidenceUrl,
      });
    }
    if (record.choose !== undefined && record.choose !== 'OWNER' && record.choose !== 'GENERATED') {
      errors.push({
        field: `${at}.choose`,
        message: 'OWNER 또는 GENERATED여야 합니다.',
        rejectedValue: record.choose,
      });
    }
    if (record.recheckConfirmed !== undefined && typeof record.recheckConfirmed !== 'boolean') {
      errors.push({
        field: `${at}.recheckConfirmed`,
        message: '참·거짓이어야 합니다.',
        rejectedValue: record.recheckConfirmed,
      });
    }
    out.push(record as unknown as OwnerEditFieldInput);
  });
  return out;
}

/**
 * 오너 수정 body 검사(05-1 표 B). 순서: ⑨ → 422 INVALID_STEP_CODE, ownerAction 모름 → 422 VALIDATION_FAILED,
 * KEEP_AS_IS인데 COPY 아님 → 422 KEEP_AS_IS_NOT_ALLOWED, EDIT인데 편집 단계 아님 → 422 INVALID_STEP_CODE,
 * 그 밖 모양 → 422 VALIDATION_FAILED(fieldErrors).
 */
export function parseOwnerEditBody(stepCode: StepCode, body: OwnerEditBody): ParsedOwnerEdit {
  if (stepCode === 'REGISTER') {
    throw toApiException({ code: 'INVALID_STEP_CODE', stepCode, reason: 'NOT_RUNNABLE' });
  }
  const action = body.ownerAction;
  if (typeof action !== 'string' || !(OWNER_ACTIONS as readonly string[]).includes(action)) {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [
        {
          field: 'ownerAction',
          message: 'EDIT·KEEP_AS_IS·RESTORE_VERSION 중 하나여야 합니다.',
          rejectedValue: action,
        },
      ],
    });
  }
  if (action === 'KEEP_AS_IS' && stepCode !== 'COPY') {
    throw new ApiException('KEEP_AS_IS_NOT_ALLOWED', { details: { stepCode } });
  }
  if (action === 'EDIT' && !EDITABLE_STEPS.includes(stepCode)) {
    throw toApiException({ code: 'INVALID_STEP_CODE', stepCode, reason: 'NOT_EDITABLE' });
  }
  const errors: FieldError[] = [];
  if (!isPositiveInt(body.baseStepRunId)) {
    errors.push({
      field: 'baseStepRunId',
      message: '1 이상의 정수여야 합니다.',
      rejectedValue: body.baseStepRunId,
    });
  }
  const forbid = (field: 'fields' | 'add' | 'remove') => {
    if (body[field] !== undefined) {
      errors.push({
        field,
        message: '이 동작에서는 받지 않는 값입니다.',
        rejectedValue: body[field],
      });
    }
  };
  const baseStepRunId = body.baseStepRunId as number;
  if (action === 'EDIT' && stepCode === 'TAGS') {
    forbid('fields');
    const add = tagList(body.add, 'add', errors);
    const remove = tagList(body.remove, 'remove', errors);
    if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
    return { ownerAction: 'EDIT', baseStepRunId, add, remove };
  }
  if (action === 'EDIT') {
    forbid('add');
    forbid('remove');
    const fields = fieldList(body.fields, errors);
    if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
    return { ownerAction: 'EDIT', baseStepRunId, fields };
  }
  forbid('fields');
  forbid('add');
  forbid('remove');
  if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
  return { ownerAction: action as 'KEEP_AS_IS' | 'RESTORE_VERSION', baseStepRunId };
}

/**
 * 오너 수정 새 버전(05-1 표 B, 규칙 10, F-CW-01·19·21). 새 step_run(OWNER_EDIT, owner_action, base_step_run_id) +
 * 산출물 복사(실행기 copyOutput) + 현재 버전 포인터 + 뒷단계 전파 + 후보 상태 재평가를 한 트랜잭션으로 쓴다.
 * - EDIT(COPY·NOTICE_RAW·NOTICE_HTML 필드): 현재 버전만(409 VERSION_NOT_CURRENT). 필드별 규칙은 실행기(P3)가 던진다.
 *   ⑦ TAGS 편집만 202: 새 실행(RUNNING)을 열고 규칙 필터·restricted-tags 재검증 뒤 끝낸다(P3-05).
 * - KEEP_AS_IS: 재실행 필요인 ⑥-1 COPY의 현재 버전만. 새 지문(지금 입력)으로 완료, user_action_log OWNER_CONFIRMED.
 * - RESTORE_VERSION: ⑨ 뺀 전 단계. 이전 완료 버전을 새 버전으로. 다른 앵커의 ② 버전은 409 ANCHOR_KEY_MISMATCH.
 * EDIT·RESTORE의 새 버전은 바탕 버전의 입력을 그대로 가져가고, 지금 입력과 다르면 곧바로 재실행 필요로 둔다(P1-05 Proposed).
 */
@Injectable()
export class OwnerEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly settings: SettingsService,
    private readonly registry: StepRunnerRegistry,
    private readonly executions: StepExecutionService,
    private readonly propagation: PropagationService,
    private readonly audit: UserActionLogService,
    private readonly events: ProgressEventsService,
    @Inject(GATE_VALIDITY) private readonly gates: GateValidityPort,
  ) {}

  async create(
    candidateId: number,
    stepCode: StepCode,
    body: OwnerEditBody,
  ): Promise<OwnerEditOutcome> {
    const edit = parseOwnerEditBody(stepCode, body);
    const runner = this.registry.get(stepCode);
    if (!runner) throw toApiException({ code: 'INVALID_STEP_CODE', stepCode, reason: 'NO_RUNNER' });
    await this.guard.findOr404(this.prisma, candidateId);

    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      const rows = await loadStepRows(scope.tx, candidateId);
      const lock = editLockBlock(stepCode, stepStatusMapOf(rows));
      if (lock) throw toApiException(lock);
      const row = rows.find((r) => r.stepCode === stepCode);
      if (!row) throw new ApiException('CANDIDATE_NOT_FOUND');
      const base = await scope.tx.stepRun.findUnique({ where: { id: edit.baseStepRunId } });
      if (!base || base.candidateId !== candidateId || base.stepCode !== stepCode) {
        throw new ApiException('STEP_RUN_NOT_FOUND', {
          details: { baseStepRunId: edit.baseStepRunId },
        });
      }
      const status = row.status as StepStatus;
      if (edit.ownerAction === 'RESTORE_VERSION') {
        if (row.currentStepRunId === base.id) throw new ApiException('STEP_RUN_ALREADY_CURRENT');
        if (base.status !== 'COMPLETED') {
          throw toApiException({
            code: 'STEP_NOT_COMPLETED',
            stepCode,
            status: base.status as StepStatus,
          });
        }
        await this.assertSameAnchor(scope.tx, runner, candidate, base);
      } else {
        if (row.currentStepRunId !== base.id) {
          throw new ApiException('VERSION_NOT_CURRENT', {
            details: { currentStepRunId: row.currentStepRunId, baseStepRunId: base.id },
          });
        }
        if (edit.ownerAction === 'KEEP_AS_IS' && status !== 'RERUN_REQUIRED') {
          throw new ApiException('STEP_NOT_RERUN_REQUIRED', { details: { stepCode, status } });
        }
        if (edit.ownerAction === 'EDIT' && status !== 'COMPLETED' && status !== 'RERUN_REQUIRED') {
          throw toApiException({ code: 'STEP_NOT_COMPLETED', stepCode, status });
        }
      }

      const settings = this.settings.current();
      const settingsSnapshotId = this.settings.currentSnapshotId();
      const current = await readResolvedInputs(
        runner,
        inputContextOf(scope.tx, candidate, settings, rows),
      );
      const currentHashes = hashesOf(current);

      // ⑦ 태그 편집: 202 — 새 실행(RUNNING)을 열고 대기열에서 재검증 뒤 끝낸다
      if (edit.ownerAction === 'EDIT' && 'add' in edit) {
        const run = await this.executions.openRun(scope, {
          candidate,
          stepCode,
          runner,
          rows,
          executionMode: 'OWNER_EDIT',
          ownerAction: 'EDIT',
          baseStepRunId: base.id,
          settingsSnapshotId,
          aiEngine: null,
          copyInputsFrom: base,
        });
        await this.recordAudit(scope, candidateId, run, edit, row.staleInputs);
        await this.status.reevaluate(scope, candidateId, { stepRunId: run.id });
        this.executions.submitOwnerEditRun(scope, {
          run,
          runner,
          settings,
          inputs: current,
          ownerEdit: {
            ownerAction: 'EDIT',
            baseStepRunId: base.id,
            edit: { add: edit.add, remove: edit.remove },
          },
        });
        return { kind: 'ACCEPTED', accepted: { run, stepRunIds: [run.id], warnings: [] } };
      }

      const keep = edit.ownerAction === 'KEEP_AS_IS';
      // 게이트 무효 감지(P1-06 규칙 9): ③·⑤ 버전을 바꾸는 오너 수정(이전 버전 다시 고르기 등) 전 지문 상태
      const gatesBefore = await this.gates.snapshot?.(scope.tx, candidateId);
      const baseInputs = keep ? null : await loadInputRows(scope.tx, base.id);
      const changed = baseInputs ? changedInputKeys(hashesOf(baseInputs), currentHashes) : [];
      const runStatus = changed.length > 0 ? 'RERUN_REQUIRED' : 'COMPLETED';
      const version = await nextVersion(scope.tx, candidateId, stepCode);
      const run = await scope.tx.stepRun.create({
        data: {
          candidateId,
          stepCode,
          version,
          executionMode: 'OWNER_EDIT',
          ownerAction: edit.ownerAction,
          baseStepRunId: base.id,
          settingsSnapshotId,
          // 산출물을 만든 실행의 AI 엔진 표시를 이어 간다(F-BS-75)
          aiEngine: base.aiEngine,
          aiModel: base.aiModel,
          aiCliVersion: base.aiCliVersion,
          status: runStatus,
          inputFingerprintStart: keep ? fingerprint(currentHashes) : base.inputFingerprintStart,
          inputFingerprintEnd: fingerprint(currentHashes),
          rerunReasonInputs: changed,
          startedAt: scope.now,
          endedAt: scope.now,
        },
      });
      if (keep) {
        await insertInputRows(scope.tx, run.id, current);
      } else if (baseInputs && baseInputs.length > 0) {
        await scope.tx.stepRunInput.createMany({
          data: baseInputs.map((input) => ({
            stepRunId: run.id,
            inputKey: input.inputKey,
            sourceType: input.sourceType,
            sourceStepRunId: input.sourceStepRunId,
            isStartCondition: input.isStartCondition,
            valueHash: input.valueHash,
          })),
        });
      }
      const effects = await runner.copyOutput(
        scope.tx,
        base.id,
        run.id,
        edit.ownerAction === 'EDIT' ? { fields: 'fields' in edit ? edit.fields : [] } : undefined,
      );
      const stepRow = await scope.tx.candidateStep.update({
        where: { id: row.id },
        data: {
          currentStepRunId: run.id,
          status: runStatus,
          staleInputs: changed,
          staleSince: changed.length > 0 ? scope.now : null,
        },
      });
      await this.recordAudit(scope, candidateId, run, edit, row.staleInputs);
      if (effects) await this.executions.applyEffects(scope, candidateId, effects);
      const stale =
        runStatus === 'COMPLETED'
          ? await this.propagation.propagateFromStep(scope, candidateId, stepCode)
          : [];
      await this.status.reevaluate(scope, candidateId, { stepRunId: run.id });
      if (gatesBefore) await this.gates.detectInvalidation?.(scope, candidateId, gatesBefore);
      publishAfterCommit(scope, this.events, { run: { row: run }, steps: [stepRow] });
      return {
        kind: 'CREATED',
        result: {
          stepRunId: run.id,
          candidateId,
          stepCode,
          version: run.version,
          executionMode: 'OWNER_EDIT',
          ownerAction: edit.ownerAction,
          baseStepRunId: base.id,
          status: runStatus,
          staleDownstreamSteps: stale,
          propagatedSteps: edit.ownerAction === 'RESTORE_VERSION' ? stale : [],
          warnings: [],
        },
      };
    });
  }

  /** ② 이전 버전 다시 고르기: 확정된 앵커와 다른 앵커의 버전이면 409 ANCHOR_KEY_MISMATCH(F-CW-03) */
  private async assertSameAnchor(
    db: Parameters<NonNullable<StepRunner['anchorKeyOf']>>[0],
    runner: StepRunner,
    candidate: {
      anchorFixedAt: Date | null;
      anchorModelCode: string | null;
      anchorItemCode: string | null;
      anchorColorCode: string | null;
    },
    base: StepRun,
  ): Promise<void> {
    if (!runner.anchorKeyOf || candidate.anchorFixedAt === null) return;
    const anchor = await runner.anchorKeyOf(db, base.id);
    if (!anchor) return;
    const same =
      (anchor.anchorModelCode?.trim() || null) === candidate.anchorModelCode &&
      (anchor.anchorItemCode?.trim() || null) === candidate.anchorItemCode &&
      anchor.anchorColorCode.trim() === candidate.anchorColorCode;
    if (!same) {
      throw new ApiException('ANCHOR_KEY_MISMATCH', {
        details: {
          anchorModelCode: candidate.anchorModelCode,
          anchorItemCode: candidate.anchorItemCode,
          anchorColorCode: candidate.anchorColorCode,
        },
      });
    }
  }

  /** 감사 기록: 그대로 유지 = OWNER_CONFIRMED(확인 기록), 값 편집·다시 고르기 = OWNER_EDITED */
  private async recordAudit(
    scope: StepEngineTx,
    candidateId: number,
    run: StepRun,
    edit: ParsedOwnerEdit,
    staleInputs: readonly string[],
  ): Promise<void> {
    const detail: Record<string, unknown> = {
      ownerAction: edit.ownerAction,
      baseStepRunId: edit.baseStepRunId,
      version: run.version,
    };
    if (edit.ownerAction === 'KEEP_AS_IS') detail.staleInputs = [...staleInputs];
    if (edit.ownerAction === 'EDIT' && 'fields' in edit) {
      detail.fieldKeys = edit.fields.map((field) => field.fieldKey);
    }
    if (edit.ownerAction === 'EDIT' && 'add' in edit) {
      detail.addedCount = edit.add.length;
      detail.removedCount = edit.remove.length;
    }
    await this.audit.record(
      {
        eventType: edit.ownerAction === 'KEEP_AS_IS' ? 'OWNER_CONFIRMED' : 'OWNER_EDITED',
        candidateId,
        stepRunId: run.id,
        stepCode: run.stepCode as StepCode,
        detail,
        occurredAt: scope.now,
      },
      scope.tx,
    );
  }
}
