import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../http/clock.token.js';
import { META_SYNC_INTERRUPTED_MESSAGE } from './commerce-meta.constants.js';

/**
 * 앱 재시작 정리(규칙 10, ERD commerce_meta_sync_run, 03-2 §4 앱 재시작): RUNNING으로 남은 행을
 * FAILED + finished_at + 중단 사유로 바꾼다. 요청을 받기 전(onApplicationBootstrap)에 끝낸다.
 * 자동 실행(스케줄러)은 `ready`를 기다린 뒤에 돈다(방금 만든 RUNNING 행을 정리하지 않게).
 */
@Injectable()
export class CommerceMetaRecovery implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommerceMetaRecovery.name);
  private resolveReady!: () => void;
  /** 재시작 정리가 끝나면(실패해도) 풀린다 */
  readonly ready: Promise<void> = new Promise((resolve) => {
    this.resolveReady = resolve;
  });

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      const count = await this.recover();
      if (count > 0) {
        this.logger.warn(`앱 재시작: 진행 중이던 메타데이터 동기화 ${count}건을 실패로 닫았습니다`);
      }
    } catch (e) {
      this.logger.error({ err: e }, '메타데이터 동기화 재시작 정리에 실패했습니다');
    } finally {
      this.resolveReady();
    }
  }

  /** RUNNING 행을 모두 FAILED로 닫는다. 닫은 수를 돌려준다 */
  async recover(): Promise<number> {
    const result = await this.prisma.commerceMetaSyncRun.updateMany({
      where: { status: 'RUNNING' },
      data: {
        status: 'FAILED',
        finishedAt: this.clock.now(),
        errorMessage: META_SYNC_INTERRUPTED_MESSAGE,
      },
    });
    return result.count;
  }
}
