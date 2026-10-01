import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  COMMERCE_PRODUCTS_PORT,
  type CommerceProductsPort,
} from '../../integrations/naver-commerce/commerce-products.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { CandidateStatusService } from '../../step-engine/candidates/candidate-status.service.js';
import { StepEngineTransactions } from '../../step-engine/candidates/step-engine-tx.js';
import type { CandidateStatus } from '../../step-engine/domain/steps.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { registrationChangedEvent } from '../register/registration-record.js';
import { registerOutcomeOf } from './register-outcome.js';

/**
 * 등록 호출과 결과 반영(P4-03 §5 `submit/registration-submitter.ts`, 규칙 7·8, F-AP-26·29·30·33, C4 §4 '⑨ 등록').
 * G4 승인이 '등록요청중' 기록·⑨ RUNNING·후보 REGISTERING을 커밋한 **뒤** 이 실행기에 넣는다(202 응답 뒤 BE 안에서 돈다 — P1-05 실행기와
 * 같은 방식, 앱 전체 직렬). 한 건마다:
 * 1. 기록을 다시 읽어 아직 보내지 않은 '등록요청중'(종결 전·`request_sent_at` NULL)일 때만 `request_sent_at`을 적는다
 * 2. 트랜잭션 밖에서 `POST /v2/products`(⑧ 산출물의 업로드 URL이 든 `request_json` 그대로 — 이미지를 다시 올리지 않는다).
 *    응답 대기는 설정 `registration.requestTimeoutSeconds`(Proposed 기본 60초). 자동 재시도 없음
 * 3. 결과 반영 트랜잭션: 기록 UPDATE + ⑨ 닫기 + 후보 전이(P1-04 `transition` — `candidate_status_history.registration_id`) + 커밋 뒤
 *    SSE `registration.status-changed`(후보 SSE `candidate.status-changed`는 전이 함수가 보낸다)
 * 앱이 2·3 사이에 꺼지면 재시작 정리(⑨ `onInterrupted`)가 결과확인필요로 두고 판매자관리코드로 조회한다.
 */
@Injectable()
export class RegistrationSubmitter {
  private readonly logger = new Logger(RegistrationSubmitter.name);
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    private readonly api: StepEngineApi,
    private readonly settings: SettingsService,
    private readonly events: ProgressEventsService,
    @Inject(COMMERCE_PRODUCTS_PORT) private readonly products: CommerceProductsPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 등록 한 건을 줄에 넣는다(커밋 뒤에 부른다). 실패는 로그만 남긴다 */
  enqueue(registrationId: number): void {
    this.pending += 1;
    const run = this.tail.then(() => this.submit(registrationId));
    this.tail = run
      .catch((error: unknown) => {
        this.logger.error({ err: error }, `등록 기록 #${registrationId}을 처리하지 못했습니다`);
      })
      .finally(() => {
        this.pending -= 1;
      });
  }

  /** 줄이 빌 때까지 기다린다(테스트) */
  async whenIdle(): Promise<void> {
    while (this.pending > 0) await this.tail;
  }

  /** 한 건: 보낸 시각 → 등록 호출 → 결과 반영 */
  async submit(registrationId: number): Promise<void> {
    const row = await this.prisma.registration.findUnique({
      where: { id: registrationId },
      include: { stepRun: { select: { candidateId: true } } },
    });
    if (!row || row.status !== 'REGISTERING' || row.failedAt || row.requestSentAt) {
      this.logger.warn(`등록 기록 #${registrationId}은 보낼 상태가 아니라 건너뜁니다`);
      return;
    }
    const candidateId = row.stepRun.candidateId;
    const sentAt = this.clock.now();
    const claimed = await this.prisma.registration.updateMany({
      where: { id: registrationId, status: 'REGISTERING', failedAt: null, requestSentAt: null },
      data: { requestSentAt: sentAt },
    });
    if (claimed.count === 0) return;
    const timeoutMs = this.settings.current().registration.requestTimeoutSeconds * 1000;
    const result = await this.products.createProduct(row.requestJson, {
      candidateId,
      stepRunId: row.stepRunId,
      timeoutMs,
    });
    if (result.traceId) {
      this.logger.log(
        `등록 기록 #${registrationId} 결과 ${result.kind} · GNCP-GW-Trace-ID ${result.traceId}`,
      );
    }
    await this.transactions.run(async (scope) => {
      await this.guard.lockForUpdate(scope.tx, candidateId);
      const current = await scope.tx.registration.findUniqueOrThrow({
        where: { id: registrationId },
      });
      if (current.status !== 'REGISTERING' || current.failedAt) {
        this.logger.warn(`등록 기록 #${registrationId}이 이미 바뀌어 결과를 반영하지 않습니다`);
        return;
      }
      const outcome = registerOutcomeOf(result, scope.now);
      const updated = await scope.tx.registration.update({
        where: { id: registrationId },
        data: outcome.registration,
      });
      await this.api.closeRegisterRun(scope, row.stepRunId, outcome.step);
      const fresh = await scope.tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
      let candidateStatus = fresh.status as CandidateStatus;
      if (fresh.status !== outcome.candidate.toStatus) {
        const record = await this.status.transition(scope, fresh, outcome.candidate, {
          stepRunId: row.stepRunId,
          registrationId,
        });
        candidateStatus = record.toStatus;
      }
      scope.afterCommit(() => {
        this.events.publish(
          'registration.status-changed',
          registrationChangedEvent(updated, candidateId, candidateStatus),
        );
      });
    });
  }
}
