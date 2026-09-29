/**
 * 한국 시간(Asia/Seoul) 날짜 계산. 한국은 서머타임이 없어 UTC+9 고정으로 계산한다.
 * - call_log·user_action_log의 kst_date(CHECK ck_call_log_kst·ck_ual_kst)
 * - 하루 상한 409의 Retry-After(다음 KST 0시까지 남은 초)
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 그 시각의 한국 날짜 'YYYY-MM-DD'. */
export function toKstDate(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Prisma `@db.Date` 열에 넣을 값. 날짜만 쓰이므로 그 한국 날짜의 UTC 0시 Date로 준다
 * (Prisma가 UTC 날짜 부분을 그대로 보낸다).
 */
export function toKstDateValue(date: Date): Date {
  return new Date(`${toKstDate(date)}T00:00:00.000Z`);
}

/** 그 시각이 속한 한국 날짜의 0시(UTC 시각). */
export function startOfKstDay(date: Date): Date {
  const kstMs = date.getTime() + KST_OFFSET_MS;
  return new Date(Math.floor(kstMs / DAY_MS) * DAY_MS - KST_OFFSET_MS);
}

/** 다음 한국 0시(UTC 시각). 정확히 0시면 그다음 날 0시. */
export function nextKstMidnight(date: Date): Date {
  return new Date(startOfKstDay(date).getTime() + DAY_MS);
}

/** 다음 한국 0시까지 남은 초(올림, 최소 1). Retry-After에 쓴다. */
export function secondsUntilNextKstMidnight(now: Date): number {
  return Math.max(1, Math.ceil((nextKstMidnight(now).getTime() - now.getTime()) / 1000));
}

/** 화면 문구용 한국 시각 'YYYY-MM-DD HH:mm'. */
export function formatKstDateTime(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ');
}
