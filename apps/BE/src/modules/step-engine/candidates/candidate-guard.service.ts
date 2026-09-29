import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { Candidate } from '../../../generated/prisma/client.js';
import {
  CANDIDATE_STATUS_LABEL,
  isLockedStatus,
  STEP_FLOW,
  STEP_LABEL,
  stepStatusOf,
  toStepStatusMap,
  type CandidateStatus,
  type StepCode,
  type StepStatusMap,
} from '../domain/steps.js';
import type { Db } from './step-engine-tx.js';

/** 후보 id 상한(serial = int4) */
const MAX_ID = 2_147_483_647;

/** 경로의 후보 id를 정수로 읽는다. 1 이상 int4 정수가 아니면 그런 후보는 없다(404 CANDIDATE_NOT_FOUND) */
export function parseCandidateId(raw: unknown): number {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text)) {
    const id = Number(text);
    if (id <= MAX_ID) return id;
  }
  throw new ApiException('CANDIDATE_NOT_FOUND');
}

/**
 * 후보 검사 모음(404·잠금·제외·상태·실행 중). 상태를 바꾸는 step-engine 요청은 모두 이 순서로 검사한다:
 * 404 → 잠금(CANDIDATE_LOCKED) → 제외(CANDIDATE_EXCLUDED)·상태(CANDIDATE_STATUS_INVALID) → 실행 중(STEP_LOCKED_BY_RUNNING_STEP).
 * P1-05(단계 실행·오너 수정)·P1-06(게이트·연속 실행)이 그대로 쓴다.
 */
@Injectable()
export class CandidateGuardService {
  /** 후보 한 건(없으면 404) */
  async findOr404(db: Db, candidateId: number): Promise<Candidate> {
    const candidate = await db.candidate.findUnique({ where: { id: candidateId } });
    if (!candidate) throw new ApiException('CANDIDATE_NOT_FOUND');
    return candidate;
  }

  /**
   * 트랜잭션 안에서 후보 행을 잠그고(SELECT … FOR UPDATE) 읽는다. 같은 후보를 바꾸는 요청이 겹치면 차례로 돈다.
   * 없으면 404.
   */
  async lockForUpdate(tx: Db, candidateId: number): Promise<Candidate> {
    const rows = await tx.$queryRaw<{ id: number }[]>`
      SELECT id FROM candidate WHERE id = ${candidateId} FOR UPDATE`;
    if (rows.length === 0) throw new ApiException('CANDIDATE_NOT_FOUND');
    return tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
  }

  /** 후보의 단계 10개 상태 */
  async loadSteps(db: Db, candidateId: number): Promise<StepStatusMap> {
    const rows = await db.candidateStep.findMany({
      where: { candidateId },
      select: { stepCode: true, status: true },
    });
    return toStepStatusMap(rows);
  }

  /** 등록 진행 잠금(F-CW-07): 등록요청중·결과확인필요·등록됨이면 409 CANDIDATE_LOCKED(details.status) */
  assertNotLocked(candidate: Pick<Candidate, 'status'>): void {
    if (isLockedStatus(candidate.status)) {
      throw new ApiException('CANDIDATE_LOCKED', { details: { status: candidate.status } });
    }
  }

  /** 제외 후보면 409 CANDIDATE_EXCLUDED */
  assertNotExcluded(candidate: Pick<Candidate, 'status'>): void {
    if (candidate.status === 'EXCLUDED') throw new ApiException('CANDIDATE_EXCLUDED');
  }

  /** 값을 바꾸는 요청의 기본 검사: 잠금 → 제외 */
  assertMutable(candidate: Pick<Candidate, 'status'>): void {
    this.assertNotLocked(candidate);
    this.assertNotExcluded(candidate);
  }

  /** 이 동작을 받는 상태가 아니면 409 CANDIDATE_STATUS_INVALID(details.status·allowed) */
  assertStatusIn(candidate: Pick<Candidate, 'status'>, allowed: readonly CandidateStatus[]): void {
    const status = candidate.status as CandidateStatus;
    if (allowed.includes(status)) return;
    throw new ApiException('CANDIDATE_STATUS_INVALID', {
      message: formatErrorMessage('CANDIDATE_STATUS_INVALID', {
        상태: CANDIDATE_STATUS_LABEL[status] ?? status,
      }),
      details: { status, allowed: [...allowed] },
    });
  }

  /**
   * 실행 중인 단계가 있으면 409 STEP_LOCKED_BY_RUNNING_STEP(details.stepCode = 실행 중인 단계).
   * `among`을 주면 그 단계들만 본다(예: 성별을 읽는 단계). 흐름 순서로 첫 단계를 알린다.
   */
  assertNoRunningStep(steps: StepStatusMap, among: readonly StepCode[] = STEP_FLOW): void {
    const running = STEP_FLOW.find(
      (code) => among.includes(code) && stepStatusOf(steps, code) === 'RUNNING',
    );
    if (!running) return;
    throw new ApiException('STEP_LOCKED_BY_RUNNING_STEP', {
      message: formatErrorMessage('STEP_LOCKED_BY_RUNNING_STEP', { 단계: STEP_LABEL[running] }),
      details: { stepCode: running },
    });
  }
}
