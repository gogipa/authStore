import type { components } from '@/shared/api/schema';

type CallUsageList = components['schemas']['CallUsageList'];
type CallUsageByTarget = components['schemas']['CallUsageByTarget'];
type CallUsageChangedEvent = components['schemas']['CallUsageChangedEvent'];

/** 시안 예시 값(공통부품 §A '오늘 페이지 조회 38/110'): RAKUTEN_PAGE count 38 · dailyLimit 110 · remaining 72. */
export const KST_DATE = '2026-09-27';

export function rakutenPageUsage(count = 38, dailyLimit = 110): CallUsageByTarget {
  return {
    target: 'RAKUTEN_PAGE',
    kstDate: KST_DATE,
    count,
    dailyLimit,
    remaining: Math.max(dailyLimit - count, 0),
    limitReached: count >= dailyLimit,
    blockedUntil: null,
    httpStatus: null,
    countsByFetchReason: { SOURCING: count, URL_ENTRY: 0, STOCK_CHECK: 0, REFETCH: 0, SYNC: 0 },
    budgetBuckets: null,
  };
}

/** GET /call-usage 응답(05-1 §7.1 P1-01: 허용 표에 호스트가 있는 대상, CallLogTarget 순서). */
export function callUsageList(rakutenPageCount = 38): CallUsageList {
  return {
    items: [
      {
        target: 'COMMERCE_API',
        kstDate: KST_DATE,
        count: 0,
        dailyLimit: null,
        remaining: null,
        limitReached: false,
        blockedUntil: null,
        httpStatus: null,
        countsByFetchReason: null,
        budgetBuckets: null,
      },
      {
        target: 'RAKUTEN_API',
        kstDate: KST_DATE,
        count: 4,
        dailyLimit: null,
        remaining: null,
        limitReached: false,
        blockedUntil: null,
        httpStatus: null,
        countsByFetchReason: null,
        budgetBuckets: null,
      },
      rakutenPageUsage(rakutenPageCount),
      {
        target: 'DATALAB',
        kstDate: KST_DATE,
        count: 10,
        dailyLimit: 100,
        remaining: 90,
        limitReached: false,
        blockedUntil: null,
        httpStatus: null,
        countsByFetchReason: null,
        budgetBuckets: null,
      },
    ],
  };
}

/** SSE `call-usage.changed` data. */
export function callUsageChanged(count = 39, dailyLimit = 110): CallUsageChangedEvent {
  return {
    target: 'RAKUTEN_PAGE',
    kstDate: KST_DATE,
    count,
    dailyLimit,
    remaining: Math.max(dailyLimit - count, 0),
    limitReached: count >= dailyLimit,
    blockedUntil: null,
    httpStatus: null,
  };
}
