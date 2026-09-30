/**
 * 단계 실행 시간(F-BS-22, NFR-01, ERD step_run.started_at·ended_at·waiting_since·wait_seconds_total).
 * 자동 처리 시간 = (ended_at − started_at) − wait_seconds_total(입력 대기 누적 초).
 */

/** 입력 대기 시작부터 지금까지 초(내림, 음수면 0) */
export function waitedSeconds(waitingSince: Date | null, now: Date): number {
  if (!waitingSince) return 0;
  return Math.max(0, Math.floor((now.getTime() - waitingSince.getTime()) / 1000));
}

/** 자동 처리 초. 아직 끝나지 않았으면 null. 음수면 0 */
export function automaticProcessingSeconds(run: {
  startedAt: Date;
  endedAt: Date | null;
  waitSecondsTotal: number;
}): number | null {
  if (!run.endedAt) return null;
  const total = Math.floor((run.endedAt.getTime() - run.startedAt.getTime()) / 1000);
  return Math.max(0, total - run.waitSecondsTotal);
}

/** 끝 시각: ck_step_run_time(ended_at ≥ started_at)이 PC 시계가 뒤로 가도 깨지지 않게 */
export function endTimeFor(startedAt: Date, now: Date): Date {
  return now.getTime() < startedAt.getTime() ? startedAt : now;
}
