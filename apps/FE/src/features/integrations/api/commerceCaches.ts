import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { operations } from '@/shared/api/schema';

export type CommerceAddressbooksParams = NonNullable<
  operations['listCommerceAddressbooks']['parameters']['query']
>;
export type CommerceReturnDeliveryCompaniesParams = NonNullable<
  operations['listCommerceReturnDeliveryCompanies']['parameters']['query']
>;

/** 주소록 캐시 queryKey. 인자 없는 키는 연산 전체(SSE `commerce-meta-sync.completed`가 무효화) */
export const commerceAddressbooksQueryKey = (params?: CommerceAddressbooksParams) =>
  params === undefined
    ? qk('integrations', 'listCommerceAddressbooks')
    : qk('integrations', 'listCommerceAddressbooks', params);

/** 반품 택배사 캐시 queryKey(인자 없는 키는 연산 전체) */
export const commerceReturnDeliveryCompaniesQueryKey = (
  params?: CommerceReturnDeliveryCompaniesParams,
) =>
  params === undefined
    ? qk('integrations', 'listCommerceReturnDeliveryCompanies')
    : qk('integrations', 'listCommerceReturnDeliveryCompanies', params);

/**
 * 스토어 주소록 캐시(`GET /commerce-addressbooks`, listCommerceAddressbooks). P1-09 프로필이 해외 출고지(`overseas: true`)·
 * 반품지를 고른다. 응답에 원문(raw)은 없다. 빈 캐시는 빈 페이지(200). 동기화가 끝나면(SSE) 다시 읽는다.
 */
export function useCommerceAddressbooksQuery(params: CommerceAddressbooksParams = {}) {
  return useQuery({
    queryKey: commerceAddressbooksQueryKey(params),
    queryFn: ({ signal }) =>
      request(() => api.GET('/commerce-addressbooks', { params: { query: params }, signal })),
    placeholderData: keepPreviousData,
  });
}

/** 반품 택배사 캐시(`GET /commerce-return-delivery-companies`). P1-09 프로필의 반품 택배사 선택 목록 */
export function useCommerceReturnDeliveryCompaniesQuery(
  params: CommerceReturnDeliveryCompaniesParams = {},
) {
  return useQuery({
    queryKey: commerceReturnDeliveryCompaniesQueryKey(params),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/commerce-return-delivery-companies', { params: { query: params }, signal }),
      ),
    placeholderData: keepPreviousData,
  });
}
