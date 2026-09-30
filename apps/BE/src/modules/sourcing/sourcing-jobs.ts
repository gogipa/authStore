import type { Logger } from '@nestjs/common';

/**
 * ② 입력 대기 중 백그라운드 작업(앵커 뒤 분류·page 2·페이지 조회 반복, 재고 확인) 묶음. 프로세스 안에서만 돈다(M1 단일
 * 프로세스). 테스트는 `whenIdle()`로 끝날 때까지 기다린다. 작업 오류는 로그로만 남긴다(HTTP는 이미 202로 끝났다).
 */
export class BackgroundJobs {
  private readonly pending = new Set<Promise<void>>();

  constructor(private readonly logger: Logger) {}

  run(label: string, job: () => Promise<void>): void {
    const promise = (async () => {
      try {
        await job();
      } catch (error) {
        if (error instanceof JobStopped) {
          this.logger.log(`${label}: ${error.message}`);
          return;
        }
        this.logger.error({ err: error }, `${label} 작업이 실패했습니다`);
      }
    })();
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise));
  }

  /** 지금 도는 작업(과 그 작업이 이어 건 작업)이 모두 끝날 때까지 */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }
}

/** 작업 중 ② 버전이 닫히거나(선택·다시 실행) 후보를 바꿀 수 없게 되어 멈춘다 — 오류가 아니다 */
export class JobStopped extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'JobStopped';
  }
}
