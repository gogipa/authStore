import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { pricingKeys } from './queryKeys';

/** 네이버쇼핑 검색 링크(`GET …/naver-shopping-links`, 0~2개 — 출처 키워드·앵커 型番). 국내 기준가 패널에서만 쓴다(CON-14) */
export function useNaverShoppingLinksQuery(candidateId: number | null) {
  return useQuery({
    queryKey: pricingKeys.naverShoppingLinks(candidateId ?? 0),
    enabled: candidateId !== null,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/naver-shopping-links', {
          params: { path: { candidateId: candidateId ?? 0 } },
          signal,
        }),
      ),
  });
}
