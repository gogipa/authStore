import type { components } from '@/shared/api/schema';
import { formatKstMonthDayTime } from '@/shared/lib/format';

export type CallUsageList = components['schemas']['CallUsageList'];
export type CallUsageByTarget = components['schemas']['CallUsageByTarget'];
export type CallLogTarget = components['schemas']['CallLogTarget'];

/** 목록에서 대상 하나를 찾는다. 목록에 없는 대상(허용 표 밖)은 undefined. */
export function findCallUsage(
  list: CallUsageList | undefined,
  target: CallLogTarget,
): CallUsageByTarget | undefined {
  return list?.items.find((item) => item.target === target);
}

/** '38/110'. 상한이 없는 대상은 '38'. */
export function formatUsageCount(usage: Pick<CallUsageByTarget, 'count' | 'dailyLimit'>): string {
  return usage.dailyLimit === null ? String(usage.count) : `${usage.count}/${usage.dailyLimit}`;
}

/**
 * 라쿠텐 상품 페이지를 읽는 버튼('넣기'·'재조회'·'재고 확인')이 꺼진 이유(F-SO-16, P2-02). 하루 상한에 닿았거나(`limitReached`)
 * 403·418·429 뒤 쉬는 중(`blockedUntil`)이면 글, 아니면 null. 서버도 같은 조건으로 409를 준다(DAILY_LIMIT_REACHED·
 * EXTERNAL_CALL_COOLDOWN) — 화면은 누르기 전에 끈다. 문구는 05-3 두 코드의 화면 문구를 따른다.
 */
export function pageReadBlockedReason(
  usage: Pick<CallUsageByTarget, 'limitReached' | 'dailyLimit' | 'blockedUntil'> | undefined,
): string | null {
  if (!usage) return null;
  if (usage.limitReached) {
    const limit = usage.dailyLimit === null ? '' : `(${usage.dailyLimit}건)`;
    return `오늘 페이지 조회 한도${limit}를 다 썼습니다. 내일 0시(한국 시간)에 다시 됩니다.`;
  }
  if (usage.blockedUntil) {
    return `라쿠텐 상품 페이지가 요청을 막아 ${formatKstMonthDayTime(usage.blockedUntil)}까지 쉽니다.`;
  }
  return null;
}
