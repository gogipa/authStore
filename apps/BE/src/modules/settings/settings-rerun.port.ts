import type { Prisma } from '../../generated/prisma/client.js';

/**
 * 설정 변경 → '재실행 필요' 전파 포트(F-BS-21, GEN-03 규칙 3). 새 설정 스냅샷을 만드는 트랜잭션 안에서 불린다.
 * @param changedKeys 직전 현재 스냅샷과 달라진 설정 키(점 경로). `ai` 섹션 키는 빼고 넘긴다(D-16 R9)
 * @param afterCommit 설정 트랜잭션이 커밋된 뒤 부를 일을 맡긴다(전파 SSE `candidate-step.changed` 등, P1-05).
 *   다시 읽기(POST /settings-snapshots)는 `settings.reloaded`를 보낸 뒤 부른다. 롤백되면 부르지 않는다
 * @returns 이번 변경으로 재실행 필요가 된 후보 단계 수(SettingsReloadResult.rerunRequiredStepCount)
 *
 * 기본 구현은 0을 돌려준다. P1-05(단계 실행 엔진)가 `setRerunPropagator`로 실제 전파를 끼운다.
 * 여기서 candidate_step을 고치거나 수를 지어내지 않는다.
 */
export type SettingsRerunPropagator = (
  changedKeys: readonly string[],
  tx: Prisma.TransactionClient,
  afterCommit?: (fn: () => void) => void,
) => Promise<number>;

export const SETTINGS_RERUN_PROPAGATOR = Symbol('SETTINGS_RERUN_PROPAGATOR');

export const noopSettingsRerunPropagator: SettingsRerunPropagator = () => Promise.resolve(0);
