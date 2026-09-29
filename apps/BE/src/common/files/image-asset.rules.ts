/**
 * image_asset 규칙(ERD §3.6 CHECK)을 앱에서 먼저 검사한다. DB CHECK가 마지막 방어선이다.
 * 순수 함수라 단위 테스트로 고정한다.
 */

export const IMAGE_ASSET_KINDS = ['ORIGINAL', 'REFERENCE', 'GENERATED', 'UPLOAD'] as const;
export type ImageAssetKind = (typeof IMAGE_ASSET_KINDS)[number];

export const IMAGE_USAGE_RIGHTS = ['REFERENCE_ONLY', 'PERMITTED'] as const;
export type ImageUsageRight = (typeof IMAGE_USAGE_RIGHTS)[number];

export const IMAGE_SOURCE_SECTIONS = ['PRODUCT_IMAGE', 'DESCRIPTION_IMAGE'] as const;
export type ImageSourceSection = (typeof IMAGE_SOURCE_SECTIONS)[number];

/** 업로드본 크기 상한(미만, ck_image_asset_upload·RG-05) */
export const UPLOAD_MAX_BYTES_EXCLUSIVE = 10_485_760;
/** 업로드본 해상도(ck_image_asset_upload·F-AP-12) */
export const UPLOAD_SIZE_PX = 1000;

/** 파일 내용으로 판별해 받는 형식(mime → 저장 확장자). 그 밖은 거부 */
export const SUPPORTED_IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
} as const;
export type SupportedImageMime = keyof typeof SUPPORTED_IMAGE_TYPES;

/** 종류별 권리 용도: 원본·레퍼런스는 참조 전용, 앱이 만든 생성·업로드본은 허락됨(ck_image_asset_right_by_kind) */
export function usageRightForKind(kind: ImageAssetKind): ImageUsageRight {
  return kind === 'ORIGINAL' || kind === 'REFERENCE' ? 'REFERENCE_ONLY' : 'PERMITTED';
}

/** saveImage의 입력 메타(파일에서 읽는 값·sha256·경로는 서비스가 채운다) */
export interface SaveImageMeta {
  kind: ImageAssetKind;
  /** 생략하면 종류로 정한다. 주면 종류와 맞아야 한다 */
  usageRight?: ImageUsageRight;
  /** ORIGINAL만 NULL, 나머지는 필수(ck_image_asset_candidate) */
  candidateId?: number | null;
  /** UPLOAD는 필수(원 생성본) */
  derivedFromImageAssetId?: number | null;
  /** ORIGINAL만, 필수 */
  sourceSection?: ImageSourceSection | null;
  /** ORIGINAL 필수 */
  sourceUrl?: string | null;
  /** ORIGINAL 필수(정규화한 라쿠텐 itemCode) */
  sourceItemCode?: string | null;
  sourceShopCode?: string | null;
  sourceModelCodeNorm?: string | null;
  sourceColorCode?: string | null;
  /** ORIGINAL 필수 */
  collectedAt?: Date | null;
}

/** 파일 내용에서 판별한 값 */
export interface DetectedImageInfo {
  mimeType: string;
  width: number;
  height: number;
  byteSize: number;
}

/** 규칙 위반(앱 코드의 잘못). 호출한 쪽이 고쳐야 한다 */
export class ImageAssetRuleError extends Error {
  constructor(readonly violations: string[]) {
    super(`image_asset 규칙 위반: ${violations.join(' / ')}`);
  }
}

/** 형식을 받을 수 없음(내용이 이미지가 아니거나 지원 밖 형식) */
export class UnsupportedImageError extends Error {
  constructor(readonly detected: string | null) {
    super(
      `받을 수 없는 이미지 형식입니다(${detected ?? '알 수 없음'}). 가능: ${Object.keys(SUPPORTED_IMAGE_TYPES).join(', ')}`,
    );
  }
}

const present = (v: unknown): boolean => v !== null && v !== undefined && v !== '';

/** 열 길이(ERD §3.6 varchar) */
const MAX_LENGTHS: readonly [keyof SaveImageMeta, number][] = [
  ['sourceUrl', 2048],
  ['sourceItemCode', 128],
  ['sourceShopCode', 64],
  ['sourceModelCodeNorm', 128],
  ['sourceColorCode', 64],
];

/** ERD §3.6 CHECK 10개를 앱에서 검사한다. 위반이 있으면 ImageAssetRuleError */
export function assertImageAssetRules(meta: SaveImageMeta, info: DetectedImageInfo): void {
  const v: string[] = [];
  const { kind } = meta;
  if (!(IMAGE_ASSET_KINDS as readonly string[]).includes(kind)) {
    v.push(`kind는 ${IMAGE_ASSET_KINDS.join('·')} 중 하나`);
  } else {
    const expectedRight = usageRightForKind(kind);
    if (meta.usageRight !== undefined && meta.usageRight !== expectedRight) {
      v.push(`${kind}의 usageRight는 ${expectedRight}`);
    }
    if (kind === 'ORIGINAL') {
      if (present(meta.candidateId)) v.push('ORIGINAL은 candidateId가 없어야 한다');
      if (!present(meta.sourceUrl)) v.push('ORIGINAL은 sourceUrl 필수');
      if (!present(meta.sourceItemCode)) v.push('ORIGINAL은 sourceItemCode 필수');
      if (!present(meta.collectedAt)) v.push('ORIGINAL은 collectedAt 필수');
      if (!present(meta.sourceSection)) v.push('ORIGINAL은 sourceSection 필수');
    } else {
      if (!present(meta.candidateId)) v.push(`${kind}는 candidateId 필수`);
      if (present(meta.sourceSection)) v.push('sourceSection은 ORIGINAL만');
    }
    if (kind === 'UPLOAD') {
      if (!present(meta.derivedFromImageAssetId)) v.push('UPLOAD는 derivedFromImageAssetId 필수');
      if (info.mimeType !== 'image/jpeg') v.push('UPLOAD는 JPEG');
      if (info.width !== UPLOAD_SIZE_PX || info.height !== UPLOAD_SIZE_PX) {
        v.push(`UPLOAD는 ${UPLOAD_SIZE_PX}×${UPLOAD_SIZE_PX}`);
      }
      if (info.byteSize >= UPLOAD_MAX_BYTES_EXCLUSIVE)
        v.push('UPLOAD는 10MB(10,485,760바이트) 미만');
    }
  }
  if (
    present(meta.sourceSection) &&
    !(IMAGE_SOURCE_SECTIONS as readonly string[]).includes(meta.sourceSection as string)
  ) {
    v.push(`sourceSection은 ${IMAGE_SOURCE_SECTIONS.join('·')} 중 하나`);
  }
  for (const [field, max] of MAX_LENGTHS) {
    const value = meta[field];
    if (typeof value === 'string' && value.length > max) v.push(`${field}는 ${max}자 이하`);
  }
  if (!(info.width > 0 && info.height > 0 && info.byteSize > 0)) {
    v.push('width·height·byteSize는 0보다 커야 한다');
  }
  if (v.length > 0) throw new ImageAssetRuleError(v);
}
