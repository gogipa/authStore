import type { Prisma } from '../../../generated/prisma/client.js';

type Db = Prisma.TransactionClient;

/** ⑧ 실행 결과(엔진은 해석하지 않고 `persist`에 넘긴다) */
export interface UploadOutput {
  kind: 'UPLOAD_RESULT';
  detailContent: string;
  detailContentSha256: string;
  /** G3 선택본과 같은 역할·순서(`ck_upload_img_rep`: REPRESENTATIVE ⇔ 0) */
  images: { uploadedImageId: number; role: 'REPRESENTATIVE' | 'ADDITIONAL'; sortOrder: number }[];
}

export function isUploadOutput(value: unknown): value is UploadOutput {
  return (value as { kind?: unknown } | null)?.kind === 'UPLOAD_RESULT';
}

/**
 * `upload_result`(+ `upload_result_image`) 쓰기(ERD §3.10, 규칙 12). ⑧ 버전의 1:1 산출물이고 `trg_output_frozen` 대상이라 끝
 * 트랜잭션 `persist`(실행이 열려 있을 때)나 오너 수정 새 버전(`copyOutput` — 이전 버전 다시 고르기)에서만 쓴다. 같은 실행에 이미
 * 있으면 다시 쓰지 않는다
 */
export async function insertUploadResult(
  tx: Db,
  stepRunId: number,
  output: Omit<UploadOutput, 'kind'>,
): Promise<number> {
  const existing = await tx.uploadResult.findUnique({ where: { stepRunId }, select: { id: true } });
  if (existing) return existing.id;
  const row = await tx.uploadResult.create({
    data: {
      stepRunId,
      detailContent: output.detailContent,
      detailContentSha256: output.detailContentSha256,
      images: {
        create: [...output.images]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((image) => ({
            uploadedImageId: image.uploadedImageId,
            role: image.role,
            sortOrder: image.sortOrder,
          })),
      },
    },
    select: { id: true },
  });
  return row.id;
}

/** ⑧ 버전의 산출물(이미지 sort_order 순, 업로드 URL 포함). 없으면 null */
export function readUploadResult(db: Db, stepRunId: number) {
  return db.uploadResult.findUnique({
    where: { stepRunId },
    include: {
      images: { orderBy: { sortOrder: 'asc' }, include: { uploadedImage: true } },
    },
  });
}

/** 이전 버전 다시 고르기(RESTORE_VERSION): 바탕 버전의 본문·이미지를 새 버전으로 그대로 복사한다. 바탕에 없으면 false */
export async function copyUploadResult(
  tx: Db,
  fromStepRunId: number,
  toStepRunId: number,
): Promise<boolean> {
  const from = await readUploadResult(tx, fromStepRunId);
  if (!from) return false;
  await insertUploadResult(tx, toStepRunId, {
    detailContent: from.detailContent,
    detailContentSha256: from.detailContentSha256,
    images: from.images.map((image) => ({
      uploadedImageId: image.uploadedImageId,
      role: image.role === 'REPRESENTATIVE' ? 'REPRESENTATIVE' : 'ADDITIONAL',
      sortOrder: image.sortOrder,
    })),
  });
  return true;
}
