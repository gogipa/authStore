import type { StepCode } from '@/shared/lib/steps';
import type { DemoWorld } from '../demoWorld';

/** 지연 종류(밀리초는 `DemoWorld`의 지연표가 정한다: 짧게 ≈0.45초 · 보통 ≈0.9초 · 길게 ≈1.4초) */
export type DelayKind = 'short' | 'medium' | 'long';

/** 단계 실행 결과 */
export type RunOutcome =
  | { status: 'COMPLETED' }
  | { status: 'WAITING_INPUT'; reasonCode: string; pendingInputs: string[] };

/**
 * 단계 실행기(BE `StepRunner`에 해당): 실행이 시작되면 이 단계의 하위 상태를 처음으로 되돌리고, 지연 뒤 결과(입력 대기 또는 완료)를 낸다.
 * 엔진(`world/engine.ts`)이 상태·버전·여정 상태·연속 실행을 맡고, 실행기는 단계 고유의 것만 한다.
 */
export interface StepRunner {
  readonly stepCode: StepCode;
  /** RUNNING에서 결과까지 걸리는 시간 */
  readonly delay: DelayKind;
  /** 시작 전 검사(BE `beforeStart`). 막히면 `DemoHttpError`를 던진다 — 실행 기록을 만들지 않는다 */
  beforeStart?(world: DemoWorld, body: StartBody): void;
  /** 새 실행이 RUNNING으로 시작된 직후: 이 단계 하위 상태를 처음으로(재실행이면 이전 선택을 지움) */
  onStart?(world: DemoWorld, body: StartBody): void;
  /** 지연이 끝났을 때 결과를 정한다 */
  outcome(world: DemoWorld): RunOutcome;
  /** 결과가 정해진 직후(입력 대기든 완료든): 산출물·여정 값 기록 */
  onSettled?(world: DemoWorld, outcome: RunOutcome): void;
}

/** `POST …/runs` 본문 */
export interface StartBody {
  ownerInputs?: {
    searchKeyword?: string;
    couponYen?: number;
    faceOption?: string;
    promptAdjustment?: string | null;
  };
  throughStepCode?: StepCode;
}
