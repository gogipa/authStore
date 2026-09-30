import { Injectable } from '@nestjs/common';

/** ALREADY_IN_PROGRESS details.job(05-3 §5.1) */
export const AI_CLI_CHECK_JOB = 'AI_CLI_CHECK';
/** ALREADY_IN_PROGRESS `{작업}` 자리(Proposed P1-11) */
export const AI_CLI_CHECK_JOB_LABEL = 'AI 엔진 점검';

/**
 * AI 엔진 점검 잠금(P1-11 규칙 9, 05-2 createAiCliCheck x-decision). 작업 행 없이 **메모리에만** 둔다 — 앱을 다시 켜면 없다.
 * `POST /ai-cli-checks`(수동·저장 전·첫 실행)와 앱 시작 점검(STARTUP)·설정 다시 읽기 뒤 점검이 같은 잠금을 쓴다(Proposed).
 * 잡은 쪽은 점검이 끝나면(오류여도) `finally`에서 푼다(§8 주의).
 */
@Injectable()
export class AiCliCheckLock {
  private held = false;

  /** 점검이 도는 중인가 */
  get busy(): boolean {
    return this.held;
  }

  /** 비어 있으면 잡고 푸는 함수를 준다(여러 번 불러도 한 번만 푼다). 잡혀 있으면 null */
  tryAcquire(): (() => void) | null {
    if (this.held) return null;
    this.held = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.held = false;
    };
  }
}
