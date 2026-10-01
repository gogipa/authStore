import sharp from 'sharp';
import {
  UPLOAD_MAX_BYTES_EXCLUSIVE,
  UPLOAD_SIZE_PX,
  type SupportedImageMime,
} from '../../../common/files/image-asset.rules.js';
import { sniffImageMime } from '../../../common/files/image-sniff.js';

/**
 * 정사각이 아닌 원천 처리(P4-01 Proposed — 작업 지시 규칙 6 '자를지 채울지는 문서에 없음'): **채우기**. 원천 전체를 1000×1000 안에
 * 비율대로 넣고(`fit: contain`) 남는 곳은 흰색으로 채운다. 자르기(`cover`)는 신발 앞코·뒤축이 잘릴 수 있어 쓰지 않는다.
 * 투명(알파)도 흰 바탕에 합친다(JPEG에는 알파가 없다).
 */
export const UPLOAD_FIT = 'contain' as const;
/** 채우는 색(흰색 — 상품 이미지 배경 관례) */
export const UPLOAD_BACKGROUND = { r: 255, g: 255, b: 255 } as const;
/** JPEG 품질(먼저 이 값으로, 10MB 미만이 아니면 낮춰 가며 다시 — 1000×1000에서는 사실상 생기지 않는다) */
export const UPLOAD_JPEG_QUALITIES = [90, 80, 70, 60] as const;

/** 정규화할 수 없는 파일(이미지가 아니거나 받지 않는 형식, 깨진 파일) */
export class ImageNormalizeError extends Error {
  constructor(readonly reason: 'UNSUPPORTED_FORMAT' | 'UNREADABLE' | 'TOO_LARGE') {
    super(`업로드용 이미지로 바꿀 수 없습니다(${reason})`);
    this.name = 'ImageNormalizeError';
  }
}

export interface NormalizedUploadImage {
  /** 1000×1000 JPEG 바이트 */
  buffer: Buffer;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  byteSize: number;
  /** 파일 앞 바이트로 판별한 원천의 실제 형식(확장자·저장된 mime을 믿지 않는다) */
  detectedMime: SupportedImageMime;
  /** 원천 크기(정사각이 아니면 채웠다) */
  sourceWidth: number;
  sourceHeight: number;
}

/**
 * 업로드 이미지 정규화(P4-01 §5 `image-normalizer.ts`, F-AP-02, 규칙 6). 파일 앞 바이트로 실제 형식을 판별하고(agy 생성본은
 * 확장자와 실제 형식이 다를 수 있다 — PRD §8.4), sharp(02-ADR-001)로 EXIF 방향을 바로잡은 뒤 1000×1000 정사각 JPEG로 바꾼다
 * (`ck_image_asset_upload`: image/jpeg · 1000×1000 · 10,485,760바이트 미만). 메타데이터(EXIF·GPS)는 붙이지 않는다.
 */
export async function normalizeForUpload(bytes: Buffer): Promise<NormalizedUploadImage> {
  const detectedMime = sniffImageMime(bytes);
  if (detectedMime === null) throw new ImageNormalizeError('UNSUPPORTED_FORMAT');
  let sourceWidth: number;
  let sourceHeight: number;
  try {
    const meta = await sharp(bytes).metadata();
    sourceWidth = meta.width;
    sourceHeight = meta.pages && meta.pages > 1 && meta.pageHeight ? meta.pageHeight : meta.height;
  } catch {
    throw new ImageNormalizeError('UNREADABLE');
  }
  for (const quality of UPLOAD_JPEG_QUALITIES) {
    let buffer: Buffer;
    try {
      buffer = await sharp(bytes, { pages: 1 })
        .rotate()
        .resize(UPLOAD_SIZE_PX, UPLOAD_SIZE_PX, { fit: UPLOAD_FIT, background: UPLOAD_BACKGROUND })
        .flatten({ background: UPLOAD_BACKGROUND })
        .jpeg({ quality, mozjpeg: false })
        .toBuffer();
    } catch {
      throw new ImageNormalizeError('UNREADABLE');
    }
    if (buffer.length < UPLOAD_MAX_BYTES_EXCLUSIVE) {
      return {
        buffer,
        mimeType: 'image/jpeg',
        width: UPLOAD_SIZE_PX,
        height: UPLOAD_SIZE_PX,
        byteSize: buffer.length,
        detectedMime,
        sourceWidth,
        sourceHeight,
      };
    }
  }
  throw new ImageNormalizeError('TOO_LARGE');
}
