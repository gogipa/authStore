import type {
  ThumbnailPromptPreview,
  ThumbnailReferencesResult,
  ThumbnailSourceImage,
  ThumbnailSourceImageList,
} from '@/features/thumbnails';

/** 예시 값(화면시안_명세 §4 후보 A — 샵 A 원본 6장, 14:02 받음). 주소는 스킴 없이(규칙 15: 소스에 외부 주소 없음) */
const AT = '2026-09-28T05:02:00.000Z';

export function sourceImage(
  patch: Partial<ThumbnailSourceImage> & { imageAssetId: number },
): ThumbnailSourceImage {
  return {
    kind: 'ORIGINAL',
    sourceSection: 'PRODUCT_IMAGE',
    width: 1200,
    height: 1200,
    byteSize: 180000,
    mimeType: 'image/jpeg',
    sha256: String(patch.imageAssetId).padStart(64, '0'),
    sourceUrl: `tshop.r10s.jp/shop-a/cabinet/item/asics-1201a019-108_${patch.imageAssetId}.jpg`,
    sourceItemCode: 'shop-a:10000123',
    sourceShopCode: 'shop-a',
    sourceModelCodeNorm: '1201A019108',
    sourceColorCode: '108',
    collectedAt: AT,
    usageRight: 'REFERENCE_ONLY',
    derivedFromImageAssetId: null,
    fileUrl: `/api/v1/image-assets/${patch.imageAssetId}/file`,
    isSameAnchor: true,
    personDetected: null,
    autoRecommended: null,
    ...patch,
  };
}

/** 원본 n장(id 1..n) */
export function sourceImageList(count = 6): ThumbnailSourceImageList {
  return {
    itemCode: 'shop-a:10000123',
    items: Array.from({ length: count }, (_, i) => sourceImage({ imageAssetId: i + 1 })),
  };
}

export function referencesResult(
  stepRunId: number,
  imageAssetIds: number[],
  inputNo = 1,
): ThumbnailReferencesResult {
  return {
    stepRunId,
    inputNo,
    references: imageAssetIds.map((imageAssetId, i) => ({
      id: 100 + i,
      imageAssetId,
      sortOrder: i + 1,
      noPersonConfirmedAt: '2026-09-28T05:10:00.000Z',
      createdAt: '2026-09-28T05:10:00.000Z',
      isSameAnchor: true,
      fileUrl: `/api/v1/image-assets/${imageAssetId}/file`,
    })),
    sameProductColorRequired: false,
  };
}

/** 프롬프트 미리보기(기본: 전체 노출, 2K, 차단어 없음) */
export function promptPreview(patch: Partial<ThumbnailPromptPreview> = {}): ThumbnailPromptPreview {
  return {
    prompt:
      'Photorealistic studio product photo, square 1:1, 2048 pixels.\nModel framing: full face.',
    faceOption: 'FULL_FACE',
    requestedSizePx: 2048,
    promptAdjusted: false,
    realPersonNameDetected: false,
    blockedTerms: [],
    generationAllowed: false,
    ...patch,
  };
}
