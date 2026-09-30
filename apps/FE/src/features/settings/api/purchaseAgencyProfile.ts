import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { PurchaseAgencyProfileInput } from '../model/profileForm';

/** `GET /purchase-agency-profile`(getPurchaseAgencyProfile)의 queryKey. settings 태그라 `settings.reloaded`도 무효화한다 */
export const purchaseAgencyProfileQueryKey = qk('settings', 'getPurchaseAgencyProfile');

/**
 * 구매대행 프로필(05-2 PurchaseAgencyProfile). 행이 없으면 빈 기본값(id null)으로 200이다.
 * `missingFields`(비어 있는 필수값)와 `addressWarnings`(사라진·해외 아닌 주소록)를 함께 준다.
 * 메타 동기화가 끝나면(SSE `commerce-meta-sync.completed`) 주소 경고가 바뀔 수 있어 다시 읽는다.
 */
export function usePurchaseAgencyProfileQuery() {
  return useQuery({
    queryKey: purchaseAgencyProfileQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/purchase-agency-profile', { signal })),
  });
}

/**
 * 프로필 저장(`PUT /purchase-agency-profile`, 전체 교체 — 12개 키를 모두 보낸다). 성공하면 응답의 `profile`을
 * 조회 캐시에 바로 넣는다. 재실행 필요가 생겼으면(`rerunRequiredStepCount > 0`) step-engine 태그도 다시 읽는다
 * (SSE `candidate-step.changed`가 오지 않아도 화면이 맞게).
 * 실패: 422 `VALIDATION_FAILED`(fieldErrors)·`ADDRESS_NOT_OVERSEAS`·`DELIVERY_COMPANY_NOT_ALLOWED`,
 * 404 `ADDRESSBOOK_NOT_FOUND`·`RETURN_DELIVERY_COMPANY_NOT_FOUND`, 503 `SETTINGS_INVALID`.
 */
export function useReplacePurchaseAgencyProfileMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: PurchaseAgencyProfileInput) =>
      request(() => api.PUT('/purchase-agency-profile', { body })),
    onSuccess: async (result) => {
      queryClient.setQueryData(purchaseAgencyProfileQueryKey, result.profile);
      if (result.rerunRequiredStepCount > 0) {
        await queryClient.invalidateQueries({ queryKey: ['step-engine'] });
      }
    },
  });
}
