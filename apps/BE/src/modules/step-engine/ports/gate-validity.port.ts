import type { Db, StepEngineTx } from '../candidates/step-engine-tx.js';
import type { GateFlags } from '../domain/resume.js';
import type { GateCode } from '../domain/steps.js';

/** G2·G3 하나의 유효성(05-2 CandidateGateValidity) */
export interface GateValidity {
  gate: GateCode;
  /** 최신 통과 기록(gate_pass). 없으면 null */
  gatePassId: number | null;
  passedAt: Date | null;
  /** 지금 유효한가. 통과 기록이 없으면 false */
  valid: boolean;
}

export type CandidateGateValidity = Record<GateCode, GateValidity>;

/**
 * 게이트 지문 상태(무효 감지용 스냅샷).
 * - NONE: 통과 기록 없음
 * - VALID: 최신 통과 지문 = 지금 값으로 다시 계산한 지문
 * - PENDING: 근거 단계 현재 버전에 확인할 값이 없음(실행 중·입력 대기·실패·미실행) 또는 공급자 없음
 * - MISMATCH: 지금 값의 지문이 최신 통과와 다름(다시 통과해야 한다)
 */
export type GateFingerprintState = 'NONE' | 'VALID' | 'PENDING' | 'MISMATCH';

export type GateSnapshot = Record<GateCode, GateFingerprintState>;

/** 이번 트랜잭션에서 무효가 된 게이트(SSE gate.invalidated) */
export interface GateInvalidation {
  candidateId: number;
  gate: GateCode;
  previousGatePassId: number;
  changedBasisKeys: string[];
}

/**
 * 게이트 유효성 포트(P1-04 규칙 5·12, P1-06 규칙 9). 후보 상태 자동 전환(승인대기 ↔ 작업중)·이어서 할 곳·상세 `gates`·
 * 단계 레일·실행 시작 조건(⑧ ← G3)이 `evaluate`를 쓴다. P1-06 `GateValidityService`가 지문 비교(최신 gate_pass의 지문을
 * 근거 단계 현재 버전으로 다시 계산한 지문과 비교)로 구현한다.
 *
 * 무효 감지(선택 메서드): 게이트 값을 바꿀 수 있는 트랜잭션(단계 완료 끝 트랜잭션, 오너 수정, ② 소싱 선택 변경)이 바꾸기
 * 전에 `snapshot`, 바꾼 뒤 후보 재평가와 함께 `detectInvalidation`을 부른다. VALID·PENDING·NONE에서 MISMATCH가 된 게이트마다
 * 커밋 뒤 SSE `gate.invalidated { previousGatePassId, changedBasisKeys }`를 한 번 보낸다(같은 트랜잭션에서 두 번 부르면 한 번만).
 */
export interface GateValidityPort {
  evaluate(db: Db, candidateId: number): Promise<CandidateGateValidity>;
  snapshot?(db: Db, candidateId: number): Promise<GateSnapshot>;
  detectInvalidation?(
    scope: StepEngineTx,
    candidateId: number,
    before: GateSnapshot,
  ): Promise<GateInvalidation[]>;
}

export const GATE_VALIDITY = Symbol('GATE_VALIDITY');

export function toGateFlags(validity: CandidateGateValidity): GateFlags {
  return { G2: validity.G2.valid, G3: validity.G3.valid };
}
