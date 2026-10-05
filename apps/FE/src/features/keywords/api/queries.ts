import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { operations } from '@/shared/api/schema';
import type { KeywordSnapshotCreateRequest, KeywordSnapshotDetail } from '../model/keywords';

/** listKeywordSnapshots 쿼리(page·size·sort·method·status) */
export type KeywordSnapshotsParams = NonNullable<
  operations['listKeywordSnapshots']['parameters']['query']
>;
/** listSnapshotKeywords 쿼리(page·size·sort·cid·excluded) */
export type SnapshotKeywordsParams = NonNullable<
  operations['listSnapshotKeywords']['parameters']['query']
>;

/** keywords 태그 전체(무효화용) */
export const KEYWORDS_TAG_KEY = ['keywords'] as const;

/**
 * queryKey(03-2 §6.2 `['keywords', operationId, params]`). SSE `keyword-collection.*`의 무효화 표(shared/api/events.ts)와
 * 같은 모양이다 — 묶음 id를 `keywordSnapshotId`로 둔다(부분 일치로 무효화된다).
 */
export const keywordsKeys = {
  snapshots: (params: KeywordSnapshotsParams = {}) =>
    qk('keywords', 'listKeywordSnapshots', { ...params }),
  snapshot: (keywordSnapshotId: number) =>
    qk('keywords', 'getKeywordSnapshot', { keywordSnapshotId }),
  keywords: (keywordSnapshotId: number, params: SnapshotKeywordsParams = {}) =>
    qk('keywords', 'listSnapshotKeywords', { keywordSnapshotId, ...params }),
  allKeywords: () => qk('keywords', 'listSnapshotKeywords'),
  status: () => qk('keywords', 'getKeywordCollectionStatus'),
  childTerms: () => qk('keywords', 'listChildKeywordTerms'),
};

/** 키워드 수집 묶음 목록(`GET /keyword-snapshots`). 화면 첫 진입은 size=1로 최근 묶음을 읽는다 */
export function useKeywordSnapshotsQuery(params: KeywordSnapshotsParams = {}) {
  return useQuery({
    queryKey: keywordsKeys.snapshots(params),
    queryFn: ({ signal }) =>
      request(() => api.GET('/keyword-snapshots', { params: { query: params }, signal })),
  });
}

/** 묶음 한 건(`GET /keyword-snapshots/{id}`): 기간·range 대조·중단 사유·구조 변경 의심·24시간 쉼 */
export function useKeywordSnapshotQuery(keywordSnapshotId: number | null) {
  return useQuery({
    queryKey: keywordsKeys.snapshot(keywordSnapshotId ?? 0),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/keyword-snapshots/{keywordSnapshotId}', {
          params: { path: { keywordSnapshotId: keywordSnapshotId! } },
          signal,
        }),
      ),
    enabled: keywordSnapshotId !== null,
  });
}

/** 묶음 안 키워드(`GET /keyword-snapshots/{id}/keywords`). 페이지를 넘길 때 앞 페이지를 잠깐 보인다 */
export function useSnapshotKeywordsQuery(
  keywordSnapshotId: number | null,
  params: SnapshotKeywordsParams = {},
) {
  return useQuery({
    queryKey: keywordsKeys.keywords(keywordSnapshotId ?? 0, params),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/keyword-snapshots/{keywordSnapshotId}/keywords', {
          params: { path: { keywordSnapshotId: keywordSnapshotId! }, query: params },
          signal,
        }),
      ),
    enabled: keywordSnapshotId !== null,
    placeholderData: keepPreviousData,
  });
}

/** 데이터랩 수집 상태(`GET /keyword-collection-status`): 머리 줄·'수집' 버튼의 꺼진 이유 */
export function useKeywordCollectionStatusQuery() {
  return useQuery({
    queryKey: keywordsKeys.status(),
    queryFn: ({ signal }) => request(() => api.GET('/keyword-collection-status', { signal })),
  });
}

/** 아동 단어 목록(`GET /child-keyword-terms`) */
export function useChildKeywordTermsQuery() {
  return useQuery({
    queryKey: keywordsKeys.childTerms(),
    queryFn: ({ signal }) => request(() => api.GET('/child-keyword-terms', { signal })),
  });
}

/**
 * 키워드 목록 만들기(`POST /keyword-snapshots`): BUTTON 202(KeywordCollectionAccepted) / PASTE 201(KeywordSnapshot).
 * 성공하면 keywords 태그 전체를 다시 읽는다. 실패: 409 ALREADY_IN_PROGRESS·EXTERNAL_CALL_COOLDOWN·DAILY_LIMIT_REACHED,
 * 413 PAYLOAD_TOO_LARGE, 422 IMPORT_PARSE_FAILED·IMPORT_EMPTY·VALIDATION_FAILED.
 */
export function useCreateKeywordSnapshotMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: KeywordSnapshotCreateRequest) =>
      request(() => api.POST('/keyword-snapshots', { body })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYWORDS_TAG_KEY }),
  });
}

/**
 * G1 키워드 고르기(`PUT /keywords/{id}/selection`, D-33 — 이 키워드를 '지금 고른 키워드'로 한다). 이미 지금 고른 키워드면 그대로(멱등).
 * 성공하면 응답 키워드를 그 묶음 조회(`getKeywordSnapshot`)의 `selectedKeyword`에 바로 넣어 표·검색어 확인이 다시 읽기를 기다리지 않고
 * 바뀌게 하고, keywords 태그를 다시 읽어 서버 값과 맞춘다. 409 KEYWORD_EXCLUDED
 */
export function useSelectKeywordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keywordId: number) =>
      request(() =>
        api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId } } }),
      ),
    onSuccess: (keyword) => {
      queryClient.setQueryData<KeywordSnapshotDetail>(
        keywordsKeys.snapshot(keyword.keywordSnapshotId),
        (detail) => (detail ? { ...detail, selectedKeyword: keyword } : detail),
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYWORDS_TAG_KEY }),
  });
}

/**
 * G1 고르기 취소(`DELETE /keywords/{id}/selection`, 204). 409 KEYWORD_IN_USE(이 키워드로 만든 여정이 있음).
 * D-33: 키워드를 하나만 고르는 화면(M1)은 부르지 않는다 — 다른 키워드를 고르면 바뀌므로 취소가 필요 없다(남겨 둔 API).
 */
export function useUnselectKeywordMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (keywordId: number) =>
      request(() =>
        api.DELETE('/keywords/{keywordId}/selection', { params: { path: { keywordId } } }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEYWORDS_TAG_KEY }),
  });
}

/**
 * 키워드 한 개를 라쿠텐 검색어(일본어·영문)로 바꾸기(`POST /keywords/{id}/rakuten-query-conversions`, F-BS-70). 고른 AI 엔진을 한 번
 * 불러 10초~2분 걸린다. 결과는 어디에도 저장하지 않으므로 다시 읽을 것이 없다 — 칸에 넣는 것은 부른 화면이 한다.
 * 409 KEYWORD_EXCLUDED·AI_ENGINE_UNAVAILABLE, 502 AI_CALL_FAILED
 */
export function useConvertKeywordToRakutenQueryMutation() {
  return useMutation({
    mutationFn: (keywordId: number) =>
      request(() =>
        api.POST('/keywords/{keywordId}/rakuten-query-conversions', {
          params: { path: { keywordId } },
        }),
      ),
  });
}

/** 아동 단어 더하기(`POST /child-keyword-terms`, 201). 성공하면 아동 단어 목록·설정을 다시 읽는다. 409 같은 단어 */
export function useAddChildKeywordTermMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (term: string) =>
      request(() => api.POST('/child-keyword-terms', { body: { term } })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keywordsKeys.childTerms() }),
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
      ]),
  });
}
