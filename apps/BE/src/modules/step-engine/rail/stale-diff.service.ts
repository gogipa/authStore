import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../candidates/candidate-guard.service.js';
import { NULL_VALUE_HASH } from '../domain/fingerprint.js';
import type { StepCode, StepStatus } from '../domain/steps.js';
import type {
  StepInputSourceTypeValue,
  StepStaleDiffDto,
  StepStaleInputDiffDto,
} from '../dto/step-run-response.dto.js';
import {
  inputContextOf,
  loadInputRows,
  loadStepRows,
  readResolvedInputs,
  type ResolvedInput,
} from '../execution/step-run-store.js';
import { StepRunnerRegistry } from '../runner/step-runner.registry.js';

/**
 * '재실행 필요' 단계의 바뀐 입력(05-2 getCandidateStepStaleDiff, F-CW-11·19). step_run_input에는 값 해시만 있어
 * 입력별 버전 쌍(쓴 버전 ↔ 지금 버전)과 해시를 준다. 값 차이는 FE가 산출물 조회로 나란히 그린다.
 * `keepAsIsAllowed`는 COPY일 때만 true(ck_step_run_keep_copy_only). 재실행 필요가 아니면 409 STEP_NOT_RERUN_REQUIRED.
 * 실행기가 없으면 지금 값을 다시 읽지 못해 쓴 값을 그대로 두고 `staleInputs`로 바뀐 입력을 표시한다.
 */
@Injectable()
export class StaleDiffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
    private readonly settings: SettingsService,
    private readonly registry: StepRunnerRegistry,
  ) {}

  async diff(candidateId: number, stepCode: StepCode): Promise<StepStaleDiffDto> {
    const candidate = await this.guard.findOr404(this.prisma, candidateId);
    const rows = await loadStepRows(this.prisma, candidateId);
    const row = rows.find((r) => r.stepCode === stepCode);
    if (!row || row.status !== 'RERUN_REQUIRED' || row.currentStepRunId === null) {
      throw new ApiException('STEP_NOT_RERUN_REQUIRED', {
        details: { stepCode, status: row?.status ?? 'NOT_RUN' },
      });
    }
    const stored = await loadInputRows(this.prisma, row.currentStepRunId);
    const runner = this.registry.get(stepCode);
    const settings = this.settings.currentOrNull();
    const current: ResolvedInput[] | null =
      runner && settings
        ? await readResolvedInputs(runner, inputContextOf(this.prisma, candidate, settings, rows))
        : null;

    const keys = [
      ...new Set([
        ...stored.filter((s) => s.isStartCondition).map((s) => s.inputKey),
        ...(current ?? []).filter((c) => c.isStartCondition).map((c) => c.inputKey),
        ...row.staleInputs,
      ]),
    ].sort();
    const inputs = keys.map((inputKey): StepStaleInputDiffDto => {
      const used = stored.find((s) => s.inputKey === inputKey);
      const now = current?.find((c) => c.inputKey === inputKey);
      const usedValueHash = used?.valueHash ?? NULL_VALUE_HASH;
      const currentValueHash = current ? (now?.valueHash ?? NULL_VALUE_HASH) : usedValueHash;
      return {
        inputKey,
        sourceType: (now?.sourceType ??
          used?.sourceType ??
          'PREV_STEP') as StepInputSourceTypeValue,
        changed: current ? usedValueHash !== currentValueHash : row.staleInputs.includes(inputKey),
        usedSourceStepRunId: used?.sourceStepRunId ?? null,
        currentSourceStepRunId: current
          ? (now?.sourceStepRunId ?? null)
          : (used?.sourceStepRunId ?? null),
        usedValueHash,
        currentValueHash,
      };
    });
    return {
      candidateId,
      stepCode,
      status: row.status as StepStatus,
      stepRunId: row.currentStepRunId,
      staleInputs: row.staleInputs,
      staleSince: row.staleSince ? row.staleSince.toISOString() : null,
      keepAsIsAllowed: stepCode === 'COPY',
      inputs,
    };
  }
}
