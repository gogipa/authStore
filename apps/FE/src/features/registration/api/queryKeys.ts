import { qk } from '@/shared/api/queryKeys';

/** registration 태그 전체 */
export const REGISTRATION_TAG_KEY = ['registration'] as const;

/**
 * registration queryKey(03-2 §6.2 `['registration', operationId, params]`, P4-01). 후보 한 건 키의 파라미터는 `{ candidateId }`로
 * 시작한다 — SSE 무효화(`step-run.status-changed`(UPLOAD)·`candidate-step.changed`, shared/api/events.ts)가 부분 일치로 닿는다.
 */
export const registrationKeys = {
  /** ⑧ 산출물(현재 버전 또는 `stepRunId` 버전): `['registration','getCandidateUploadResult',{ candidateId, stepRunId }]` */
  uploadResult: (candidateId: number, stepRunId?: number) =>
    qk('registration', 'getCandidateUploadResult', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
};
