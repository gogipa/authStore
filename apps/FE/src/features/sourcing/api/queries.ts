import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { components } from '@/shared/api/schema';
import { applyRecalculation } from '../model/comparison';
import type { SourcingComparisonDetail } from '../model/sourcing';

/** sourcing 태그 전체(무효화용) */
export const SOURCING_TAG_KEY = ['sourcing'] as const;

/**
 * queryKey(03-2 §6.2 `['sourcing', operationId, params]`). 여정 한 건 키의 파라미터는 `{ candidateId }`로 고정한다 —
 * SSE `sourcing.*`·`step-run.status-changed`의 무효화 표(shared/api/events.ts)와 같은 모양이다.
 */
export const sourcingKeys = {
  validation: (rakutenQuery: string) => qk('sourcing', 'validateRakutenQuery', { rakutenQuery }),
  rakutenItem: (rakutenItemId: number) => qk('sourcing', 'getRakutenItem', { rakutenItemId }),
  comparisonAll: qk('sourcing', 'getSourcingComparison'),
  /** 여정 한 건의 모든 비교표 조회(무효화용 — 아래 `comparisonOf`와 부분 일치) */
  comparison: (candidateId: number) => qk('sourcing', 'getSourcingComparison', { candidateId }),
  /** P2-03: 조회 조건까지(`['sourcing','getSourcingComparison',{ candidateId, stepRunId, includeNoMatch, sort }]`) */
  comparisonOf: (candidateId: number, options: Required<ComparisonQueryOptions>) =>
    qk('sourcing', 'getSourcingComparison', { candidateId, ...options }),
};

/** 비교표 조회 조건(05-2 getSourcingComparison). 기본: 현재 버전·불일치 행 빼기·실질가 순 */
export interface ComparisonQueryOptions {
  stepRunId?: number | null;
  includeNoMatch?: boolean;
  sort?: string | null;
}

function comparisonOptions(options: ComparisonQueryOptions): Required<ComparisonQueryOptions> {
  return {
    stepRunId: options.stepRunId ?? null,
    includeNoMatch: options.includeNoMatch ?? false,
    sort: options.sort ?? null,
  };
}

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
export function useSourcingComparison(
  candidateId: number | null,
  options: ComparisonQueryOptions = {},
) {
  const opts = comparisonOptions(options);
  return useQuery({
    queryKey: sourcingKeys.comparisonOf(candidateId ?? 0, opts),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/candidates/{candidateId}/sourcing-comparison', {
          params: {
            path: { candidateId: candidateId ?? 0 },
            query: {
              ...(opts.stepRunId !== null ? { stepRunId: opts.stepRunId } : {}),
              ...(opts.includeNoMatch ? { includeNoMatch: true } : {}),
              ...(opts.sort !== null ? { sort: [opts.sort] } : {}),
            },
          },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
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
 * 부른다. 성공하면 비교표·단계 레일·여정을 다시 읽는다(멈춘 ②가 이어진다). 409 CONFIRMATION_NOT_APPLICABLE·
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

// ── P2-03 비교표 쓰기 ─────────────────────────────────────────────────────────

/** sourcing 태그 전체를 다시 읽는 함수(성별을 바꾼 뒤 등 — 화면이 react-query를 직접 쓰지 않게) */
export function useInvalidateSourcing() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: SOURCING_TAG_KEY });
}

/** 비교표·단계 레일·여정을 다시 읽는다(앵커·선택·수동 행 뒤) */
function useInvalidateComparison() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: SOURCING_TAG_KEY }),
      queryClient.invalidateQueries({ queryKey: ['step-engine'] }),
    ]);
}

export type SourcingAnchorRequest = components['schemas']['SourcingAnchorRequest'];
export type SourcingRowPatch = components['schemas']['SourcingComparisonRowPatch'];

/**
 * 앵커 정하기(`PUT /sourcing-comparisons/{id}/anchor`, 202 — F-SO-08). 분류는 곧바로, 페이지 조회는 뒤에서 돌고 SSE
 * `sourcing.row-updated`·`sourcing.page-fetch-finished`가 비교표를 다시 읽힌다. 409 ANCHOR_KEY_MISMATCH·
 * STEP_RUN_NOT_WAITING_INPUT, 422 VALIDATION_FAILED
 */
export function useFixSourcingAnchor() {
  const invalidate = useInvalidateComparison();
  return useMutation({
    mutationFn: ({
      sourcingComparisonId,
      body,
    }: {
      sourcingComparisonId: number;
      body: SourcingAnchorRequest;
    }) =>
      request(() =>
        api.PUT('/sourcing-comparisons/{sourcingComparisonId}/anchor', {
          params: { path: { sourcingComparisonId } },
          body,
        }),
      ),
    onSuccess: invalidate,
  });
}

export type SourcingSearchMoreResult = components['schemas']['SourcingSearchMoreResult'];

/**
 * 상품 고르기 목록 '더 보기'(`POST /sourcing-comparisons/{id}/search-more`, 200 — D-47). 기준 상품을 정하기 전(탐색 모드)에만.
 * 서버가 다음 30건(관련도 순)을 행에 더한다 — 성공하면 비교표를 다시 읽는다. 응답 `hasMore`가 false면 더 없다.
 * 409 ANCHOR_ALREADY_FIXED·STEP_RUN_NOT_WAITING_INPUT·EXTERNAL_CALL_COOLDOWN, 422 RAKUTEN_QUERY_INVALID
 */
export function useLoadMoreSourcingSearchRows() {
  const invalidate = useInvalidateSourcing();
  return useMutation({
    mutationFn: (sourcingComparisonId: number) =>
      request(() =>
        api.POST('/sourcing-comparisons/{sourcingComparisonId}/search-more', {
          params: { path: { sourcingComparisonId } },
        }),
      ),
    onSuccess: invalidate,
  });
}

/**
 * 비교표 행 수정(`PATCH /sourcing-comparison-rows/{rowId}` — 쿠폰·샵·이벤트 배율·오너 동일 상품 판단, F-SO-25·26). 응답의
 * 행과 `rankedRowIds`(검증 행의 실질가 순)로 캐시의 비교표를 바로 고친다(다시 읽지 않는다 — 응답 순서로 다시 그린다)
 */
export function useUpdateSourcingRow(candidateId: number | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, patch }: { rowId: number; patch: SourcingRowPatch }) =>
      request(() =>
        api.PATCH('/sourcing-comparison-rows/{rowId}', {
          params: { path: { rowId } },
          body: patch,
        }),
      ),
    onSuccess: (result) => {
      if (candidateId === null) return;
      queryClient.setQueriesData<SourcingComparisonDetail>(
        { queryKey: sourcingKeys.comparison(candidateId) },
        (detail) => (detail ? applyRecalculation(detail, result) : detail),
      );
    },
  });
}

/** 미검증 행 재고 확인(`POST /sourcing-comparison-rows/{rowId}/stock-checks`, 202 — 결과는 SSE `sourcing.row-updated`) */
export function useRequestStockCheck() {
  return useMutation({
    mutationFn: (rowId: number) =>
      request(() =>
        api.POST('/sourcing-comparison-rows/{rowId}/stock-checks', {
          params: { path: { rowId } },
        }),
      ),
  });
}

/** URL 상품을 비교표 '수동' 행으로(`POST /sourcing-comparisons/{id}/rows`, 201 — F-SO-34) */
export function useAddManualRow() {
  const invalidate = useInvalidateComparison();
  return useMutation({
    mutationFn: ({
      sourcingComparisonId,
      rakutenItemId,
    }: {
      sourcingComparisonId: number;
      rakutenItemId: number;
    }) =>
      request(() =>
        api.POST('/sourcing-comparisons/{sourcingComparisonId}/rows', {
          params: { path: { sourcingComparisonId } },
          body: { rakutenItemId },
        }),
      ),
    onSuccess: invalidate,
  });
}

/**
 * 최종 후보 한 개 고르기(`PUT /sourcing-comparisons/{id}/selection` — ② 완료, F-SO-29). 다른 샵이면 `g2Invalidated`.
 * 409 ROW_NOT_VERIFIED·ROW_STOCK_INSUFFICIENT·ANCHOR_KEY_MISMATCH·ANCHOR_NOT_FIXED·ADULT_CONFIRMATION_REQUIRED·GENDER_REQUIRED·
 * CANDIDATE_DUPLICATE
 */
export function useSelectSourcingRow() {
  const invalidate = useInvalidateComparison();
  return useMutation({
    mutationFn: ({
      sourcingComparisonId,
      rowId,
    }: {
      sourcingComparisonId: number;
      rowId: number;
    }) =>
      request(() =>
        api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
          params: { path: { sourcingComparisonId } },
          body: { rowId },
        }),
      ),
    onSettled: invalidate,
  });
}
