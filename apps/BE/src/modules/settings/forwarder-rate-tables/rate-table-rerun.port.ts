import type { Prisma } from '../../../generated/prisma/client.js';

/**
 * 판정 기준 데이터(활성 요금표·최신 환율)가 바뀐 입력 하나(P2-04). `value`는 ③이 그 입력으로 남긴 값과 같은 모양이고,
 * step-engine이 해시해 저장된 `value_hash`와 비교한다(같으면 재실행 필요가 되지 않는다).
 */
export interface ReferenceInputChange {
  /** 입력 이름(예 `forwarder.rateTable`, `fx.costJpy`) */
  inputKey: string;
  value: unknown;
}

/**
 * 활성 요금표 교체 → '재실행 필요' 전파 포트(P2-04 규칙 13). 요금표를 가져오는 트랜잭션 안에서 불린다.
 * settings는 step-engine을 import하지 않으므로(step-engine이 settings를 import한다), 프로필 포트(P1-09)와 같은 방식으로
 * P1-05 `PropagationService`가 onModuleInit에서 `ForwarderRateTablesService.setRerunPropagator`로 실제 전파를 끼운다.
 * @returns 재실행 필요가 된(사유가 늘어난) 후보 단계 수(`ForwarderRateTableImportResult.rerunRequiredStepCount`)
 */
export type ReferenceInputsPropagator = (
  changes: readonly ReferenceInputChange[],
  tx: Prisma.TransactionClient,
  afterCommit: (fn: () => void) => void,
) => Promise<number>;

export const RATE_TABLE_RERUN_PROPAGATOR = Symbol('RATE_TABLE_RERUN_PROPAGATOR');

export const noopReferenceInputsPropagator: ReferenceInputsPropagator = () => Promise.resolve(0);
