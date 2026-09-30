import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import { GENERATION_ERROR_MESSAGES } from './generation-rules.js';
import { finishTimeOf, generationRunEvent } from './generation.worker.js';

/**
 * 재시작 때 생성 시도 정리(P3-02 §5.1 `generation-recovery.ts`, 규칙 7, ERD `generation_run` 목적 '앱을 다시 켤 때 RUNNING으로
 * 남은 행은 FAILED로 바꾼다', §5.5 닫힌 뒤 고치는 예외). 앱이 요청을 받기 전(onApplicationBootstrap — listen 전)에 끝낸다.
 * P1-05 재시작 정리(`RestartRecoveryService` — step_run)와 같은 때에 돈다. 생성 작업은 프로세스 안 대기열뿐이라 시작 때의
 * RUNNING은 앞 프로세스가 남긴 것이다. ⑤ step_run(입력 대기)은 그대로 둔다 — 오너가 다시 만든다.
 * 마감 값: FAILED + '앱이 꺼져 이미지 생성이 중단되었습니다. 다시 만들어 주세요.' + finished_at(시작보다 이르지 않게). 마감한
 * 시도마다 SSE `generation-run.updated`.
 */
@Injectable()
export class GenerationRecovery implements OnApplicationBootstrap {
  private readonly logger = new Logger(GenerationRecovery.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ProgressEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const closed = await this.recover();
      if (closed.length > 0) {
        this.logger.warn(
          `앱 재시작: 진행 중이던 썸네일 생성 ${closed.length}건을 실패(중단됨)로 닫았습니다`,
        );
      }
    } catch (error) {
      this.logger.error({ err: error }, '썸네일 생성 재시작 정리에 실패했습니다');
    }
  }

  /** RUNNING 시도를 모두 FAILED로 닫는다. 닫은 id */
  async recover(): Promise<number[]> {
    const running = await this.prisma.generationRun.findMany({
      where: { status: 'RUNNING' },
      orderBy: { id: 'asc' },
      include: { stepRun: { select: { candidateId: true } } },
    });
    const closed: number[] = [];
    for (const run of running) {
      const { count } = await this.prisma.generationRun.updateMany({
        where: { id: run.id, status: 'RUNNING' },
        data: {
          status: 'FAILED',
          errorMessage: GENERATION_ERROR_MESSAGES.appRestart,
          finishedAt: finishTimeOf(this.clock.now(), run.startedAt),
        },
      });
      if (count !== 1) continue;
      closed.push(run.id);
      const row = await this.prisma.generationRun.findUniqueOrThrow({ where: { id: run.id } });
      this.events.publish(
        'generation-run.updated',
        generationRunEvent(row, run.stepRun.candidateId),
      );
    }
    return closed;
  }
}
