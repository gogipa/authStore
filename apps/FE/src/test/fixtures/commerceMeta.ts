import type { components } from '@/shared/api/schema';

type Target = components['schemas']['CommerceMetaSyncTarget'];
type Run = components['schemas']['CommerceMetaSyncRun'];
type StatusList = components['schemas']['CommerceMetaSyncStatusList'];
type Addressbook = components['schemas']['CommerceAddressbookEntry'];
type ReturnDeliveryCompany = components['schemas']['CommerceReturnDeliveryCompanyEntry'];

export const META_TARGETS: Target[] = [
  'CATEGORY',
  'CATEGORY_DETAIL',
  'STANDARD_OPTIONS',
  'PRODUCT_ATTRIBUTES',
  'ORIGIN_AREA',
  'ADDRESSBOOK',
  'PROVIDED_NOTICE',
  'RETURN_DELIVERY_COMPANY',
];

/** 09:10 KST(보드 '09:10') */
export const SYNCED_AT = '2026-09-28T00:10:00.000Z';

let seq = 0;

/** 실행 기록 한 건. SUCCEEDED·FAILED는 at에 끝났고, RUNNING은 at에 시작했다 */
export function metaSyncRun(target: Target, status: Run['status'], at = SYNCED_AT): Run {
  seq += 1;
  return {
    id: seq,
    target,
    status,
    startedAt: at,
    finishedAt: status === 'RUNNING' ? null : at,
    itemCount: status === 'SUCCEEDED' ? 3 : null,
    errorMessage:
      status === 'FAILED' ? '커머스API 응답 오류(HTTP 500 · GW.INTERNAL_SERVER_ERROR)' : null,
  };
}

/**
 * GET /commerce-meta-sync-runs/latest 응답. 기본은 8개 모두 09:10 성공(보드). `runs`로 대상별 최신 실행을 바꾸고,
 * `lastSucceededAt`으로 마지막 성공 시각을 바꾼다(null = 돈 적 없음).
 */
export function metaSyncStatusList(
  runs: Partial<Record<Target, Run | null>> = {},
  lastSucceededAt: Partial<Record<Target, string | null>> = {},
): StatusList {
  return {
    items: META_TARGETS.map((target) => {
      const run = target in runs ? (runs[target] ?? null) : metaSyncRun(target, 'SUCCEEDED');
      const last =
        target in lastSucceededAt
          ? (lastSucceededAt[target] ?? null)
          : run?.status === 'SUCCEEDED'
            ? run.finishedAt
            : run
              ? SYNCED_AT
              : null;
      return { target, latestRun: run, lastSucceededAt: last };
    }),
  };
}

/** 한 번도 돌지 않은 상태 */
export function emptyMetaSyncStatusList(): StatusList {
  return {
    items: META_TARGETS.map((target) => ({ target, latestRun: null, lastSucceededAt: null })),
  };
}

export function addressbookEntry(overrides: Partial<Addressbook> = {}): Addressbook {
  return {
    id: 1,
    addressBookNo: '100000001',
    name: '[배대지 창고] 해외 출고지',
    addressType: 'RELEASE',
    isOverseas: true,
    addressSummary: '[배대지 창고 주소] [동·호수]',
    syncedAt: SYNCED_AT,
    removedAt: null,
    ...overrides,
  };
}

export function returnDeliveryCompanyEntry(
  overrides: Partial<ReturnDeliveryCompany> = {},
): ReturnDeliveryCompany {
  return {
    id: 1,
    code: 'CJGLS',
    name: 'CJ대한통운',
    syncedAt: SYNCED_AT,
    removedAt: null,
    ...overrides,
  };
}

export function page<T>(content: T[]) {
  return {
    content,
    page: {
      number: 0,
      size: 20,
      totalElements: content.length,
      totalPages: content.length ? 1 : 0,
    },
  };
}
