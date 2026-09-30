import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * 프로필 변경 → '재실행 필요' 전파 포트(F-BS-21, P1-09). 프로필을 저장하는 트랜잭션 안에서 불린다.
 * 설정 파일 변경 포트(SETTINGS_RERUN_PROPAGATOR)와 모양이 같고, 키만 설정 경로가 아니라 입력 이름(`profile.<필드>`)이다.
 * @param changedInputKeys 값이 실제로 바뀐 프로필 필드의 입력 이름(예 `['profile.importer']`)
 * @param afterCommit 저장 트랜잭션이 커밋된 뒤 부를 일(전파 SSE `candidate-step.changed`). 롤백되면 부르지 않는다
 * @returns 재실행 필요가 된(사유가 늘어난) 후보 단계 수(PurchaseAgencyProfileSaveResult.rerunRequiredStepCount)
 *
 * 기본 구현은 0이다. P1-05 step-engine의 `PropagationService`가 onModuleInit에서
 * `PurchaseAgencyProfileService.setRerunPropagator`로 실제 전파(`onProfileChanged`)를 끼운다(settings → step-engine
 * 의존 없이, 설정 변경 포트와 같은 방식).
 */
export type ProfileRerunPropagator = (
  changedInputKeys: readonly string[],
  tx: Prisma.TransactionClient,
  afterCommit: (fn: () => void) => void,
) => Promise<number>;

export const PROFILE_RERUN_PROPAGATOR = Symbol('PROFILE_RERUN_PROPAGATOR');

export const noopProfileRerunPropagator: ProfileRerunPropagator = () => Promise.resolve(0);
