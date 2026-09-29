import type { components } from '@/shared/api/schema';

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
