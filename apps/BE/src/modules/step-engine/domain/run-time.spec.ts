import { automaticProcessingSeconds, endTimeFor, waitedSeconds } from './run-time.js';

describe('단계 실행 시간(F-BS-22, 규칙 13)', () => {
  const at = (hhmm: string) => new Date(`2026-09-28T${hhmm}:00+09:00`);

  it('시작 10:00, 끝 10:05, 대기 120초 → 자동 처리 180초', () => {
    expect(
      automaticProcessingSeconds({
        startedAt: at('10:00'),
        endedAt: at('10:05'),
        waitSecondsTotal: 120,
      }),
    ).toBe(180);
  });

  it('끝나지 않은 실행은 null, 음수는 0', () => {
    expect(
      automaticProcessingSeconds({ startedAt: at('10:00'), endedAt: null, waitSecondsTotal: 0 }),
    ).toBeNull();
    expect(
      automaticProcessingSeconds({
        startedAt: at('10:00'),
        endedAt: at('10:01'),
        waitSecondsTotal: 600,
      }),
    ).toBe(0);
  });

  it('입력 대기 초는 내림, 대기 시작이 없으면 0', () => {
    expect(waitedSeconds(at('10:00'), new Date(at('10:02').getTime() + 999))).toBe(120);
    expect(waitedSeconds(null, at('10:02'))).toBe(0);
    expect(waitedSeconds(at('10:05'), at('10:00'))).toBe(0);
  });

  it('끝 시각은 시작보다 앞설 수 없다(ck_step_run_time)', () => {
    expect(endTimeFor(at('10:05'), at('10:00'))).toEqual(at('10:05'));
    expect(endTimeFor(at('10:00'), at('10:05'))).toEqual(at('10:05'));
  });
});
