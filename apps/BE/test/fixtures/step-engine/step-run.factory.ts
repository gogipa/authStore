import type { StepRun } from '../../../src/generated/prisma/client.js';
import {
  fingerprint,
  NULL_VALUE_HASH,
  valueHash,
} from '../../../src/modules/step-engine/domain/fingerprint.js';
import type { StepCode } from '../../../src/modules/step-engine/domain/steps.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { ensureSettingsSnapshot } from './settings-snapshot.factory.js';

/** 넣을 입력 행 하나(값을 주면 해시를 계산한다) */
export interface StepRunInputFixture {
  inputKey: string;
  sourceType?: 'PREV_STEP' | 'OWNER_INPUT' | 'SETTINGS';
  sourceStepRunId?: number | null;
  isStartCondition?: boolean;
  value?: unknown;
}

export interface StepRunFixtureInput {
  candidateId: number;
  stepCode: StepCode;
  status: 'RUNNING' | 'WAITING_INPUT' | 'COMPLETED' | 'FAILED';
  /** 주지 않으면 candidate_step.last_version + 1 */
  version?: number;
  startedAt?: Date;
  /** 입력 대기 시작 시각(WAITING_INPUT) */
  waitingSince?: Date;
  waitSecondsTotal?: number;
  inputs?: StepRunInputFixture[];
  /** candidate_step 포인터·상태·last_version도 이 실행으로 옮긴다(기본 true) */
  makeCurrent?: boolean;
}

/**
 * 닫힌·열린 step_run과 step_run_input을 직접 넣는다(재시작·잠금 상태 만들기, P1-05). 앱을 띄운 뒤에 넣는다
 * (앱이 켜질 때 재시작 정리가 RUNNING을 닫는다).
 */
export async function insertStepRun(
  prisma: PrismaService,
  input: StepRunFixtureInput,
): Promise<StepRun> {
  const settingsSnapshotId = await ensureSettingsSnapshot(prisma);
  const step = await prisma.candidateStep.findUniqueOrThrow({
    where: { candidateId_stepCode: { candidateId: input.candidateId, stepCode: input.stepCode } },
  });
  const version = input.version ?? step.lastVersion + 1;
  const startedAt = input.startedAt ?? new Date('2026-09-28T00:00:00Z');
  const open = input.status === 'RUNNING' || input.status === 'WAITING_INPUT';
  const rows = (input.inputs ?? []).map((i) => ({
    inputKey: i.inputKey,
    sourceType: i.sourceType ?? 'OWNER_INPUT',
    sourceStepRunId: i.sourceStepRunId ?? null,
    isStartCondition: i.isStartCondition ?? true,
    valueHash: i.value === undefined || i.value === null ? NULL_VALUE_HASH : valueHash(i.value),
  }));
  const startHashes: Record<string, string> = {};
  for (const row of rows) if (row.isStartCondition) startHashes[row.inputKey] = row.valueHash;
  const run = await prisma.stepRun.create({
    data: {
      candidateId: input.candidateId,
      stepCode: input.stepCode,
      version,
      executionMode: 'STEP',
      settingsSnapshotId,
      status: input.status,
      failureKind: input.status === 'FAILED' ? 'EXTERNAL_API' : null,
      errorCode: input.status === 'FAILED' ? 'FIXTURE' : null,
      errorMessage: input.status === 'FAILED' ? '가짜 실패(fixture)' : null,
      inputFingerprintStart: fingerprint(startHashes),
      inputFingerprintEnd: open ? null : fingerprint(startHashes),
      waitingSince: input.status === 'WAITING_INPUT' ? (input.waitingSince ?? startedAt) : null,
      waitSecondsTotal: input.waitSecondsTotal ?? 0,
      startedAt,
      endedAt: open ? null : startedAt,
    },
  });
  if (rows.length > 0) {
    await prisma.stepRunInput.createMany({
      data: rows.map((row) => ({ ...row, stepRunId: run.id })),
    });
  }
  if (input.makeCurrent ?? true) {
    await prisma.candidateStep.update({
      where: { id: step.id },
      data: {
        currentStepRunId: run.id,
        status: input.status,
        lastVersion: Math.max(step.lastVersion, version),
        staleInputs: [],
        staleSince: null,
      },
    });
  }
  return run;
}
