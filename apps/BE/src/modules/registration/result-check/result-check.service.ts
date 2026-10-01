import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { Registration } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { CandidateStatusService } from '../../step-engine/candidates/candidate-status.service.js';
import { StepEngineTransactions } from '../../step-engine/candidates/step-engine-tx.js';
import type { CandidateStatus } from '../../step-engine/domain/steps.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { DuplicateService } from '../duplicate/duplicate.service.js';
import {
  registrationChangedEvent,
  registrationStatusText,
  type RegistrationFailureKind,
  type RegistrationStatus,
} from '../register/registration-record.js';

/** 05-2 RegistrationResultCheck */
export interface RegistrationResultCheckView {
  registrationId: number;
  found: boolean;
  status: RegistrationStatus;
  originProductNo: string | null;
  channelProductNo: string | null;
  lastResultCheckAt: string;
  failedAt: string | null;
  failureKind: RegistrationFailureKind | null;
  candidateStatus: CandidateStatus;
}

const MAX_ID = 2_147_483_647;

/** 경로 registrationId: 1 이상 int4 정수가 아니면 그런 기록은 없다(404 REGISTRATION_NOT_FOUND — 후보 id와 같은 규칙) */
export function parseRegistrationId(raw: unknown): number {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text) && Number(text) <= MAX_ID) {
    return Number(text);
  }
  throw new ApiException('REGISTRATION_NOT_FOUND');
}

function assertCheckable(row: Pick<Registration, 'status' | 'failedAt' | 'failureKind'>): void {
  if (row.status === 'RESULT_CHECK_REQUIRED' && row.failedAt === null) return;
  throw new ApiException('REGISTRATION_STATUS_INVALID', {
    message: formatErrorMessage('REGISTRATION_STATUS_INVALID', {
      상태: registrationStatusText(row),
    }),
    details: { status: row.status, failureKind: row.failureKind },
  });
}

/**
 * 결과확인 조회(P4-03 §5 `result-check/result-check.service.ts`, 규칙 9, F-AP-31, US-20 AC4·US-29 AC3, 05-2 `checkRegistrationResult`).
 * 결과확인필요이고 종결되지 않은 기록만(아니면 409 `REGISTRATION_STATUS_INVALID`) **후보 현재 값이 아니라 `registration.
 * seller_management_code`**로 커머스API 상품 검색(SELLER_CODE)을 한다(동기).
 * - 찾으면: 기록 `REGISTERED` + 상품 번호(채널 번호는 응답에 없으면 NULL) + registered_at, 후보 `REGISTERED`(`SELLER_CODE_FOUND`)
 * - 없으면: 기록 `failed_at`·`failure_kind=NOT_FOUND_ON_CHECK`(상태는 결과확인필요 그대로 — `ck_reg_failure_kind`), 후보
 *   `AWAITING_APPROVAL`(`SELLER_CODE_NOT_FOUND`) — 다시 승인할 수 있다
 * - `last_result_check_at`은 답을 받은 조회마다 적는다. 닫힌 ⑨ StepRun과 `candidate_step`(REGISTER)은 바꾸지 않는다(ERD 대응 ⑤)
 * - 키 없음 409 `SECRET_NOT_CONFIGURED`, 외부 실패 502 `EXTERNAL_API_ERROR`(`details.target=COMMERCE_API`)·`COMMERCE_AUTH_FAILED` —
 *   아무것도 바꾸지 않는다(Proposed: 실패한 조회는 last_result_check_at도 그대로)
 * - 같은 기록의 조회가 겹치면 한 번만 부르고 결과를 같이 준다. 앱 재시작 자동 조회(F-BS-18 — `RegistrationRestartCheck`)도 이것을 쓴다
 */
@Injectable()
export class ResultCheckService {
  private readonly inFlight = new Map<number, Promise<RegistrationResultCheckView>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly duplicates: DuplicateService,
    private readonly events: ProgressEventsService,
  ) {}

  check(registrationId: number): Promise<RegistrationResultCheckView> {
    const running = this.inFlight.get(registrationId);
    if (running) return running;
    const task = this.checkOnce(registrationId).finally(() => {
      if (this.inFlight.get(registrationId) === task) this.inFlight.delete(registrationId);
    });
    this.inFlight.set(registrationId, task);
    return task;
  }

  private async checkOnce(registrationId: number): Promise<RegistrationResultCheckView> {
    const row = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { stepRun: { select: { candidateId: true } } },
    });
    if (!row) throw new ApiException('REGISTRATION_NOT_FOUND');
    assertCheckable(row);
    const candidateId = row.stepRun.candidateId;
    const search = await this.duplicates.searchSellerCode(row.sellerManagementCode, {
      candidateId,
      stepRunId: row.stepRunId,
    });
    return this.transactions.run(async (scope) => {
      await this.guard.lockForUpdate(scope.tx, candidateId);
      const current = await scope.tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      assertCheckable(current);
      const product = search.product;
      const updated = await scope.tx.registration.update({
        where: { id: registrationId },
        data: product
          ? {
              status: 'REGISTERED',
              originProductNo: product.originProductNo,
              channelProductNo: product.channelProductNo,
              registeredAt: scope.now,
              lastResultCheckAt: scope.now,
            }
          : {
              failedAt: scope.now,
              failureKind: 'NOT_FOUND_ON_CHECK',
              lastResultCheckAt: scope.now,
            },
      });
      const candidate = await scope.tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
      const change = product
        ? ({ toStatus: 'REGISTERED', reason: 'SELLER_CODE_FOUND' } as const)
        : ({ toStatus: 'AWAITING_APPROVAL', reason: 'SELLER_CODE_NOT_FOUND' } as const);
      let candidateStatus = candidate.status as CandidateStatus;
      if (candidate.status !== change.toStatus) {
        candidateStatus = (
          await this.status.transition(scope, candidate, change, {
            stepRunId: row.stepRunId,
            registrationId,
          })
        ).toStatus;
      }
      scope.afterCommit(() => {
        this.events.publish(
          'registration.status-changed',
          registrationChangedEvent(updated, candidateId, candidateStatus),
        );
      });
      return {
        registrationId,
        found: product !== null,
        status: updated.status as RegistrationStatus,
        originProductNo: updated.originProductNo,
        channelProductNo: updated.channelProductNo,
        lastResultCheckAt: scope.now.toISOString(),
        failedAt: updated.failedAt?.toISOString() ?? null,
        failureKind: (updated.failureKind as RegistrationFailureKind | null) ?? null,
        candidateStatus,
      };
    });
  }
}

/** 앱 재시작 뒤 결과확인필요 기록 자동 조회 켜기(DI — e2e는 끈다) */
export const REGISTRATION_RESTART_CHECK = Symbol('REGISTRATION_RESTART_CHECK');
export interface RegistrationRestartCheckOptions {
  enabled: boolean;
}

/**
 * 앱 재시작 자동 결과확인(F-BS-18, US-29 AC3 — P1-05 재시작 정리가 끝난 뒤). 재시작 정리(⑨ `onInterrupted`)가 '등록요청중'을
 * 결과확인필요로 바꾸면, 아직 한 번도 조회하지 않은(`last_result_check_at` NULL) 결과확인필요 기록(종결 전)을 차례로
 * `ResultCheckService.check`로 조회한다. 앱 시작을 막지 않는다(뒤에서 돈다). 키 없음·외부 실패면 그대로 두고 로그만 남긴다(오너가
 * 화면의 '결과 확인'으로 다시 한다).
 */
@Injectable()
export class RegistrationRestartCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(RegistrationRestartCheck.name);
  private running: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: StepEngineApi,
    private readonly checks: ResultCheckService,
    @Inject(REGISTRATION_RESTART_CHECK)
    private readonly options: RegistrationRestartCheckOptions,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.options.enabled) return;
    this.running = this.api
      .whenRestartRecovered()
      .then(async () => {
        await this.runOnce();
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error }, '재시작 뒤 결과확인 조회를 하지 못했습니다');
      });
  }

  /** 테스트·종료 대기 */
  whenDone(): Promise<void> {
    return this.running ?? Promise.resolve();
  }

  async runOnce(): Promise<number[]> {
    const rows = await this.prisma.registration.findMany({
      where: { status: 'RESULT_CHECK_REQUIRED', failedAt: null, lastResultCheckAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    const done: number[] = [];
    for (const { id } of rows) {
      try {
        await this.checks.check(id);
        done.push(id);
      } catch (error) {
        this.logger.warn(
          `재시작 뒤 등록 기록 #${id} 결과 확인을 하지 못했습니다(화면의 '결과 확인'으로 다시 해 주세요): ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return done;
  }
}
