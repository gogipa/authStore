import { useQuery } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { registrationKeys, type RegistrationOptionType } from './queryKeys';

/** 앞선 검사가 끝나기 전에 더 새 요청이 와서 이번 요청은 버린다(그 새 요청이 검사를 돈다) */
export class PreValidationSupersededError extends Error {
  constructor() {
    super('더 새 사전 검증 요청이 있어 이 요청은 건너뜁니다.');
    this.name = 'PreValidationSupersededError';
  }
}

const running = new Map<string, Promise<unknown>>();
const latest = new Map<string, number>();

/**
 * 같은 키의 요청을 **한 번에 하나만** 서버로 보낸다(P4-02 §5 '동시에 하나만'). SSE가 연달아 오면 TanStack Query는 앞 요청을
 * 취소하고 새로 부르는데, 서버로 간 POST는 취소되지 않아 restricted-tags 조회가 겹친다. 그래서 앞 요청이 끝날 때까지 기다리고,
 * 그사이 더 새 요청이 들어왔으면 이번 요청은 보내지 않는다(가장 새 요청 하나만 간다). 앞 요청의 신호(abort)는 쓰지 않는다.
 */
export async function serializedRun<T>(key: string, run: () => Promise<T>): Promise<T> {
  const token = (latest.get(key) ?? 0) + 1;
  latest.set(key, token);
  while (running.has(key)) {
    await running.get(key)!.catch(() => undefined);
  }
  if (latest.get(key) !== token) throw new PreValidationSupersededError();
  const task = run();
  running.set(key, task);
  try {
    return await task;
  } finally {
    if (running.get(key) === task) running.delete(key);
  }
}

/**
 * G4 사전 검증(`POST /candidates/{candidateId}/pre-validations`, runCandidatePreValidation — P4-02 규칙 1·2). 처리 리소스(POST)지만
 * 상태를 바꾸지 않아 화면 상태로 쓰려고 query로 둔다: 화면을 열 때 한 번 돌고, SSE `candidate-step.changed`·`gate.invalidated`·
 * `candidate.status-changed`를 받으면 다시 돈다(shared/api/events.ts). 서버로는 같은 후보·옵션 방식의 요청을 한 번에 하나만
 * 보낸다(`serializedRun`). 창을 다시 볼 때 저절로 다시 돌지 않는다(restricted-tags 조회를 아낀다). 승인 직전 재검증은 P4-03
 * 승인 API가 서버에서 한다.
 */
export function usePreValidation(
  candidateId: number | null,
  optionType: RegistrationOptionType = 'COMBINATION',
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: registrationKeys.preValidation(candidateId ?? 0, optionType),
    enabled: candidateId !== null && (options.enabled ?? true),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    queryFn: () =>
      serializedRun(`${candidateId}:${optionType}`, () =>
        request(() =>
          api.POST('/candidates/{candidateId}/pre-validations', {
            params: { path: { candidateId: candidateId ?? 0 } },
            body: { optionType },
          }),
        ),
      ),
  });
}
