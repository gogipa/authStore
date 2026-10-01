import { Injectable } from '@nestjs/common';

/**
 * 앱 전체 업로드 직렬 큐(P4-01 §5 `upload-queue.ts`, 규칙 8·NFR-05). 설치본은 스토어 1개라 커머스API 이미지 업로드는 앱 전체에서 한
 * 번에 1건만 보낸다 — 다른 후보의 ⑧도 같은 줄에 선다. 앞 일이 실패해도 다음 일은 돈다.
 * 줄은 프로세스 메모리다(재시작하면 비고, 실행 중이던 ⑧은 P1-05 재시작 정리가 '실패(중단됨)'로 바꾼다 — 다시 실행하면 해시
 * 재사용으로 이미 올린 파일은 건너뛴다).
 */
@Injectable()
export class UploadQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private waiting = 0;

  /** `fn`을 줄 끝에 넣고 차례가 오면 돌린다(동시 1건). 결과·예외는 그대로 돌려준다 */
  run<T>(fn: () => Promise<T>): Promise<T> {
    this.waiting += 1;
    const result = this.tail.then(fn);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.tail = settled.then(() => {
      this.waiting -= 1;
    });
    return result;
  }

  /** 줄에 남은 일(실행 중 포함) 수 */
  get pending(): number {
    return this.waiting;
  }

  /** 줄이 빌 때까지 기다린다(테스트·종료용) */
  async whenIdle(): Promise<void> {
    while (this.waiting > 0) await this.tail;
  }
}
