import { Injectable } from '@nestjs/common';
import { ImageAssetsService } from '../../../common/files/image-assets.service.js';
import type { SaveImageMeta } from '../../../common/files/image-asset.rules.js';
import type { ImageAsset } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

/** 원본 이미지 저장 창구(`SourceImageDownloader`가 쓴다 — 단위 테스트는 메모리 가짜로 바꾼다) */
export interface OriginalImageStorePort {
  /** 같은 상품(itemCode)의 같은 파일(sha256) ORIGINAL 행. 없으면 null(uq_image_asset_original) */
  findOriginal(itemCode: string, sha256: string): Promise<ImageAsset | null>;
  /** 파일 저장(내용 주소) + image_asset 1행(P1-01 `ImageAssetsService.saveImage`). 같은 (itemCode, sha256)이면 기존 행 */
  save(buffer: Buffer, meta: SaveImageMeta): Promise<ImageAsset>;
}

/**
 * 원본 이미지 저장(P3-01 규칙 4, ERD §3.6). 파일은 P1-01 이미지 저장(내용 주소 `images/<sha 앞 2자>/<sha>.<ext>`)으로 쓰고
 * 형식·해상도는 파일 내용으로 판별한다. image_asset은 추가만 되고 메타를 고치지 않는다 — 같은 (itemCode, sha256)은 새 행 없이
 * 기존 행을 쓴다.
 */
@Injectable()
export class OriginalImageStore implements OriginalImageStorePort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageAssetsService,
  ) {}

  findOriginal(itemCode: string, sha256: string): Promise<ImageAsset | null> {
    return this.prisma.imageAsset.findFirst({
      where: { kind: 'ORIGINAL', sourceItemCode: itemCode, sha256 },
      orderBy: { id: 'asc' },
    });
  }

  save(buffer: Buffer, meta: SaveImageMeta): Promise<ImageAsset> {
    return this.images.saveImage(buffer, meta);
  }
}
