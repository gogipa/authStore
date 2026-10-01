import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { RegistrationSwitch } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { CandidateStatusService } from '../../step-engine/candidates/candidate-status.service.js';
import { StepEngineTransactions, type Db } from '../../step-engine/candidates/step-engine-tx.js';

/** 05-2 RegistrationSwitchState */
export interface RegistrationSwitchState {
  apiBlocked: boolean;
  changedAt: string;
}

/** 05-2 RegistrationSwitchChanged */
export interface RegistrationSwitchChanged extends RegistrationSwitchState {
  revertedCandidateIds: number[];
}

const stateOf = (row: RegistrationSwitch): RegistrationSwitchState => ({
  apiBlocked: row.apiBlocked,
  changedAt: row.changedAt.toISOString(),
});

/**
 * 등록 API 차단 스위치(P4-03 규칙 12, F-AP-28, US-23 AC1, 05-2 `getRegistrationSwitch`·`putRegistrationSwitch`, ERD `registration_switch`).
 * - 설치본당 1행(`singleton_key=1`). 행이 없으면 처음 읽을 때 기본값(켬 — 실제 스토어이고 샌드박스가 없다)으로 만든다(Proposed —
 *   마이그레이션 시드 대신. e2e TRUNCATE 뒤에도 같다)
 * - `PUT`이 같은 값이면 아무것도 바꾸지 않고 200(`revertedCandidateIds=[]`, 기록·SSE 없음)
 * - 끄면(`apiBlocked=false`) 한 트랜잭션에서 `VALIDATED` 후보를 모두 `AWAITING_APPROVAL`(`BLOCK_SWITCH_OFF`, 이력에 그 후보의 마지막
 *   검증완료 기록 id)로 되돌리고 `user_action_log`(SETTING_CHANGED)를 남긴다. 등록요청중 기록이 있어도 막지 않는다(이미 보낸 요청은
 *   결과를 그대로 반영하고, 스위치는 다음 승인부터 — x-decision §7.5-40)
 * - 바뀌면 커밋 뒤 SSE `registration-switch.changed`(되돌린 후보는 전이 함수가 `candidate.status-changed`를 따로 보낸다)
 */
@Injectable()
export class RegistrationSwitchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly audit: UserActionLogService,
    private readonly events: ProgressEventsService,
  ) {}

  /** 단일 행(없으면 기본값 켬으로 만든다) */
  async ensureRow(db: Db = this.prisma): Promise<RegistrationSwitch> {
    return db.registrationSwitch.upsert({
      where: { singletonKey: 1 },
      create: { singletonKey: 1, apiBlocked: true },
      update: {},
    });
  }

  async get(): Promise<RegistrationSwitchState> {
    return stateOf(await this.ensureRow());
  }

  async put(apiBlocked: boolean): Promise<RegistrationSwitchChanged> {
    await this.ensureRow();
    return this.transactions.run(async (scope) => {
      const [locked] = await scope.tx.$queryRaw<{ id: number }[]>`
        SELECT id FROM registration_switch WHERE singleton_key = 1 FOR UPDATE`;
      const row = await scope.tx.registrationSwitch.findUniqueOrThrow({
        where: { id: locked!.id },
      });
      if (row.apiBlocked === apiBlocked) return { ...stateOf(row), revertedCandidateIds: [] };
      const updated = await scope.tx.registrationSwitch.update({
        where: { id: row.id },
        data: { apiBlocked, changedAt: scope.now },
      });
      const reverted: number[] = [];
      if (!apiBlocked) {
        const validated = await scope.tx.candidate.findMany({
          where: { status: 'VALIDATED' },
          orderBy: { id: 'asc' },
          select: { id: true },
        });
        for (const { id } of validated) {
          const candidate = await this.guard.lockForUpdate(scope.tx, id);
          if (candidate.status !== 'VALIDATED') continue;
          const last = await scope.tx.registration.findFirst({
            where: { stepRun: { candidateId: id }, status: 'VALIDATED' },
            orderBy: { id: 'desc' },
            select: { id: true, stepRunId: true },
          });
          await this.status.transition(
            scope,
            candidate,
            { toStatus: 'AWAITING_APPROVAL', reason: 'BLOCK_SWITCH_OFF' },
            { stepRunId: last?.stepRunId ?? null, registrationId: last?.id ?? null },
          );
          reverted.push(id);
        }
      }
      await this.audit.record(
        {
          eventType: 'SETTING_CHANGED',
          detail: {
            setting: 'REGISTRATION_SWITCH',
            changedKeys: ['registrationSwitch.apiBlocked'],
            apiBlocked,
            revertedCandidateIds: reverted,
          },
          occurredAt: scope.now,
        },
        scope.tx,
      );
      const result: RegistrationSwitchChanged = {
        ...stateOf(updated),
        revertedCandidateIds: reverted,
      };
      scope.afterCommit(() => {
        this.events.publish('registration-switch.changed', result);
      });
      return result;
    });
  }
}
