import type { Db } from '../../step-engine/candidates/step-engine-tx.js';
import type {
  ThumbnailSelectionReader,
  ThumbnailSelectionView,
} from '../../step-engine/ports/step-output-readers.port.js';

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
  const selection = await db.thumbnailSelection.findUnique({
    where: { stepRunId: step.currentStepRunId },
    select: {
      images: {
        orderBy: { sortOrder: 'asc' },
        select: { imageAssetId: true, role: true, sortOrder: true },
      },
    },
  });
  if (!selection) return null;
  return {
    thumbnailStepRunId: step.currentStepRunId,
    images: selection.images.map((image) => ({
      imageAssetId: image.imageAssetId,
      role: image.role === 'REPRESENTATIVE' ? 'REPRESENTATIVE' : 'ADDITIONAL',
      sortOrder: image.sortOrder,
    })),
  };
}

export const thumbnailSelectionReader: ThumbnailSelectionReader = {
  readCurrentSelection: readCurrentThumbnailSelection,
};
