import { MINUTES_AGO, type DemoClock, type StoryKey } from '../sample/story';

const MINUTE_MS = 60_000;
const KST_OFFSET_MS = 9 * 60 * MINUTE_MS;

/** 따라 하기 흐름에 들어 있는 이야기 시각의 범위(몇 분 전). 이 밖은 앱을 켠 때·지금 기준으로 적는다 */
const FLOW_OLDEST = MINUTES_AGO.keywordsPasted;
const FLOW_NEWEST = MINUTES_AGO.switchOn;

/**
 * 체험 시계(D-32). 예시 데이터는 '몇 분 전'(이야기 시각표 `MINUTES_AGO`)으로 시각을 적는다. 따라 하기에서는 그 일이 실제로 일어난
 * 때(`times` — 모델이 마일스톤마다 남긴 실제 시각)를 써야 레일의 '마지막 실행 14:08'이 방금 한 일이 된다.
 * - 흐름 시각표보다 오래된 값(설정·키·요금표 등, 앱을 켜기 전 일): 앱을 켠 때(`start`)에서 그만큼 앞
 * - 흐름 시각표보다 최근 값(연결 점검·저장 공간 같은 '방금'): 지금에서 그만큼 앞
 * - 흐름 안: 남겨 둔 마일스톤 시각을 이야기 분 단위로 잇는다(남긴 두 시각 사이는 비례, 같은 값이면 같은 시각). 아직 안 일어난 일은
 *   지금으로 둔다(화면에 나오지 않는 값)
 */
export function createDemoClock(
  start: number,
  times: () => Readonly<Partial<Record<StoryKey, number>>>,
  now: () => number,
): DemoClock {
  /** 이야기 분 → 실제 시각(ms) */
  const timeOf = (minutes: number): number => {
    if (minutes > FLOW_OLDEST) return start - minutes * MINUTE_MS;
    if (minutes < FLOW_NEWEST) return now() - minutes * MINUTE_MS;
    const marks = Object.entries(times())
      .map(([key, at]) => ({ minutes: MINUTES_AGO[key as StoryKey], at }))
      .filter((mark) => mark.minutes <= FLOW_OLDEST && mark.minutes >= FLOW_NEWEST)
      .sort((a, b) => b.minutes - a.minutes);
    // 이 시각(m)보다 앞(오래됨, 분이 큼)·뒤(분이 작음)에서 가장 가까운 두 시각
    const before = [...marks].reverse().find((mark) => mark.minutes >= minutes);
    const after = marks.find((mark) => mark.minutes <= minutes);
    if (before && after) {
      if (before.minutes === after.minutes) return before.at;
      const ratio = (before.minutes - minutes) / (before.minutes - after.minutes);
      return before.at + ratio * (after.at - before.at);
    }
    if (before) return Math.max(before.at, now());
    if (after) return after.at;
    return now();
  };

  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    now: start,
    ago: (minutes) => iso(timeOf(minutes)),
    after: (minutes, plusMinutes) => iso(timeOf(minutes) + plusMinutes * MINUTE_MS),
    kstDate: (minutesAgo = 0) =>
      new Date(timeOf(minutesAgo) + KST_OFFSET_MS).toISOString().slice(0, 10),
  };
}
