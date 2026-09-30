import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { components } from '@/shared/api/schema';

export type AiEngineSettings = components['schemas']['AiEngineSettings'];
export type AiEngineOption = components['schemas']['AiEngineOption'];
export type AiEngineModels = components['schemas']['AiEngineModels'];
export type AiEngineModelPair = components['schemas']['AiEngineModelPair'];
export type AiEngineSettingsUpdateRequest = components['schemas']['AiEngineSettingsUpdateRequest'];

/** `GET /settings/ai-engine`(getAiEngineSettings). settings 태그라 SSE `settings.reloaded`가 무효화한다 */
export const aiEngineSettingsQueryKey = qk('settings', 'getAiEngineSettings');

/**
 * AI 엔진 설정(05-2 AiEngineSettings): 설정 파일 `ai` 섹션 + 엔진별 고정 안내 3개. 설치·로그인 상태는 여기 없다
 * (`@/features/system`의 최신 점검). 로드된 설정이 없으면 503 `SETTINGS_INVALID`.
 */
export function useAiEngineSettingsQuery() {
  return useQuery({
    queryKey: aiEngineSettingsQueryKey,
    queryFn: ({ signal }) => request(() => api.GET('/settings/ai-engine', { signal })),
  });
}

/**
 * AI 엔진 저장(`PUT /settings/ai-engine`). 성공하면 응답을 조회 캐시에 바로 넣고 settings·system 태그를 다시 읽는다
 * (설정 화면의 'AI 엔진' 카드, 시스템 상태의 선택 엔진 표시). 실패: 409 `AI_ENGINE_NOT_VERIFIED`(10분 안 통과 없음),
 * 422 `AI_MODEL_INVALID`·`VALIDATION_FAILED`·`SETTINGS_SCHEMA_INVALID`, 503 `SETTINGS_INVALID`.
 */
export function useUpdateAiEngineSettingsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AiEngineSettingsUpdateRequest) =>
      request(() => api.PUT('/settings/ai-engine', { body })),
    onSuccess: async (result) => {
      queryClient.setQueryData(aiEngineSettingsQueryKey, result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['system'] }),
      ]);
    },
  });
}
