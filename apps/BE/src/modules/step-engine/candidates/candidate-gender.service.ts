import { Inject, Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import {
  CANDIDATE_INPUT_KEYS,
  GENDER_PROPAGATION_STEPS,
  GENDER_READER_STEPS,
  READY_REQUIRED_STATUSES,
  type StepCode,
  type StepStatus,
} from '../domain/steps.js';
import { GENDER_INPUT_LISTENERS, type GenderInputListener } from '../ports/gender-input.port.js';
import { CandidateGuardService } from './candidate-guard.service.js';
import { CandidateStatusService } from './candidate-status.service.js';
import { StepEngineTransactions, type StepEngineTx } from './step-engine-tx.js';

export type CandidateGender = 'MALE' | 'FEMALE';

/** 05-2 CandidateGenderResult */
export interface CandidateGenderResult {
  candidateId: number;
  gender: CandidateGender;
  genderSource: 'OWNER';
  genderRecheckRequired: boolean;
  changed: boolean;
  affectedSteps: StepCode[];
  resumedStepRunIds: number[];
}

/** ② 자동 판단 적용 결과 */
export interface Step2GenderResult {
  gender: CandidateGender | null;
  genderSource: 'STEP2' | 'OWNER' | null;
  genderRecheckRequired: boolean;
  changed: boolean;
  affectedSteps: StepCode[];
}

/**
 * 성별이 바뀌었을 때 '재실행 필요'로 둘 수 있는 단계 상태. 현재 버전이 있는 단계만(미실행 제외).
 * 실행 중은 앞에서 409로 막는다. 실패는 이미 다시 실행해야 하고 실패 종류를 가리지 않도록 그대로 둔다(Proposed).
 */
const STALEABLE: readonly StepStatus[] = ['COMPLETED', 'WAITING_INPUT', 'RERUN_REQUIRED'];

/**
 * 후보 성별(F-CW-08, 규칙 10). 성별은 후보 필드 하나(값 + 출처 STEP2·OWNER)다.
 * - 오너 입력(PUT …/gender): MALE·FEMALE만. 출처 OWNER, 재확인 필요 해제. 값이 바뀌면 현재 버전이 있는
 *   PRICING·NOTICE_HTML·TAGS를 재실행 필요(stale_inputs에 candidate.gender)로 두고 affectedSteps로 알린다.
 * - ② 자동 값(`applyStep2Gender`, P2-03이 부른다): OWNER 값은 덮어쓰지 않고 판단이 다르면 재확인 필요, STEP2 값은 바꾼다.
 */
@Injectable()
export class CandidateGenderService {
  constructor(
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly audit: UserActionLogService,
    private readonly events: ProgressEventsService,
    @Inject(GENDER_INPUT_LISTENERS) private readonly listeners: GenderInputListener[],
  ) {}

  /** 오너 성별 입력(PUT /candidates/{candidateId}/gender) */
  setOwnerGender(candidateId: number, gender: CandidateGender): Promise<CandidateGenderResult> {
    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      const steps = await this.guard.loadSteps(scope.tx, candidateId);
      this.guard.assertNoRunningStep(steps, GENDER_READER_STEPS);

      const changed = candidate.gender !== gender;
      const needsWrite =
        changed || candidate.genderSource !== 'OWNER' || candidate.genderRecheckRequired;
      if (needsWrite) {
        await scope.tx.candidate.update({
          where: { id: candidateId },
          data: { gender, genderSource: 'OWNER', genderRecheckRequired: false },
        });
      }
      const affectedSteps = changed ? await this.markGenderStale(scope, candidateId) : [];
      if (needsWrite) {
        await this.audit.record(
          {
            eventType: 'OWNER_EDITED',
            candidateId,
            detail: {
              inputKey: CANDIDATE_INPUT_KEYS.gender,
              from: candidate.gender,
              to: gender,
              affectedSteps,
            },
            occurredAt: scope.now,
          },
          scope.tx,
        );
      }
      const resumedStepRunIds: number[] = [];
      for (const listener of this.listeners) {
        resumedStepRunIds.push(...(await listener.onOwnerGender(scope, { candidateId, gender })));
      }
      if (changed) await this.status.reevaluate(scope, candidateId);
      return {
        candidateId,
        gender,
        genderSource: 'OWNER' as const,
        genderRecheckRequired: false,
        changed,
        affectedSteps,
        resumedStepRunIds,
      };
    });
  }

  /**
   * ②가 판단한 성별을 후보에 적용한다(② 실행을 끝내는 트랜잭션 안에서, P2-03).
   * - 출처 OWNER: 값을 덮어쓰지 않는다. ② 판단이 있고 다르면 재확인 필요 true, 같으면 false.
   * - 출처 STEP2·없음: ② 값으로 바꾼다(판단 불가면 NULL). 값이 바뀌면 PRICING·NOTICE_HTML·TAGS를 재실행 필요로.
   *   승인대기·검증완료 후보를 NULL로 비울 때는 ck_candidate_ready 때문에 먼저 작업중(STEP_NOT_CURRENT)으로 되돌린다.
   */
  async applyStep2Gender(
    scope: StepEngineTx,
    candidateId: number,
    detected: CandidateGender | null,
  ): Promise<Step2GenderResult> {
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    if (candidate.genderSource === 'OWNER') {
      const recheck = detected !== null && detected !== candidate.gender;
      if (recheck !== candidate.genderRecheckRequired) {
        await scope.tx.candidate.update({
          where: { id: candidateId },
          data: { genderRecheckRequired: recheck },
        });
      }
      return {
        gender: candidate.gender as CandidateGender,
        genderSource: 'OWNER',
        genderRecheckRequired: recheck,
        changed: false,
        affectedSteps: [],
      };
    }
    const changed = candidate.gender !== detected;
    if (
      detected === null &&
      changed &&
      (READY_REQUIRED_STATUSES as readonly string[]).includes(candidate.status)
    ) {
      // ck_candidate_ready: 승인대기 이상은 gender NOT NULL이다. 성별을 비우기 전에 작업중으로 되돌린다.
      await this.status.transition(scope, candidate, {
        toStatus: 'WORKING',
        reason: 'STEP_NOT_CURRENT',
      });
    }
    if (changed || candidate.genderSource !== (detected === null ? null : 'STEP2')) {
      await scope.tx.candidate.update({
        where: { id: candidateId },
        data: {
          gender: detected,
          genderSource: detected === null ? null : 'STEP2',
          genderRecheckRequired: false,
        },
      });
    }
    const affectedSteps = changed ? await this.markGenderStale(scope, candidateId) : [];
    if (changed) await this.status.reevaluate(scope, candidateId);
    return {
      gender: detected,
      genderSource: detected === null ? null : 'STEP2',
      genderRecheckRequired: false,
      changed,
      affectedSteps,
    };
  }

  /** 성별을 읽는 단계 중 현재 버전이 있는 PRICING·NOTICE_HTML·TAGS를 재실행 필요로 두고, 커밋 뒤 SSE로 알린다 */
  private async markGenderStale(scope: StepEngineTx, candidateId: number): Promise<StepCode[]> {
    const rows = await scope.tx.candidateStep.findMany({
      where: { candidateId, stepCode: { in: [...GENDER_PROPAGATION_STEPS] } },
    });
    const affected: StepCode[] = [];
    for (const code of GENDER_PROPAGATION_STEPS) {
      const row = rows.find((r) => r.stepCode === code);
      if (!row || !STALEABLE.includes(row.status as StepStatus)) continue;
      const staleInputs = row.staleInputs.includes(CANDIDATE_INPUT_KEYS.gender)
        ? row.staleInputs
        : [...row.staleInputs, CANDIDATE_INPUT_KEYS.gender];
      const staleSince = row.staleSince ?? scope.now;
      await scope.tx.candidateStep.update({
        where: { id: row.id },
        data: { status: 'RERUN_REQUIRED', staleInputs, staleSince },
      });
      affected.push(code);
      scope.afterCommit(() => {
        this.events.publish('candidate-step.changed', {
          candidateId,
          stepCode: code,
          status: 'RERUN_REQUIRED',
          currentStepRunId: row.currentStepRunId,
          staleInputs,
          staleSince: staleSince.toISOString(),
        });
      });
    }
    return affected;
  }
}
