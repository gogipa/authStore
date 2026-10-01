import type { components } from '@/shared/api/schema';

type UploadResultOutput = components['schemas']['UploadResultOutput'];
type UploadResultImageItem = components['schemas']['UploadResultImageItem'];

const AT = '2026-09-28T05:42:00.000Z';

/** 업로드 이미지 한 장(가짜 shop-phinf 주소 — 실제 주소 아님. FE 규칙 15로 소스에 scheme을 적지 않는다) */
export function uploadResultImage(
  patch: Partial<UploadResultImageItem> & { sortOrder: number },
): UploadResultImageItem {
  return {
    id: patch.sortOrder + 1,
    uploadedImageId: patch.sortOrder + 11,
    role: patch.sortOrder === 0 ? 'REPRESENTATIVE' : 'ADDITIONAL',
    url: `shop-phinf.pstatic.net/fake/upload-${patch.sortOrder + 1}.jpg`,
    sourceSha256: String(patch.sortOrder).repeat(64),
    imageAssetId: patch.sortOrder + 31,
    uploadedAt: AT,
    traceId: 'fixture-trace-upload-200',
    reused: false,
    ...patch,
  };
}

/** ⑧ 한 버전(05-2 UploadResultOutput): 대표·추가 2장 */
export function uploadResultOutput(patch: Partial<UploadResultOutput> = {}): UploadResultOutput {
  return {
    stepRunId: 108,
    candidateId: 1,
    version: 1,
    stepRunStatus: 'COMPLETED',
    isCurrent: true,
    uploadResultId: 1,
    detailContent:
      '<div data-autostore-detail="v1"><p data-autostore-image-slot="0"><img src="shop-phinf.pstatic.net/fake/upload-1.jpg" alt="대표 이미지"></p></div>',
    detailContentSha256: 'c'.repeat(64),
    createdAt: AT,
    images: [uploadResultImage({ sortOrder: 0 }), uploadResultImage({ sortOrder: 1 })],
    ...patch,
  };
}
