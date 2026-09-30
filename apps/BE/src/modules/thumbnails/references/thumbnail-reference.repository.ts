import { Injectable } from '@nestjs/common';
import type { ImageAsset, Prisma } from '../../../generated/prisma/client.js';
import { referenceSetSha256 } from './reference-set-hash.js';

type Db = Prisma.TransactionClient;

/** 레퍼런스 한 장 고르기(순서 1~3) */
export interface ReferenceChoice {
  imageAssetId: number;
  sortOrder: number;
}

/** 확인 시각이 붙은 레퍼런스 한 장 */
export interface ConfirmedReference extends ReferenceChoice {
  noPersonConfirmedAt: Date;
}

/** 후보 단위 선택 한 번(`thumbnail_reference_input`의 같은 input_no 행들) */
export interface ReferenceInputSelection {
  inputNo: number;
  rows: (ConfirmedReference & { image: ImageAsset })[];
}

/** 버전의 레퍼런스 한 장(thumbnail_reference + 이미지) */
export type ReferenceRowWithImage = Prisma.ThumbnailReferenceGetPayload<{
  include: { imageAsset: true };
}>;

/** 레퍼런스가 될 수 있는 원본인가(P3-01 규칙 7: 이 itemCode의 ORIGINAL·PRODUCT_IMAGE) */
export function isReferenceableOriginal(image: ImageAsset, itemCode: string | null): boolean {
  return (
    itemCode !== null &&
    image.kind === 'ORIGINAL' &&
    image.sourceSection === 'PRODUCT_IMAGE' &&
    image.sourceItemCode === itemCode
  );
}

/** 두 선택이 같은가(이미지·순서 쌍이 모두 같다) */
export function sameChoices(a: readonly ReferenceChoice[], b: readonly ReferenceChoice[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: ReferenceChoice) => `${c.sortOrder}:${c.imageAssetId}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((v, i) => v === right[i]);
}

/**
 * ⑤ 레퍼런스 표(ERD §3.7): 후보 단위 선택 이력 `thumbnail_reference_input`(추가만 — trg_append_only)과 ⑤ 버전이 쓴
 * `thumbnail_reference`(열린 ⑤에서만 바꿀 수 있다 — trg_output_frozen).
 */
@Injectable()
export class ThumbnailReferenceRepository {
  /** 후보의 최신 선택(최대 input_no). 없으면 null */
  async latestInput(db: Db, candidateId: number): Promise<ReferenceInputSelection | null> {
    const top = await db.thumbnailReferenceInput.findFirst({
      where: { candidateId },
      orderBy: { inputNo: 'desc' },
      select: { inputNo: true },
    });
    if (!top) return null;
    const rows = await db.thumbnailReferenceInput.findMany({
      where: { candidateId, inputNo: top.inputNo },
      orderBy: { sortOrder: 'asc' },
      include: { imageAsset: true },
    });
    return {
      inputNo: top.inputNo,
      rows: rows.map((row) => ({
        imageAssetId: row.imageAssetId,
        sortOrder: row.sortOrder,
        noPersonConfirmedAt: row.noPersonConfirmedAt,
        image: row.imageAsset,
      })),
    };
  }

  /**
   * 후보의 최신 선택이 이 itemCode의 원본으로만 되어 있으면 그 선택(⑤ 다시 실행 기본값, P3-01 규칙 6), 아니면 null
   */
  async latestEligibleInput(
    db: Db,
    candidateId: number,
    itemCode: string | null,
  ): Promise<ReferenceInputSelection | null> {
    const latest = await this.latestInput(db, candidateId);
    if (!latest || latest.rows.length === 0) return null;
    return latest.rows.every((row) => isReferenceableOriginal(row.image, itemCode)) ? latest : null;
  }

  /** 최신 선택(이 itemCode 원본일 때만)의 레퍼런스 해시 — `owner.referenceSelection` 값. 없으면 null */
  async latestSelectionHash(
    db: Db,
    candidateId: number,
    itemCode: string | null,
  ): Promise<string | null> {
    const latest = await this.latestEligibleInput(db, candidateId, itemCode);
    return latest ? referenceSetSha256(latest.rows.map((row) => row.image.sha256)) : null;
  }

  /** 새 선택 한 번(input_no 행 1~3개, 추가만) */
  async insertInput(
    tx: Db,
    candidateId: number,
    inputNo: number,
    choices: readonly ReferenceChoice[],
    confirmedAt: Date,
  ): Promise<void> {
    await tx.thumbnailReferenceInput.createMany({
      data: choices.map((choice) => ({
        candidateId,
        inputNo,
        imageAssetId: choice.imageAssetId,
        sortOrder: choice.sortOrder,
        noPersonConfirmedAt: confirmedAt,
        enteredAt: confirmedAt,
      })),
    });
  }

  /** 버전의 레퍼런스(순서대로, 이미지 포함) */
  referencesOf(db: Db, stepRunId: number): Promise<ReferenceRowWithImage[]> {
    return db.thumbnailReference.findMany({
      where: { stepRunId },
      orderBy: { sortOrder: 'asc' },
      include: { imageAsset: true },
    });
  }

  /** 열린 ⑤ 버전의 레퍼런스를 이 선택으로 바꾼다(지우고 넣기 — 닫힌 버전이면 trg_output_frozen이 막는다) */
  async replaceReferences(
    tx: Db,
    stepRunId: number,
    rows: readonly ConfirmedReference[],
    createdAt: Date,
  ): Promise<void> {
    await tx.thumbnailReference.deleteMany({ where: { stepRunId } });
    if (rows.length === 0) return;
    await tx.thumbnailReference.createMany({
      data: rows.map((row) => ({
        stepRunId,
        imageAssetId: row.imageAssetId,
        sortOrder: row.sortOrder,
        noPersonConfirmedAt: row.noPersonConfirmedAt,
        createdAt,
      })),
    });
  }

  /** 버전 복사(오너 수정·다시 고르기 — 새 버전으로 레퍼런스 행을 그대로). 복사한 행 수 */
  async copyReferences(tx: Db, fromStepRunId: number, toStepRunId: number): Promise<number> {
    const rows = await tx.thumbnailReference.findMany({
      where: { stepRunId: fromStepRunId },
      orderBy: { sortOrder: 'asc' },
    });
    if (rows.length === 0) return 0;
    await tx.thumbnailReference.createMany({
      data: rows.map((row) => ({
        stepRunId: toStepRunId,
        imageAssetId: row.imageAssetId,
        sortOrder: row.sortOrder,
        noPersonConfirmedAt: row.noPersonConfirmedAt,
        createdAt: row.createdAt,
      })),
    });
    return rows.length;
  }

  /** 이 ⑤ 버전에서 생성 중인 시도 수(P3-02 generation_run RUNNING) */
  runningGenerationCount(db: Db, stepRunId: number): Promise<number> {
    return db.generationRun.count({ where: { stepRunId, status: 'RUNNING' } });
  }
}
