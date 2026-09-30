import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';

/** sourcing 태그 전체(무효화용) */
export const SOURCING_TAG_KEY = ['sourcing'] as const;

/**
 * queryKey(03-2 §6.2 `['sourcing', operationId, params]`). 후보 한 건 키의 파라미터는 `{ candidateId }`로 고정한다 —
 * SSE `sourcing.*`·`step-run.status-changed`의 무효화 표(shared/api/events.ts)와 같은 모양이다.
 */
export const sourcingKeys = {
  validation: (rakutenQuery: string) => qk('sourcing', 'validateRakutenQuery', { rakutenQuery }),
  rakutenItem: (rakutenItemId: number) => qk('sourcing', 'getRakutenItem', { rakutenItemId }),
  comparisonAll: qk('sourcing', 'getSourcingComparison'),
  comparison: (candidateId: number) => qk('sourcing', 'getSourcingComparison', { candidateId }),
};

/**
 * 라쿠텐 검색어 형식 검사(`POST /rakuten-query-validations`, 저장 없는 계산 — P2-02 F-SO-02). 본문 전달용 POST라 조회처럼
 * 검색어마다 결과를 캐시한다. 빈 검색어는 부르지 않는다. 입력이 멈춘 뒤(부르는 쪽의 `useDebouncedValue`) 값을 넘긴다.
 * 규칙 위반은 오류가 아니라 `valid=false`·`violations[]`다.
 */
export function useValidateRakutenQuery(rakutenQuery: string) {
  const query = rakutenQuery.trim();
  return useQuery({
    queryKey: sourcingKeys.validation(query),
    queryFn: ({ signal }) =>
      request(() =>
        api.POST('/rakuten-query-validations', { body: { rakutenQuery: query }, signal }),
      ),
    enabled: query !== '',
    placeholderData: keepPreviousData,
  });
}

/** 라쿠텐 페이지 스냅샷 한 건(`GET /rakuten-items/{id}`): 색상 고르기(SKU·variantSelectors). null이면 부르지 않는다 */
export function useRakutenItem(rakutenItemId: number | null) {
  return useQuery({
    queryKey: sourcingKeys.rakutenItem(rakutenItemId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/rakuten-items/{rakutenItemId}', {
          params: { path: { rakutenItemId: rakutenItemId ?? 0 } },
          signal,
        }),
      ),
    enabled: rakutenItemId !== null,
  });
}

/**
 * ② 비교표 머리 행·행(`GET /candidates/{candidateId}/sourcing-comparison`, 현재 버전). ②가 산출물을 아직 만들지 않았으면
 * 404 `STEP_OUTPUT_NOT_FOUND` — 화면은 '검색 전'으로 본다. P2-02는 행 수·성인용 확인 상태만 쓰고, 비교표는 P2-03이 그린다
 */
export function useSourcingComparison(candidateId: number | null) {
  return useQuery({
    queryKey: sourcingKeys.comparison(candidateId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/sourcing-comparison', {
          params: { path: { candidateId: candidateId ?? 0 } },
          signal,
        }),
      ),
    enabled: candidateId !== null,
    // 산출물 없음(404)은 '검색 전'이라 다시 부르지 않는다
    retry: (count, error) => error.code !== 'STEP_OUTPUT_NOT_FOUND' && count < 1,
  });
}

/**
 * 라쿠텐 URL 상품 페이지 한 건 읽기(`POST /rakuten-items`, 동기 201 — URL 입구 F-SO-31·32). 누를 때마다 하루 페이지 조회
 * 1건을 쓴다(오늘 조회 수는 SSE `call-usage.changed`가 다시 읽힌다). 오류: 422 RAKUTEN_URL_INVALID·
 * RAKUTEN_ITEM_CODE_UNRESOLVED, 409 DAILY_LIMIT_REACHED·EXTERNAL_CALL_COOLDOWN·SECRET_NOT_CONFIGURED, 502 EXTERNAL_API_ERROR
 */
export function useFetchRakutenItem() {
  return useMutation({
    mutationFn: (sourceUrl: string) =>
      request(() => api.POST('/rakuten-items', { body: { sourceUrl } })),
  });
}

/**
 * '성인용 상품 확인'(`PUT /sourcing-comparisons/{id}/adult-product-confirmation`, 본문 없음, 멱등 — F-SO-06). 웹 화면만
 * 부른다. 성공하면 비교표·단계 레일·후보를 다시 읽는다(멈춘 ②가 이어진다). 409 CONFIRMATION_NOT_APPLICABLE·
 * STEP_RUN_NOT_WAITING_INPUT
 */
export function useConfirmAdultProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourcingComparisonId: number) =>
      request(() =>
        api.PUT('/sourcing-comparisons/{sourcingComparisonId}/adult-product-confirmation', {
          params: { path: { sourcingComparisonId } },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: SOURCING_TAG_KEY }),
        queryClient.invalidateQueries({ queryKey: ['step-engine'] }),
      ]),
  });
}
