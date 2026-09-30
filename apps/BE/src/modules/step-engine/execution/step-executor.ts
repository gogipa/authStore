import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

type Task = () => Promise<void>;

/**
 * 프로세스 안 비동기 실행(P1-05). 단계 실행 API는 시작 트랜잭션을 커밋한 뒤 202로 답하고, 실행(`runner.run` → 끝 트랜잭션)은
 * 여기 대기열에서 돈다. M1은 단계를 직렬로 처리한다(동시 1개, F-BS-22). P1-10이 `setConcurrency`로 동시 상한을 붙인다.
 * - 작업은 던지지 않게 감싼다(실패는 실행 기록 FAILED로 남기는 쪽이 처리한다).
 * - 테스트는 `sleep` 대신 `whenIdle()`로 모든 작업(작업 중에 새로 넣은 작업 포함)이 끝나기를 기다린다.
 * - 앱 재시작 때 대기열에 남은 실행은 사라지고, 재시작 정리가 RUNNING을 '실패(중단됨)'로 바꾼다.
 */
@Injectable()
export class StepExecutor implements OnApplicationShutdown {
  private readonly logger = new Logger(StepExecutor.name);
  private readonly queue: { task: Task; label: string }[] = [];
  private active = 0;
  private concurrency = 1;
  private idleWaiters: (() => void)[] = [];
  private closed = false;

  /** 동시 실행 상한(기본 1, P1-10) */
  setConcurrency(limit: number): void {
    this.concurrency = Math.max(1, Math.floor(limit));
    this.drain();
  }

  /** 작업을 대기열에 넣는다. 앱을 닫는 중이면 버린다(재시작 정리가 남은 RUNNING을 닫는다) */
  submit(task: Task, label = 'step-run'): void {
    if (this.closed) {
      this.logger.warn(`앱을 닫는 중이라 실행을 대기열에 넣지 않았습니다(${label})`);
      return;
    }
    this.queue.push({ task, label });
    this.drain();
  }

  /** 대기열과 실행 중인 작업이 모두 끝나면 풀린다 */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** 기다리는 작업 + 실행 중인 작업 수 */
  get pending(): number {
    return this.queue.length + this.active;
  }

  onApplicationShutdown(): void {
    this.closed = true;
    this.queue.length = 0;
    this.notifyIdle();
  }

  private isIdle(): boolean {
    return this.active === 0 && this.queue.length === 0;
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.active += 1;
      void this.execute(next);
    }
  }

  private async execute(entry: { task: Task; label: string }): Promise<void> {
    try {
      await entry.task();
    } catch (error) {
      this.logger.error({ err: error }, `실행 작업이 예외로 끝났습니다(${entry.label})`);
    } finally {
      this.active -= 1;
      this.drain();
      if (this.isIdle()) this.notifyIdle();
    }
  }

  private notifyIdle(): void {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }
}
