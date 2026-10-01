import type { Db } from '../../step-engine/candidates/step-engine-tx.js';
import type {
  ThumbnailSelectionDetailView,
  ThumbnailSelectionReader,
  ThumbnailSelectionView,
} from '../../step-engine/ports/step-output-readers.port.js';
import { uncheckedKeys } from '../gate/g3-rules.js';

/**
 * ⑤ 버전 하나(step_run id)의 G3 선택본(P4-01 — ⑧ 업로드 입력, step-engine 창구 `StepEngineApi.readThumbnailSelectionOf`).
 * `thumbnail_selection_image`를 `sort_order` 순서로 준다. 선택이 없으면(입력 대기·선택 전) null.
 */
export async function readThumbnailSelectionOf(
  db: Db,
  thumbnailStepRunId: number,
): Promise<ThumbnailSelectionView | null> {
  const selection = await db.thumbnailSelection.findUnique({
    where: { stepRunId: thumbnailStepRunId },
    select: {
      images: {
        orderBy: { sortOrder: 'asc' },
        select: { imageAssetId: true, role: true, sortOrder: true },
      },
    },
  });
  if (!selection) return null;
  return {
    thumbnailStepRunId,
    images: selection.images.map((image) => ({
      imageAssetId: image.imageAssetId,
      role: image.role === 'REPRESENTATIVE' ? 'REPRESENTATIVE' : 'ADDITIONAL',
      sortOrder: image.sortOrder,
    })),
  };
}

/**
 * ⑤ G3 선택본 읽기(P3-04 Proposed — step-engine 창구 `StepEngineApi.readThumbnailSelection`, C4 §3.1). ⑥-3 미리보기가 이미지
 * 자리표시자를 '지금 선택된 로컬 이미지'로 채울 때 쓴다(F-CT-31). ⑤ 현재 버전(`candidate_step.current_step_run_id`)의
 * `thumbnail_selection_image`를 `sort_order` 순서로 준다. ⑤ 미실행·선택 전(입력 대기)이면 null.
 */
export async function readCurrentThumbnailSelection(
  db: Db,
  candidateId: number,
): Promise<ThumbnailSelectionView | null> {
  const step = await db.candidateStep.findUnique({
    where: { candidateId_stepCode: { candidateId, stepCode: 'THUMBNAIL' } },
    select: { currentStepRunId: true },
  });
  if (!step?.currentStepRunId) return null;
  return readThumbnailSelectionOf(db, step.currentStepRunId);
}

/**
 * ⑤ 버전 하나의 G3 선택 기록(P4-02 — step-engine 창구 `StepEngineApi.readThumbnailSelectionDetail`). 최종 승인 사전 검증
 * `REPRESENTATIVE_IMAGE_SOURCE`(F-AP-22)가 읽는다: 체크리스트에서 true가 아닌 항목(`uncheckedKeys` — G3 검사와 같은 함수),
 * '같은 상품·색상' 확인 시각, 이 버전 레퍼런스의 출처 앵커 필드(`image_asset`). 앵커 비교 규칙은 공용
 * `common/rules/anchor-key.ts`(`needsSameProductColorConfirmation`)를 registration이 같이 쓴다. 선택이 없으면 null.
 */
export async function readThumbnailSelectionDetail(
  db: Db,
  thumbnailStepRunId: number,
): Promise<ThumbnailSelectionDetailView | null> {
  const selection = await db.thumbnailSelection.findUnique({
    where: { stepRunId: thumbnailStepRunId },
    select: { checklist: true, sameProductColorConfirmedAt: true },
  });
  if (!selection) return null;
  const references = await db.thumbnailReference.findMany({
    where: { stepRunId: thumbnailStepRunId },
    orderBy: { sortOrder: 'asc' },
    select: {
      imageAsset: {
        select: {
          id: true,
          sourceItemCode: true,
          sourceModelCodeNorm: true,
          sourceColorCode: true,
        },
      },
    },
  });
  const checklist =
    selection.checklist !== null &&
    typeof selection.checklist === 'object' &&
    !Array.isArray(selection.checklist)
      ? (selection.checklist as Record<string, unknown>)
      : {};
  return {
    thumbnailStepRunId,
    checklistVersion: typeof checklist.version === 'string' ? checklist.version : null,
    uncheckedChecklistKeys: uncheckedKeys(checklist),
    sameProductColorConfirmedAt: selection.sameProductColorConfirmedAt,
    references: references.map(({ imageAsset }) => ({
      imageAssetId: imageAsset.id,
      sourceItemCode: imageAsset.sourceItemCode,
      sourceModelCodeNorm: imageAsset.sourceModelCodeNorm,
      sourceColorCode: imageAsset.sourceColorCode,
    })),
  };
}

export const thumbnailSelectionReader: ThumbnailSelectionReader = {
  readCurrentSelection: readCurrentThumbnailSelection,
  readSelection: readThumbnailSelectionOf,
  readSelectionDetail: readThumbnailSelectionDetail,
};
