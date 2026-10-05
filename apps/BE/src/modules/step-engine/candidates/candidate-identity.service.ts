import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { NOT_IN_PROGRESS_STATUSES } from '../domain/steps.js';
import { anchorKeyDuplicateWarning, type CandidateWarning } from '../domain/warnings.js';
import { GATE_VALIDITY, type GateValidityPort } from '../ports/gate-validity.port.js';
import { CandidateGuardService } from './candidate-guard.service.js';
import { CandidateStatusService } from './candidate-status.service.js';
import type { Db, StepEngineTx } from './step-engine-tx.js';

/** 소싱 선택(RG-12 키): itemCode + 선택 색상 */
export interface ItemColorKey {
  itemCode: string;
  selectedColor: string;
}

/** 앵커 키(PRD §5.2 작업 단위): 型番(정규화값) 또는 앵커 itemCode 중 하나 + 색상 코드 */
export interface AnchorKeyInput {
  anchorModelCode?: string | null;
  anchorItemCode?: string | null;
  anchorColorCode: string;
}

interface AnchorFields {
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
}

/** 부분 UNIQUE 이름(ERD candidate) */
export const ACTIVE_ITEM_COLOR_INDEX = 'uq_candidate_active_item_color';

function describe(error: unknown): string {
  if (typeof error !== 'object' || error === null) return String(error);
  const e = error as { message?: unknown; meta?: unknown; cause?: unknown };
  let meta = '';
  try {
    meta = JSON.stringify(e.meta ?? null);
  } catch {
    meta = '';
  }
  return `${typeof e.message === 'string' ? e.message : ''} ${meta} ${e.cause ? describe(e.cause) : ''}`;
}

/**
 * DB가 진행 중 같은 itemCode+색상을 막은 오류인가(Postgres 23505 on uq_candidate_active_item_color).
 * Prisma는 P2002(고유 제약 위반), raw 쿼리는 P2010 + 23505로 준다. 앱 검사를 지나 동시 요청이 DB에서 걸린 경우다.
 */
export function isActiveItemColorViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const text = describe(error);
  const uniqueViolation = code === 'P2002' || code === '23505' || text.includes('23505');
  if (!uniqueViolation) return false;
  return (
    text.includes(ACTIVE_ITEM_COLOR_INDEX) ||
    (text.includes('item_code') && text.includes('selected_color')) ||
    (text.includes('itemCode') && text.includes('selectedColor'))
  );
}

function normalizeAnchor(input: AnchorKeyInput): AnchorFields {
  const model = input.anchorModelCode?.trim() || null;
  const item = input.anchorItemCode?.trim() || null;
  const color = input.anchorColorCode?.trim() || null;
  const fieldErrors: { field: string; message: string }[] = [];
  if ((model === null) === (item === null)) {
    fieldErrors.push({
      field: 'anchor',
      message: '앵커는 型番 또는 앵커 itemCode 중 하나만 정합니다.',
    });
  }
  if (color === null) {
    fieldErrors.push({ field: 'anchorColorCode', message: '기준 상품의 색상 번호가 필요합니다.' });
  }
  if (fieldErrors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors });
  return { anchorModelCode: model, anchorItemCode: item, anchorColorCode: color };
}

function sameAnchor(a: AnchorFields, b: AnchorFields): boolean {
  return (
    a.anchorModelCode === b.anchorModelCode &&
    a.anchorItemCode === b.anchorItemCode &&
    a.anchorColorCode === b.anchorColorCode
  );
}

/**
 * 후보 정체성(F-CW-03 앵커 키 고정, F-CW-04 진행 중 중복). 단계 모듈(② P2-03)은 step-engine을 거쳐 이것을 쓴다.
 * - 중복: 진행 중(제외·등록됨 아님) 후보에 같은 itemCode+색상 → 409 CANDIDATE_DUPLICATE(details.existingCandidateId).
 *   앵커 키만 같으면 막지 않고 경고 ANCHOR_KEY_DUPLICATE. 검사 시점: 만들기(RAKUTEN_URL)·임시 후보 연결(M2)·
 *   ② 소싱 선택 변경·다시 작업.
 * - 앵커: 한 번 확정하면(anchor_fixed_at) 다른 값은 409 ANCHOR_KEY_MISMATCH, 같은 값은 그대로. DB 트리거
 *   candidate_anchor_fixed가 한 번 더 막는다. 같은 앵커 안 itemCode 변경은 된다(G2 지문이 바뀐다, P1-06).
 */
@Injectable()
export class CandidateIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
    private readonly status: CandidateStatusService,
    @Inject(GATE_VALIDITY) private readonly gates: GateValidityPort,
  ) {}

  /** 진행 중 후보 중 같은 itemCode+색상(자기 자신 제외)의 id */
  async findActiveDuplicate(
    db: Db,
    key: ItemColorKey,
    excludeCandidateId?: number,
  ): Promise<number | null> {
    const row = await db.candidate.findFirst({
      where: {
        itemCode: key.itemCode,
        selectedColor: key.selectedColor,
        status: { notIn: [...NOT_IN_PROGRESS_STATUSES] },
        ...(excludeCandidateId !== undefined ? { id: { not: excludeCandidateId } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /** 같은 itemCode+색상의 진행 중 후보가 있으면 409 CANDIDATE_DUPLICATE(details.existingCandidateId) */
  async assertNoDuplicate(db: Db, key: ItemColorKey, excludeCandidateId?: number): Promise<void> {
    const existing = await this.findActiveDuplicate(db, key, excludeCandidateId);
    if (existing !== null) throw duplicateError(existing);
  }

  /** 앵커 키(型番 또는 앵커 itemCode + 색상 코드)만 같은 진행 중 후보가 있으면 경고 한 개 */
  async anchorDuplicateWarnings(
    db: Db,
    anchor: AnchorFields,
    excludeCandidateId?: number,
  ): Promise<CandidateWarning[]> {
    if (anchor.anchorColorCode === null) return [];
    if (anchor.anchorModelCode === null && anchor.anchorItemCode === null) return [];
    const rows = await db.candidate.findMany({
      where: {
        anchorColorCode: anchor.anchorColorCode,
        ...(anchor.anchorModelCode !== null
          ? { anchorModelCode: anchor.anchorModelCode }
          : { anchorItemCode: anchor.anchorItemCode }),
        status: { notIn: [...NOT_IN_PROGRESS_STATUSES] },
        ...(excludeCandidateId !== undefined ? { id: { not: excludeCandidateId } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return rows.length > 0 ? [anchorKeyDuplicateWarning(rows.map((r) => r.id))] : [];
  }

  /**
   * 앵커 키 확정(F-CW-03). 처음이면 앵커 세 칸과 anchor_fixed_at을 쓴다. 이미 확정됐으면 같은 값은 그대로(changed=false),
   * 다른 값은 409 ANCHOR_KEY_MISMATCH. 잠금·제외 후보는 막는다. 앵커 키만 같은 진행 중 후보가 있으면 경고를 준다.
   */
  async fixAnchor(
    scope: StepEngineTx,
    candidateId: number,
    input: AnchorKeyInput,
  ): Promise<{ changed: boolean; warnings: CandidateWarning[] }> {
    const anchor = normalizeAnchor(input);
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    this.guard.assertMutable(candidate);
    if (candidate.anchorFixedAt !== null) {
      if (!sameAnchor(candidate, anchor)) throw anchorMismatch(candidate);
      return { changed: false, warnings: [] };
    }
    await scope.tx.candidate.update({
      where: { id: candidateId },
      data: { ...anchor, anchorFixedAt: scope.now },
    });
    return {
      changed: true,
      warnings: await this.anchorDuplicateWarnings(scope.tx, anchor, candidateId),
    };
  }

  /**
   * ② 소싱 선택 변경(같은 앵커 키 안에서 살 샵을 바꿈, P2-03이 쓴다). 진행 중 같은 itemCode+색상이 있으면 409
   * CANDIDATE_DUPLICATE. 확정된 앵커와 다른 앵커의 행이면(anchor를 주면 비교) 409 ANCHOR_KEY_MISMATCH.
   * 바꾸면 G2 지문이 달라진다 — 같은 트랜잭션에서 후보 상태를 다시 계산한다(게이트 무효면 승인대기 → 작업중).
   * DB 부분 UNIQUE에 걸리는 동시 요청은 `withDuplicateMapping`으로 감싸 409로 바꾼다.
   */
  async changeSourcingSelection(
    scope: StepEngineTx,
    candidateId: number,
    input: ItemColorKey & { anchor?: AnchorKeyInput },
  ): Promise<{ changed: boolean; warnings: CandidateWarning[] }> {
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    this.guard.assertMutable(candidate);
    if (input.anchor && candidate.anchorFixedAt !== null) {
      if (!sameAnchor(candidate, normalizeAnchor(input.anchor))) throw anchorMismatch(candidate);
    }
    const warnings = await this.anchorDuplicateWarnings(scope.tx, candidate, candidateId);
    if (candidate.itemCode === input.itemCode && candidate.selectedColor === input.selectedColor) {
      return { changed: false, warnings };
    }
    await this.assertNoDuplicate(scope.tx, input, candidateId);
    // G2 지문은 소싱 선택(itemCode·색상)을 담는다 → 바꾸기 전 지문 상태를 보고, 바꾼 뒤 무효 감지(P1-06 규칙 9)
    const gatesBefore = await this.gates.snapshot?.(scope.tx, candidateId);
    await scope.tx.candidate.update({
      where: { id: candidateId },
      data: { itemCode: input.itemCode, selectedColor: input.selectedColor },
    });
    await this.status.reevaluate(scope, candidateId);
    if (gatesBefore) await this.gates.detectInvalidation?.(scope, candidateId, gatesBefore);
    return { changed: true, warnings };
  }

  /**
   * DB가 진행 중 같은 itemCode+색상을 막으면(동시 요청, 23505) 기존 후보 id를 찾아 409 CANDIDATE_DUPLICATE로 바꾼다.
   * 500으로 새지 않게 트랜잭션 바깥에서 감싼다.
   */
  async withDuplicateMapping<T>(
    key: ItemColorKey | null,
    fn: () => Promise<T>,
    excludeCandidateId?: number,
  ): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (key && isActiveItemColorViolation(error)) {
        const existing = await this.findActiveDuplicate(this.prisma, key, excludeCandidateId);
        throw duplicateError(existing);
      }
      throw error;
    }
  }
}

export function duplicateError(existingCandidateId: number | null): ApiException {
  return new ApiException('CANDIDATE_DUPLICATE', {
    details: existingCandidateId !== null ? { existingCandidateId } : {},
  });
}

function anchorMismatch(current: AnchorFields): ApiException {
  return new ApiException('ANCHOR_KEY_MISMATCH', {
    details: {
      anchorModelCode: current.anchorModelCode,
      anchorItemCode: current.anchorItemCode,
      anchorColorCode: current.anchorColorCode,
    },
  });
}
