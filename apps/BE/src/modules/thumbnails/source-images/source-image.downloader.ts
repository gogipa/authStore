import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnsupportedImageError } from '../../../common/files/image-asset.rules.js';
import {
  apiImageUrlsOf,
  enlargeApiImageUrl,
  isRakutenImageUrl,
  RAKUTEN_IMAGE_MAX_BYTES,
  RAKUTEN_IMAGE_PORT,
  type RakutenImagePort,
} from '../../integrations/rakuten/rakuten-image.port.js';
import {
  RAKUTEN_SEARCH_PORT,
  type RakutenSearchPort,
} from '../../integrations/rakuten/rakuten-search.port.js';
import { SOURCE_IMAGE_DOWNLOAD_MAX } from '../thumbnail-sources.js';
import { OriginalImageStore, type OriginalImageStorePort } from './original-image.store.js';

/** 받을 원본의 출처(② 현재 버전 소싱 선택 — step-engine `readSourcingImages`) */
export interface SourceImagesInput {
  itemCode: string;
  shopCode: string | null;
  /** 페이지 JSON `media.images[]`(페이지 순서). 비면 API 이미지 URL `_ex` 대체 경로 */
  imageUrls: readonly string[];
  modelCodeNorm: string | null;
  colorCode: string | null;
}

export interface SourceImageCallContext {
  candidateId: number;
  stepRunId: number;
}

/** 받은(또는 이미 있던) 원본 한 장 */
export interface DownloadedSourceImage {
  imageAssetId: number;
  sha256: string;
  mimeType: string;
  width: number;
  height: number;
  sourceUrl: string;
  /** 같은 (itemCode, sha256) 행이 이미 있어 새 행을 만들지 않았다 */
  reused: boolean;
}

export type SourceImageSkipReason = 'HOST_NOT_ALLOWED' | 'NOT_IMAGE' | 'TOO_LARGE' | 'DUPLICATE';

export interface SourceImagesDownloadResult {
  /** 어느 목록을 받았나: 페이지 JSON `media.images[]` 또는 API 이미지 URL `_ex` 대체 */
  via: 'MEDIA_IMAGES' | 'API_EX_FALLBACK';
  images: DownloadedSourceImage[];
  skipped: { url: string; reason: SourceImageSkipReason }[];
}

/** 원본을 받지 못함(⑤ FAILED EXTERNAL_API — 실행 기록 코드·한국어 문구) */
export class SourceImageDownloadError extends Error {
  constructor(
    readonly errorCode: string,
    readonly userMessage: string,
  ) {
    super(`${errorCode}: ${userMessage}`);
    this.name = 'SourceImageDownloadError';
  }
}

/**
 * 파일 앞머리(매직 바이트)로 이미지 형식을 판별한다(확장자를 믿지 않는다 — ERD `image_asset.mime_type`). 받는 형식은 P1-01
 * 이미지 저장과 같은 JPEG·PNG·WebP·GIF. 모르면 null
 */
export function sniffImageMime(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length >= 6) {
    const head = bytes.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * ⑤ 원본 이미지 받기(F-TH-01·02, P3-01 규칙 3·4).
 * - 목록: ② 소싱 선택 페이지 JSON `media.images[]`(원본 해상도, 페이지 순서, 앞 20장). 비었으면 Item Search(`itemCode`, 6시간
 *   캐시 — 관문 RAKUTEN_API)의 `mediumImageUrls`(없으면 `smallImageUrls`) `_ex`를 1200x1200으로 키운 주소(Proposed)
 * - 받기: 라쿠텐 이미지 포트(관문 RAKUTEN_IMAGE — 하루 페이지 상한에 넣지 않는다). 허용 호스트 밖 주소는 보내지 않고 건너뛴다
 * - 형식: 매직 바이트로 판별(`png-named.jpg` → image/png). 이미지가 아니거나 너무 크면 그 장만 건너뛴다
 * - 저장: `kind=ORIGINAL`·`usage_right=REFERENCE_ONLY`·`source_section=PRODUCT_IMAGE`·`candidate_id=NULL`, 출처 URL·itemCode·샵·
 *   型番·(알면) 색상 코드·수집 시각(받은 시각)·해상도·크기·SHA-256. 같은 (itemCode, sha256)은 새 행 없이 기존 행을 쓴다
 * - 실패: 2xx가 아닌 응답은 곧바로 멈추고 `SourceImageDownloadError`(RAKUTEN_IMAGE_HTTP_<상태>). 관문 오류(시간 초과·쉼 등)는
 *   그대로 던진다. 한 장도 받지 못하면 SOURCE_IMAGES_NOT_FOUND
 */
@Injectable()
export class SourceImageDownloader {
  private readonly logger = new Logger(SourceImageDownloader.name);

  constructor(
    @Inject(RAKUTEN_IMAGE_PORT) private readonly imagePort: RakutenImagePort,
    @Inject(RAKUTEN_SEARCH_PORT) private readonly searchPort: RakutenSearchPort,
    @Inject(OriginalImageStore) private readonly store: OriginalImageStorePort,
  ) {}

  async download(
    input: SourceImagesInput,
    ctx: SourceImageCallContext,
  ): Promise<SourceImagesDownloadResult> {
    let via: SourceImagesDownloadResult['via'] = 'MEDIA_IMAGES';
    let urls = uniqueUrls(input.imageUrls);
    if (urls.length === 0) {
      via = 'API_EX_FALLBACK';
      urls = await this.apiImageUrls(input.itemCode, ctx);
    }
    if (urls.length === 0) throw notFound();

    const images: DownloadedSourceImage[] = [];
    const skipped: SourceImagesDownloadResult['skipped'] = [];
    const seen = new Set<string>();
    for (const url of urls.slice(0, SOURCE_IMAGE_DOWNLOAD_MAX)) {
      if (!isRakutenImageUrl(url)) {
        skipped.push({ url, reason: 'HOST_NOT_ALLOWED' });
        continue;
      }
      const res = await this.imagePort.fetchImage(url, ctx);
      if (res.httpStatus < 200 || res.httpStatus > 299) {
        throw new SourceImageDownloadError(
          `RAKUTEN_IMAGE_HTTP_${res.httpStatus}`,
          `라쿠텐 원본 이미지를 받지 못했습니다(HTTP ${res.httpStatus}). 잠시 뒤 ⑤ 썸네일을 다시 실행해 주세요.`,
        );
      }
      if (res.bytes.length > RAKUTEN_IMAGE_MAX_BYTES) {
        skipped.push({ url, reason: 'TOO_LARGE' });
        continue;
      }
      const mime = res.bytes.length > 0 ? sniffImageMime(res.bytes) : null;
      if (!mime) {
        skipped.push({ url, reason: 'NOT_IMAGE' });
        continue;
      }
      const sha256 = createHash('sha256').update(res.bytes).digest('hex');
      if (seen.has(sha256)) {
        skipped.push({ url, reason: 'DUPLICATE' });
        continue;
      }
      seen.add(sha256);
      const existing = await this.store.findOriginal(input.itemCode, sha256);
      let asset = existing;
      if (!asset) {
        try {
          asset = await this.store.save(res.bytes, {
            kind: 'ORIGINAL',
            usageRight: 'REFERENCE_ONLY',
            candidateId: null,
            sourceSection: 'PRODUCT_IMAGE',
            sourceUrl: url,
            sourceItemCode: input.itemCode,
            sourceShopCode: input.shopCode,
            sourceModelCodeNorm: input.modelCodeNorm,
            sourceColorCode: input.colorCode,
            collectedAt: res.fetchedAt,
          });
        } catch (error) {
          if (!(error instanceof UnsupportedImageError)) throw error;
          skipped.push({ url, reason: 'NOT_IMAGE' });
          continue;
        }
      }
      images.push({
        imageAssetId: asset.id,
        sha256: asset.sha256,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        sourceUrl: url,
        reused: existing !== null,
      });
    }
    if (skipped.length > 0) {
      this.logger.warn(
        `⑤ 원본 이미지 ${skipped.length}장을 건너뛰었습니다(후보 #${ctx.candidateId}): ${skipped
          .map((s) => s.reason)
          .join(', ')}`,
      );
    }
    if (images.length === 0) throw notFound();
    return { via, images, skipped };
  }

  /** `_ex` 대체 경로: Item Search(itemCode) 응답의 이미지 URL을 키운다(API 이미지 URL은 DB에 따로 두지 않는다, Proposed) */
  private async apiImageUrls(itemCode: string, ctx: SourceImageCallContext): Promise<string[]> {
    const result = await this.searchPort.search(
      { itemCode, sourcingFilters: false },
      { candidateId: ctx.candidateId, stepRunId: ctx.stepRunId },
    );
    const item = result.items.find((i) => i.itemCode === itemCode) ?? result.items[0];
    if (!item) return [];
    return uniqueUrls(
      apiImageUrlsOf(item.raw)
        .map((url) => enlargeApiImageUrl(url))
        .filter((url): url is string => url !== null),
    );
  }
}

function uniqueUrls(urls: readonly string[]): string[] {
  return [...new Set(urls.map((u) => u.trim()).filter((u) => u !== ''))];
}

function notFound(): SourceImageDownloadError {
  return new SourceImageDownloadError(
    'SOURCE_IMAGES_NOT_FOUND',
    '라쿠텐 상품에서 받을 수 있는 원본 이미지를 찾지 못했습니다. ② 소싱에서 다른 상품을 고르거나 ⑤ 썸네일을 다시 실행해 주세요.',
  );
}
