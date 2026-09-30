import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';

/** `GET /dispatch-delivery-companies`(listDispatchDeliveryCompanies)의 queryKey. 설정을 다시 읽으면(`settings.reloaded`) 무효화된다 */
export const dispatchDeliveryCompaniesQueryKey = qk('settings', 'listDispatchDeliveryCompanies');

/**
 * 발송 택배사 코드 목록(설정 파일 `delivery.dispatchCompanies`, 코드·이름·출처, 페이징 없음).
 * 로드된 설정 스냅샷이 없으면 503 `SETTINGS_INVALID`다.
 */
export function useDispatchDeliveryCompaniesQuery() {
  return useQuery({
    queryKey: dispatchDeliveryCompaniesQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/dispatch-delivery-companies', { signal })),
  });
}
