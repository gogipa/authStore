import { Injectable } from '@nestjs/common';
import type { GenerationRun, Prisma } from '../../../generated/prisma/client.js';
import type { ThumbnailSelectionOutput } from './thumbnail-selection.js';

type Db = Prisma.TransactionClient;

/** 버전의 G3 선택(+ 이미지, 순서대로) */
export type SelectionWithImages = Prisma.ThumbnailSelectionGetPayload<{
  include: { images: { include: { imageAsset: true } } };
}>;

/** 오너 수정 사슬을 따라가는 최대 깊이(무한 고리 방지) */
const MAX_BASE_DEPTH = 100;

/**
 * ⑤ G3 선택본·생성 시도 읽기/쓰기(ERD §3.7 `thumbnail_selection`·`thumbnail_selection_image`·`generation_run`, P3-02).
 * `thumbnail_selection`(+image)은 `trg_output_frozen` 대상이라 ⑤ 버전이 열려 있을 때(실행기 `persist` — 닫기 전) 쓴다.
 */
@Injectable()
export class ThumbnailSelectionRepository {
  /** 버전의 G3 선택(없으면 null) */
  selectionOf(db: Db, stepRunId: number): Promise<SelectionWithImages | null> {
    return db.thumbnailSelection.findUnique({
      where: { stepRunId },
      include: { images: { orderBy: { sortOrder: 'asc' }, include: { imageAsset: true } } },
    });
  }

  /** 선택 1행 + 이미지 1~10행(대표 REPRESENTATIVE·0, 추가 ADDITIONAL·1~9) */
  async write(db: Db, stepRunId: number, output: ThumbnailSelectionOutput): Promise<number> {
    const selection = await db.thumbnailSelection.create({
      data: {
        stepRunId,
        checklist: output.checklist,
        sameProductColorConfirmedAt: output.sameProductColorConfirmedAt,
        selectedAt: output.selectedAt,
      },
    });
    await db.thumbnailSelectionImage.createMany({
      data: output.images.map((image) => ({
        thumbnailSelectionId: selection.id,
        imageAssetId: image.imageAssetId,
        role: image.role,
        sortOrder: image.sortOrder,
      })),
    });
    return selection.id;
  }

  /** 버전 복사(이전 버전 다시 고르기 — 새 버전으로 선택을 그대로). 복사했으면 새 선택 id */
  async copy(db: Db, fromStepRunId: number, toStepRunId: number): Promise<number | null> {
    const from = await this.selectionOf(db, fromStepRunId);
    if (!from) return null;
    return this.write(db, toStepRunId, {
      kind: 'THUMBNAIL_SELECTION',
      checklist: from.checklist as unknown as ThumbnailSelectionOutput['checklist'],
      sameProductColorConfirmedAt: from.sameProductColorConfirmedAt,
      selectedAt: from.selectedAt,
      images: from.images.map((image) => ({
        imageAssetId: image.imageAssetId,
        role: image.role as ThumbnailSelectionOutput['images'][number]['role'],
        sortOrder: image.sortOrder,
      })),
    });
  }

  /**
   * 생성 시도를 가진 ⑤ 버전(P3-02 Proposed — 주의 '같은 실행' 판정): 오너 수정 버전(G3 다시 고르기·이전 버전 다시 고르기)은
   * 자기 `generation_run`이 없으므로 `base_step_run_id`를 따라 오너 수정이 아닌 버전까지 올라간다. 그 밖의 버전은 자기 자신
   */
  async generationSourceRunId(db: Db, stepRunId: number): Promise<number> {
    let id = stepRunId;
    for (let depth = 0; depth < MAX_BASE_DEPTH; depth += 1) {
      const run = await db.stepRun.findUnique({
        where: { id },
        select: { id: true, executionMode: true, baseStepRunId: true },
      });
      if (!run || run.executionMode !== 'OWNER_EDIT' || run.baseStepRunId === null) return id;
      id = run.baseStepRunId;
    }
    return id;
  }

  /** 버전의 생성 시도(번호·회차 순) */
  generationRunsOf(db: Db, stepRunId: number): Promise<GenerationRun[]> {
    return db.generationRun.findMany({
      where: { stepRunId },
      orderBy: [{ slotNo: 'asc' }, { attemptNo: 'asc' }],
    });
  }

  /** 이 버전에서 생성 중인 시도 */
  runningOf(db: Db, stepRunId: number): Promise<GenerationRun[]> {
    return db.generationRun.findMany({ where: { stepRunId, status: 'RUNNING' } });
  }

  /** 생성본 이미지 → 그 생성 시도 id(여러 이미지) */
  async generationRunIdsOf(db: Db, imageAssetIds: readonly number[]): Promise<Map<number, number>> {
    if (imageAssetIds.length === 0) return new Map();
    const rows = await db.generationRun.findMany({
      where: { resultImageAssetId: { in: [...imageAssetIds] } },
      select: { id: true, resultImageAssetId: true },
    });
    return new Map(rows.map((row) => [row.resultImageAssetId!, row.id]));
  }
}
