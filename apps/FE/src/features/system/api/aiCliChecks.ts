import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { AiCliCheckRequest, AiEngineCode } from '../model/aiEngineStatus';

/** `GET /ai-cli-checks/latest`(getLatestAiCliChecks). SSE `ai-cli-check.completed`가 무효화한다 */
export const latestAiCliChecksQueryKey = qk('system', 'getLatestAiCliChecks');

/** 점검 이력 한 쪽 조건(P1-11 Proposed `GET /ai-cli-checks`) */
export interface AiCliCheckListParams {
  size?: number;
  engineCode?: AiEngineCode;
}

/** `GET /ai-cli-checks`(listAiCliChecks) 전체 — 이 키로 조건별 목록을 모두 무효화한다 */
export const aiCliChecksBaseQueryKey = qk('system', 'listAiCliChecks');

/** `GET /ai-cli-checks`(listAiCliChecks)의 조건별 queryKey */
export function aiCliChecksQueryKey(params: AiCliCheckListParams = {}) {
  return qk('system', 'listAiCliChecks', {
    size: params.size ?? null,
    engineCode: params.engineCode ?? null,
  });
}

/** 엔진(CLAUDE·AGY·CODEX)마다 최신 점검 1건과 선택 엔진(05-2 AiCliCheckLatestList) */
export function useLatestAiCliChecksQuery() {
  return useQuery({
    queryKey: latestAiCliChecksQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/ai-cli-checks/latest', { signal })),
  });
}

/**
 * 점검 이력(최신순, 05-2 AiCliCheckPage). AI 엔진 페이지의 '최근 점검 이력' 표와 카드·시스템 상태의 '마지막 연결 테스트'
 * (감지만 한 SKIPPED 행 뒤에 가려진 테스트 결과)를 이 목록에서 찾는다.
 */
export function useAiCliChecksQuery(params: AiCliCheckListParams = {}) {
  return useQuery({
    queryKey: aiCliChecksQueryKey(params),
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/ai-cli-checks', {
          params: { query: { size: params.size, engineCode: params.engineCode } },
          signal,
        }),
      ),
  });
}

/**
 * 감지·연결 테스트 요청(`POST /ai-cli-checks`, 202). 결과는 기다리지 않는다 — 엔진마다 SSE `ai-cli-check.completed`가 와서
 * 최신 점검·이력을 다시 읽는다(폴링 없음). 실패: 409 `ALREADY_IN_PROGRESS`, 422 `VALIDATION_FAILED`·`AI_MODEL_INVALID`.
 * 연결 테스트(`smokeTest: true`)는 사용자가 누른 엔진만 보낸다(R7 — 화면이 스스로 보내지 않는다).
 */
export function useCreateAiCliCheckMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AiCliCheckRequest) => request(() => api.POST('/ai-cli-checks', { body })),
    onError: () => queryClient.invalidateQueries({ queryKey: latestAiCliChecksQueryKey }),
  });
}
