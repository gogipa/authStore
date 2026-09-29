/**
 * 시계(주입 토큰): 지금 시각과 기다리기. 외부 호출 간격·하루 상한·24시간 쉼·토큰 만료가 쓴다.
 * 테스트는 `overrideProvider(CLOCK).useValue(fakeClock)`로 시간을 옮긴다.
 */
export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(0, ms));
    }),
};
