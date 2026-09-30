import { SetMetadata } from '@nestjs/common';
import type { ErrorCode } from '../../../common/errors/error-codes.js';
import type { StepEngineTx } from '../candidates/step-engine-tx.js';
import type { CandidateWarning } from '../domain/warnings.js';
import type { GateBasis } from '../gates/gate-fingerprint.js';
import type { Tx } from './step-runner.js';

export {
  changedBasisKeys,
  g2Basis,
  g3Basis,
  gateFingerprint,
  type G2BasisInput,
  type G2SaleSize,
  type G3BasisInput,
  type GateAnchorKey,
  type GateBasis,
} from '../gates/gate-fingerprint.js';

/**
 * 게이트 규약(F-CW-02, 03-2 C4 §3 'GateBasisProvider 규약', P1-06). 게이트를 확인하는 단계 모듈(P2-05 pricing → G2,
 * P3-02 thumbnails → G3)이 step-engine에서 가져오는 것은 이 파일과 contracts/step-runner.ts·`StepEngineApi`뿐이다.
 *
 * 등록: 공급자 클래스에 `@GateBasisFor('G2')`를 달고 자기 모듈 `providers`에 넣는다(`StepRunner`와 같은 방식).
 * `GateBasisRegistry`가 앱 시작 때 DiscoveryService로 모은다. 한 게이트에 공급자가 둘이면 앱 시작을 멈춘다.
 * 공급자가 없는 게이트는 통과할 수 없고(422 INVALID_GATE_CODE, '준비 중') 늘 무효다.
 *
 * 통과(`POST /candidates/{id}/gates/{G2|G3}/pass`, 웹 화면 전용) 한 트랜잭션:
 * 1. 후보 잠금·잠금/제외·실행 중 잠금 → 근거 버전이 현재 버전인지(409 VERSION_NOT_CURRENT)·통과할 수 있는 상태인지
 *    (G2 = ③ COMPLETED, G3 = ⑤ WAITING_INPUT·COMPLETED, 아니면 409 STEP_NOT_COMPLETED)
 * 2. `blockers` → 첫 이유를 그 코드의 오류로 던진다(NOT_SALE_CANDIDATE·NO_COMPARISON_NOT_CONFIRMED·CHECKLIST_INCOMPLETE …)
 * 3. `passBasis`(없으면 `basis`) → 지문. 최신 통과와 같으면 새 행 없이 200 + 기존 기록
 * 4. gate_pass(추가만) → `onPass`(G3: thumbnail_selection 저장·⑤ 완료 또는 OWNER_EDIT 새 버전, P3-02) →
 *    후보 상태 재평가(이력 gate_pass_id) → user_action_log(GATE_PASSED) → 커밋 뒤 SSE `gate.passed`
 *
 * 유효성: 게이트별 최신 gate_pass의 지문 = 근거 단계 **현재 버전**(산출물이 있는 COMPLETED·RERUN_REQUIRED)으로 `basis`를
 * 다시 계산한 지문이면 유효. 현재 버전이 실행 중·입력 대기·실패면 무효(아직 확인할 값이 없다).
 */

/** 게이트 통과를 막는 이유 하나. code는 통과 API가 돌려줄 409·422 오류 코드(05-2 CandidateBlockReason) */
export interface GateBlocker {
  code: ErrorCode;
  /** 화면 문구. 없으면 05-3 문구 */
  message?: string;
  details?: Record<string, unknown>;
}

/** 통과가 만든 것(05-2 GatePassResult의 G3 칸·경고) */
export interface GatePassEffect {
  /** G3: 저장한 thumbnail_selection */
  thumbnailSelectionId?: number | null;
  /** G3: 선택을 가진 ⑤ 버전(완료한 뒤 다시 고르면 새 OWNER_EDIT 버전) */
  thumbnailStepRunId?: number | null;
  warnings?: CandidateWarning[];
}

export interface GateBasisProvider {
  readonly gate: 'G2' | 'G3';
  /**
   * 지문 구성값(`g2Basis`·`g3Basis`로 만든다). `basisStepRunId` = 근거 단계(G2 ③·G3 ⑤) 버전. 트랜잭션 안에서 불린다 —
   * DB 읽기만. 그 버전에 산출물이 없으면 값을 null로 채운다(지문이 달라져 무효가 된다)
   */
  basis(tx: Tx, candidateId: number, basisStepRunId: number): Promise<GateBasis>;
  /**
   * 통과를 막는 이유(없으면 빈 배열). `body`는 통과 요청 본문 — 게이트 목록(`GET …/gates`의 blockedReasons)에서는 null로
   * 불러 본문과 관계없는 이유만 낸다.
   */
  blockers(
    tx: Tx,
    candidateId: number,
    basisStepRunId: number,
    body: unknown,
  ): Promise<GateBlocker[]>;
  /**
   * 통과로 기록할 구성값(선택). 통과 요청이 새 값을 정하는 게이트(G3: 본문의 대표 이미지)가 쓴다. 없으면 `basis`.
   * `onPass` 뒤 근거 단계 현재 버전으로 다시 계산한 `basis`와 같아야 통과 직후 유효하다.
   */
  passBasis?(
    tx: Tx,
    candidateId: number,
    basisStepRunId: number,
    body: unknown,
  ): Promise<GateBasis>;
  /**
   * 통과 기록(gate_pass) 뒤 같은 트랜잭션에서 할 일(선택). G3: thumbnail_selection 저장과 ⑤ 완료(입력 대기 끝내기
   * `StepEngineApi.resumeWaiting(id, { outcome, scope })`) 또는 OWNER_EDIT 새 버전(P3-02). 여기서 던지면 통과 전체가 되돌려진다
   */
  onPass?(
    scope: StepEngineTx,
    candidateId: number,
    gatePassId: number,
    body: unknown,
  ): Promise<GatePassEffect | void>;
  /** 게이트 목록(`GET …/gates`)에 보일 막지 않는 경고(선택) */
  warnings?(tx: Tx, candidateId: number, basisStepRunId: number): Promise<CandidateWarning[]>;
}

/** 게이트 공급자 표시 메타데이터 키 */
export const GATE_BASIS_META = 'autostore:gate-basis';

/** 공급자 클래스 표시: `@GateBasisFor('G2') @Injectable() export class PricingGateBasis implements GateBasisProvider` */
export const GateBasisFor = (gate: 'G2' | 'G3') => SetMetadata(GATE_BASIS_META, gate);

/** 테스트 대역 게이트 공급자 표시 키 */
export const GATE_BASIS_TEST_DOUBLE_META = 'autostore:gate-basis-test-double';

/**
 * 테스트 대역 게이트 공급자 표시(P2-05 Proposed — 테스트 전용, `StepRunnerTestDouble`과 같은 방식). 같은 게이트에 운영
 * 공급자(pricing의 G2 등)와 이 표시를 단 가짜 공급자가 함께 있으면 가짜를 쓴다. 운영 코드는 쓰지 않는다.
 */
export const GateBasisTestDouble = () => SetMetadata(GATE_BASIS_TEST_DOUBLE_META, true);
