import { qk } from '@/shared/api/queryKeys';

/** registration 태그 전체 */
export const REGISTRATION_TAG_KEY = ['registration'] as const;

/** 사이즈 옵션 방식(05-2 RegistrationOptionType) */
export type RegistrationOptionType = 'COMBINATION' | 'STANDARD';

/**
 * registration queryKey(03-2 §6.2 `['registration', operationId, params]`, P4-01·P4-02). 후보 한 건 키의 파라미터는 `{ candidateId }`로
 * 시작한다 — SSE 무효화(shared/api/events.ts)가 부분 일치로 닿는다.
 */
export const registrationKeys = {
  /** ⑧ 산출물(현재 버전 또는 `stepRunId` 버전): `['registration','getCandidateUploadResult',{ candidateId, stepRunId }]` */
  uploadResult: (candidateId: number, stepRunId?: number) =>
    qk('registration', 'getCandidateUploadResult', {
      candidateId,
      ...(stepRunId !== undefined ? { stepRunId } : {}),
    }),
  /** G4 승인 미리보기: `['registration','getCandidateApproval',{ candidateId, optionType }]` */
  approval: (candidateId: number, optionType: RegistrationOptionType) =>
    qk('registration', 'getCandidateApproval', { candidateId, optionType }),
  /** G4 사전 검증(POST지만 결과를 화면 상태로 둔다): `['registration','runCandidatePreValidation',{ candidateId, optionType }]` */
  preValidation: (candidateId: number, optionType: RegistrationOptionType) =>
    qk('registration', 'runCandidatePreValidation', { candidateId, optionType }),
};
