import { toKstDate } from '../../common/time/kst.js';

/**
 * 수집 기간(F-KW-03, PRD §8.1, P2-01 규칙 5). 순수 함수.
 * - 종료일 = 어제(Asia/Seoul — 서버 시간대가 아니다. KST 0~9시에 UTC 날짜를 쓰면 하루 틀린다)
 * - 시작일 = 종료일의 달력 기준 1개월 전. 그 달에 같은 날이 없으면 그 달 마지막 날(Proposed: 3/31 → 2/28·2/29)
 * - `timeUnit=date`는 요청 조립(integrations/datalab)이 고정한다
 */
export interface CollectionPeriod {
  /** 'YYYY-MM-DD' */
  startDate: string;
  /** 'YYYY-MM-DD' */
  endDate: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** 'YYYY-MM-DD'의 달력 기준 1개월 전(없는 날은 그 달 마지막 날로) */
export function minusOneCalendarMonth(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  const day = Math.min(d, daysInMonth(year, month));
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 지금 시각 기준 수집 기간. 예: 2026-09-24T00:30+09:00(UTC 9/23) → 2026-08-23 ~ 2026-09-23 */
export function collectionPeriod(now: Date): CollectionPeriod {
  const endDate = toKstDate(new Date(now.getTime() - DAY_MS));
  return { startDate: minusOneCalendarMonth(endDate), endDate };
}

const RANGE_RE =
  /^\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*~\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?\s*$/;

/** 응답 range('2026.08.23. ~ 2026.09.23.')를 기간으로 읽는다. 모양이 다르면 null */
export function parseDatalabRange(range: string): CollectionPeriod | null {
  const m = RANGE_RE.exec(range);
  if (!m) return null;
  const [, y1, m1, d1, y2, m2, d2] = m;
  return {
    startDate: `${y1}-${pad2(Number(m1))}-${pad2(Number(d1))}`,
    endDate: `${y2}-${pad2(Number(m2))}-${pad2(Number(d2))}`,
  };
}

/**
 * range와 요청 기간을 맞춰 본다(F-KW-03). 같으면 true, 다르거나 읽을 수 없으면 false.
 * 불일치여도 수집은 멈추지 않고 `range_matched=false`로 표시만 한다(Proposed, 기본안).
 */
export function rangeMatches(range: string, period: CollectionPeriod): boolean {
  const parsed = parseDatalabRange(range);
  return (
    parsed !== null && parsed.startDate === period.startDate && parsed.endDate === period.endDate
  );
}
