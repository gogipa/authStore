import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { FileStorageService } from '../../../common/files/file-storage.service.js';
import { UnsupportedImageError } from '../../../common/files/image-asset.rules.js';
import { ImageAssetsService } from '../../../common/files/image-assets.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  isRakutenImageUrl,
  RAKUTEN_IMAGE_PORT,
  type RakutenImagePort,
} from '../../integrations/rakuten/rakuten-image.port.js';

/**
 * 설명 HTML의 스펙 이미지 주소(P3-03 규칙 15 Proposed — 고르는 규칙은 M0 S2에서 정한다, 그 전 설정값): `<img src>`를 나온 순서로,
 * http는 https로, 라쿠텐 이미지 호스트(관문 RAKUTEN_IMAGE 허용 목록)만, 같은 주소는 한 번, 앞에서부터 `maxCount`장. 순수 함수 —
 * ⑥-2 입력 지문에도 이 주소 목록을 넣는다(파일 해시는 받은 뒤에야 알 수 있어 시작 조건에는 주소를 쓴다).
 */
export function specImageUrlsOf(html: string | null, maxCount: number): string[] {
  if (!html || maxCount <= 0) return [];
  const out: string[] = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi;
  for (let m = re.exec(html); m !== null && out.length < maxCount; m = re.exec(html)) {
    let url = (m[2] ?? '').trim().replace(/&amp;/g, '&');
    if (url.startsWith('//')) url = `https:${url}`;
    if (url.startsWith('http://')) url = `https://${url.slice('http://'.length)}`;
    if (!isRakutenImageUrl(url) || out.includes(url)) continue;
    out.push(url);
  }
  return out;
}

export interface SpecImage {
  imageAssetId: number;
  sourceUrl: string;
  /** 비전 호출에 넘길 파일 절대 경로(로그·응답에 쓰지 않는다) */
  filePath: string;
}

export interface SpecImageCollectInput {
  itemCode: string;
  shopCode: string | null;
  urls: readonly string[];
  maxBytes: number;
}

/**
 * 스펙 이미지 받기(P3-03 규칙 15, F-CT-10): 라쿠텐 이미지 포트(P1-01 관문 RAKUTEN_IMAGE — 허용 목록·직렬·call_log)로 받아
 * `image_asset`(ORIGINAL, `source_section=DESCRIPTION_IMAGE`, 참조 전용)로 저장한다. 같은 (itemCode, sha256)이면 기존 행을 쓴다.
 * 한 장이 실패(2xx 아님·크기 초과·이미지 아님·관문 오류)해도 ⑥-2를 멈추지 않고 그 장만 건너뛴다(Proposed — 스펙 이미지는 AI 보조
 * 근거라 글만으로 계속한다).
 */
@Injectable()
export class SpecImageCollector {
  private readonly logger = new Logger(SpecImageCollector.name);

  constructor(
    @Inject(RAKUTEN_IMAGE_PORT) private readonly imagePort: RakutenImagePort,
    private readonly images: ImageAssetsService,
    private readonly files: FileStorageService,
    private readonly prisma: PrismaService,
  ) {}

  async collect(
    input: SpecImageCollectInput,
    ctx: { candidateId: number; stepRunId: number },
  ): Promise<SpecImage[]> {
    const out: SpecImage[] = [];
    const seen = new Set<string>();
    for (const url of input.urls) {
      try {
        const res = await this.imagePort.fetchImage(url, ctx);
        if (res.httpStatus < 200 || res.httpStatus > 299) {
          this.logger.warn(`⑥-2 스펙 이미지를 건너뜁니다(HTTP ${res.httpStatus})`);
          continue;
        }
        if (res.bytes.length === 0 || res.bytes.length > input.maxBytes) continue;
        const sha256 = createHash('sha256').update(res.bytes).digest('hex');
        if (seen.has(sha256)) continue;
        seen.add(sha256);
        const existing = await this.prisma.imageAsset.findFirst({
          where: { kind: 'ORIGINAL', sourceItemCode: input.itemCode, sha256 },
          orderBy: { id: 'asc' },
        });
        const asset =
          existing ??
          (await this.images.saveImage(res.bytes, {
            kind: 'ORIGINAL',
            usageRight: 'REFERENCE_ONLY',
            candidateId: null,
            sourceSection: 'DESCRIPTION_IMAGE',
            sourceUrl: url,
            sourceItemCode: input.itemCode,
            sourceShopCode: input.shopCode,
            collectedAt: res.fetchedAt,
          }));
        out.push({
          imageAssetId: asset.id,
          sourceUrl: url,
          filePath: this.files.resolve(asset.filePath),
        });
      } catch (error) {
        if (error instanceof UnsupportedImageError) continue;
        // 관문 오류(502 EXTERNAL_API_ERROR·허용 목록 등)는 그 장만 건너뛴다. 그 밖(앱·DB 오류)은 실행을 실패로 둔다
        if (!(error instanceof ApiException)) throw error;
        this.logger.warn(`⑥-2 스펙 이미지를 받지 못해 건너뜁니다(${error.code})`);
      }
    }
    return out;
  }
}
