import { Injectable } from '@nestjs/common';
import type { Db } from '../candidates/step-engine-tx.js';
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
 * 게이트 유효성 포트(규칙 5·12). 후보 상태 자동 전환(승인대기 ↔ 작업중)·이어서 할 곳·상세 `gates`가 이 값을 쓴다.
 * P1-06이 지문 비교(fingerprint_basis를 현재 값으로 다시 계산)로 바꿔 끼운다.
 */
export interface GateValidityPort {
  evaluate(db: Db, candidateId: number): Promise<CandidateGateValidity>;
}

export const GATE_VALIDITY = Symbol('GATE_VALIDITY');

const GATES: readonly GateCode[] = ['G2', 'G3'];

/**
 * P1-04 기본 구현: 통과 기록이 없으면 무효. 지문 비교는 아직 없어 '최신 통과 기록이 있다'를 유효로 본다.
 * 늘 참(true)으로 두지 않는다 — 통과 기록 없이 승인대기로 올라가는 일이 없게 한다(P1-04 §8).
 * gate_pass는 P1-06(게이트 통과 API)이 처음 쓴다. 그 전에는 모든 후보가 G2·G3 무효다.
 */
@Injectable()
export class LatestPassGateValidity implements GateValidityPort {
  async evaluate(db: Db, candidateId: number): Promise<CandidateGateValidity> {
    const result = {} as CandidateGateValidity;
    for (const gate of GATES) {
      const latest = await db.gatePass.findFirst({
        where: { candidateId, gate },
        orderBy: [{ passedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, passedAt: true },
      });
      result[gate] = {
        gate,
        gatePassId: latest?.id ?? null,
        passedAt: latest?.passedAt ?? null,
        valid: latest !== null,
      };
    }
    return result;
  }
}

export function toGateFlags(validity: CandidateGateValidity): GateFlags {
  return { G2: validity.G2.valid, G3: validity.G3.valid };
}
