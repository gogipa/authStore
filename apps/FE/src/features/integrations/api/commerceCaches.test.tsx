import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { jsonResponse, stubApi } from '@/test/apiStub';
import { addressbookEntry, page, returnDeliveryCompanyEntry } from '@/test/fixtures/commerceMeta';
import { createTestQueryClient } from '@/test/renderRoute';
import {
  commerceAddressbooksQueryKey,
  useCommerceAddressbooksQuery,
  useCommerceReturnDeliveryCompaniesQuery,
} from './commerceCaches';

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={createTestQueryClient()}>{children}</QueryClientProvider>;
}

describe('주소록·반품 택배사 캐시 훅(P1-09가 쓴다)', () => {
  it('useCommerceAddressbooksQuery({ overseas: true }) → GET /commerce-addressbooks?overseas=true', async () => {
    const api = stubApi({
      'GET /commerce-addressbooks': () => jsonResponse(page([addressbookEntry()])),
    });
    const { result } = renderHook(() => useCommerceAddressbooksQuery({ overseas: true }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.content[0]).toMatchObject({ isOverseas: true });
    expect(new URL(api.requests[0]!.url).searchParams.get('overseas')).toBe('true');
    expect(commerceAddressbooksQueryKey({ overseas: true })).toEqual([
      'integrations',
      'listCommerceAddressbooks',
      { overseas: true },
    ]);
    expect(commerceAddressbooksQueryKey()).toEqual(['integrations', 'listCommerceAddressbooks']);
  });

  it('useCommerceReturnDeliveryCompaniesQuery() → GET /commerce-return-delivery-companies', async () => {
    const api = stubApi({
      'GET /commerce-return-delivery-companies': () =>
        jsonResponse(page([returnDeliveryCompanyEntry()])),
    });
    const { result } = renderHook(() => useCommerceReturnDeliveryCompaniesQuery(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.content.map((c) => c.code)).toEqual(['CJGLS']);
    expect(new URL(api.requests[0]!.url).pathname).toBe(
      '/api/v1/commerce-return-delivery-companies',
    );
  });
});
