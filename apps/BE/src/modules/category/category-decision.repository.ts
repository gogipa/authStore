import { Injectable } from '@nestjs/common';
import type { CategoryDecision, Prisma } from '../../generated/prisma/client.js';
import type { Tx } from '../step-engine/contracts/step-runner.js';
import type { CategoryCandidateSource, CategoryOptionEntry } from './rules/category-options.js';

type Db = Prisma.TransactionClient;

/** 후보 목록 쓰기(입력 대기·성별 재확인) */
export interface CategoryOptionsDraft {
  inputGenreId: number | null;
  inputProductType: string | null;
  gender: 'MALE' | 'FEMALE';
  candidateSource: CategoryCandidateSource;
  categoryOptions: CategoryOptionEntry[];
}

/** 고른 리프 쓰기(고르기 API·자동 완료) */
export interface CategorySelectionWrite {
  leafCategoryId: string;
  wholeCategoryName: string;
  genderPathMatch: boolean;
  /** 카테고리 상세 exceptionalCategories 원문(값 복사 — 재동기화로 캐시가 바뀌어도 그때 값). 없으면 null */
  exceptionalCategories: Prisma.InputJsonValue | null;
  exceptionDecision: 'PASS' | 'KC_EXEMPT';
  kcExemptAdultConfirmedAt: Date | null;
  certificationExcludeContent: Prisma.InputJsonObject | null;
  decidedAt: Date;
}

/**
 * ④ 산출물(`category_decision`, 버전당 1행) 읽기·쓰기(P2-06). 입력 대기 동안만 고칠 수 있다(`category_decision_frozen`
 * 트리거) — 쓰기는 실행기 `persist`(끝 트랜잭션, step_run이 닫히기 전)와 성별 재확인 리스너(입력 대기 중)만 부른다.
 * `commerce_category`에 FK가 없다(값 복사).
 */
@Injectable()
export class CategoryDecisionRepository {
  findByStepRun(db: Db, stepRunId: number): Promise<CategoryDecision | null> {
    return db.categoryDecision.findUnique({ where: { stepRunId } });
  }

  findById(db: Db, id: number) {
    return db.categoryDecision.findUnique({ where: { id }, include: { stepRun: true } });
  }

  /** 입력 대기로 멈출 때 후보 목록을 쓴다(같은 실행에 이미 있으면 그대로) */
  async insertOptions(tx: Tx, stepRunId: number, draft: CategoryOptionsDraft): Promise<void> {
    if (await this.findByStepRun(tx, stepRunId)) return;
    await tx.categoryDecision.create({
      data: {
        stepRunId,
        inputGenreId: draft.inputGenreId,
        inputProductType: draft.inputProductType,
        gender: draft.gender,
        candidateSource: draft.candidateSource,
        categoryOptions: draft.categoryOptions as unknown as Prisma.InputJsonArray,
      },
    });
  }

  /** 후보가 하나라 곧바로 완료(자동, Proposed): 후보 목록과 고른 리프를 함께 쓴다 */
  async insertDecided(
    tx: Tx,
    stepRunId: number,
    draft: CategoryOptionsDraft,
    selection: CategorySelectionWrite,
  ): Promise<void> {
    if (await this.findByStepRun(tx, stepRunId)) return;
    await tx.categoryDecision.create({
      data: {
        stepRunId,
        inputGenreId: draft.inputGenreId,
        inputProductType: draft.inputProductType,
        gender: draft.gender,
        candidateSource: draft.candidateSource,
        categoryOptions: draft.categoryOptions as unknown as Prisma.InputJsonArray,
        ...selectionData(selection),
      },
    });
  }

  /** 고르기 반영(입력 대기 중인 결정 — 끝 트랜잭션에서 step_run을 닫기 전) */
  async applySelection(
    tx: Tx,
    stepRunId: number,
    selection: CategorySelectionWrite,
  ): Promise<void> {
    await tx.categoryDecision.update({ where: { stepRunId }, data: selectionData(selection) });
  }

  /** 성별 재확인(같은 실행): 성별·후보 목록을 새로 쓰고 `gender_changed_in_run=true` */
  async applyGenderRecheck(
    tx: Tx,
    id: number,
    draft: Pick<CategoryOptionsDraft, 'gender' | 'candidateSource' | 'categoryOptions'>,
  ): Promise<CategoryDecision> {
    return tx.categoryDecision.update({
      where: { id },
      data: {
        gender: draft.gender,
        genderChangedInRun: true,
        candidateSource: draft.candidateSource,
        categoryOptions: draft.categoryOptions as unknown as Prisma.InputJsonArray,
      },
    });
  }

  /** 이전 버전 다시 고르기(RESTORE_VERSION): 결정을 새 버전으로 그대로 복사한다. 복사한 결정 */
  async copy(tx: Tx, fromStepRunId: number, toStepRunId: number): Promise<CategoryDecision | null> {
    const from = await this.findByStepRun(tx, fromStepRunId);
    if (!from) return null;
    return tx.categoryDecision.create({
      data: {
        stepRunId: toStepRunId,
        inputGenreId: from.inputGenreId,
        inputProductType: from.inputProductType,
        gender: from.gender,
        genderChangedInRun: from.genderChangedInRun,
        candidateSource: from.candidateSource,
        categoryOptions: from.categoryOptions as Prisma.InputJsonValue,
        leafCategoryId: from.leafCategoryId,
        wholeCategoryName: from.wholeCategoryName,
        genderPathMatch: from.genderPathMatch,
        ...(from.exceptionalCategories !== null
          ? { exceptionalCategories: from.exceptionalCategories }
          : {}),
        exceptionDecision: from.exceptionDecision,
        blockReason: from.blockReason,
        kcExemptAdultConfirmedAt: from.kcExemptAdultConfirmedAt,
        ...(from.certificationExcludeContent !== null
          ? { certificationExcludeContent: from.certificationExcludeContent }
          : {}),
        decidedAt: from.decidedAt,
      },
    });
  }
}

function selectionData(selection: CategorySelectionWrite) {
  return {
    leafCategoryId: selection.leafCategoryId,
    wholeCategoryName: selection.wholeCategoryName,
    genderPathMatch: selection.genderPathMatch,
    ...(selection.exceptionalCategories !== null
      ? { exceptionalCategories: selection.exceptionalCategories }
      : {}),
    exceptionDecision: selection.exceptionDecision,
    blockReason: null,
    kcExemptAdultConfirmedAt: selection.kcExemptAdultConfirmedAt,
    ...(selection.certificationExcludeContent !== null
      ? { certificationExcludeContent: selection.certificationExcludeContent }
      : {}),
    decidedAt: selection.decidedAt,
  };
}
