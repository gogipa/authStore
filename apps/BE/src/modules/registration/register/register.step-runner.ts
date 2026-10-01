import { Injectable } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import {
  StepRunnerFor,
  type CandidateStatusEffect,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepPersistHooks,
  type StepRunner,
  type StepRunRow,
  type Tx,
} from '../../step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import type { StepCode } from '../../step-engine/domain/steps.js';
import { registrationChangedEvent } from './registration-record.js';

/** ⑨ 입력(PRD §5.3 '②~⑧ 현재 버전' — step-engine STEP_INPUT_SPECS.REGISTER와 같은 순서) */
export const REGISTER_INPUTS: readonly (readonly [string, StepCode])[] = [
  [INPUT_KEYS.sourcingSelection, 'SOURCING'],
  [INPUT_KEYS.pricingJudgement, 'PRICING'],
  [INPUT_KEYS.categoryLeafPath, 'CATEGORY'],
  [INPUT_KEYS.thumbnailSelection, 'THUMBNAIL'],
  [INPUT_KEYS.copyDraft, 'COPY'],
  [INPUT_KEYS.noticeRawFacts, 'NOTICE_RAW'],
  [INPUT_KEYS.noticeHtmlHtml, 'NOTICE_HTML'],
  [INPUT_KEYS.tagsFinal, 'TAGS'],
  [INPUT_KEYS.uploadResult, 'UPLOAD'],
];

/** 재시작으로 응답을 받지 못한 등록 기록의 안내(Proposed) */
export const RESTART_UNKNOWN = {
  errorCode: 'APP_RESTART',
  errorMessage:
    '앱이 꺼져 등록 결과를 받지 못했습니다. 판매자관리코드로 커머스API에서 결과를 확인합니다.',
} as const;

/**
 * ⑨ REGISTER 실행기(P4-03 — step-engine 규약의 자리만 채운다). ⑨는 단계 실행 API·연속 실행으로 돌지 않는다(엔진이 422
 * INVALID_STEP_CODE NOT_RUNNABLE — 규칙 15). G4 승인(`ApproveService`)이 `StepEngineApi.openRegisterRun`·`closeRegisterRun`으로
 * 버전을 열고 닫고, 등록 기록(`registration`)은 registration이 직접 쓴다(이 실행기의 `persist`는 쓰지 않는다).
 * - `readInputs`: ②~⑧ 현재 완료 버전 id(시작 지문 — 승인 때 어느 버전으로 등록했는지)
 * - `onInterrupted`(F-BS-18, ERD `registration` 대응 ④): 앱이 꺼질 때 RUNNING이던 ⑨ — 등록요청중(종결 전) 기록이면
 *   결과확인필요로 바꾸고 후보도 결과확인필요(APP_RESTART). `request_sent_at`이 NULL이어도 같다(보냈는지 모른다 → 조회부터).
 *   기록이 없으면 후보를 승인대기(RESTART_REVERTED)로 되돌린다. 조회는 앱 시작 뒤 `RegistrationRestartCheck`가 한다
 */
@StepRunnerFor('REGISTER')
@Injectable()
export class RegisterStepRunner implements StepRunner {
  readonly stepCode = 'REGISTER' as const;
  readonly usesAi = false;

  constructor(private readonly events: ProgressEventsService) {}

  readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    return Promise.resolve(
      REGISTER_INPUTS.map(([inputKey, stepCode]) => {
        const stepRunId = ctx.completedRunId(stepCode);
        return {
          inputKey,
          sourceType: 'PREV_STEP' as const,
          sourceStepRunId: stepRunId,
          isStartCondition: true,
          required: true,
          value: stepRunId === null ? null : { stepRunId },
        };
      }),
    );
  }

  run(): Promise<StepOutcome> {
    return Promise.reject(
      new Error('⑨ 등록은 최종 승인(G4)으로만 돈다(단계 실행 대기열에 넣지 않는다)'),
    );
  }

  /** 등록 기록은 승인·결과 반영이 직접 쓴다 */
  persist(): Promise<void> {
    return Promise.resolve();
  }

  copyOutput(): Promise<void> {
    return Promise.reject(new Error('⑨ 등록 기록은 복사하지 않는다(오너 수정 없음)'));
  }

  async onInterrupted(
    tx: Tx,
    run: StepRunRow,
    hooks?: StepPersistHooks,
  ): Promise<CandidateStatusEffect | null> {
    const candidate = await tx.candidate.findUniqueOrThrow({ where: { id: run.candidateId } });
    const registration = await tx.registration.findUnique({ where: { stepRunId: run.id } });
    if (!registration) {
      return candidate.status === 'REGISTERING'
        ? { toStatus: 'AWAITING_APPROVAL', reason: 'RESTART_REVERTED' }
        : null;
    }
    if (registration.status !== 'REGISTERING' || registration.failedAt !== null) return null;
    const updated = await tx.registration.update({
      where: { id: registration.id },
      data: {
        status: 'RESULT_CHECK_REQUIRED',
        errorCode: RESTART_UNKNOWN.errorCode,
        errorMessage: RESTART_UNKNOWN.errorMessage,
      },
    });
    hooks?.afterCommit(() => {
      this.events.publish(
        'registration.status-changed',
        registrationChangedEvent(updated, run.candidateId, 'RESULT_CHECK_REQUIRED'),
      );
    });
    return {
      toStatus: 'RESULT_CHECK_REQUIRED',
      reason: 'APP_RESTART',
      registrationId: registration.id,
    };
  }
}
