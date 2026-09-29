import { createHash } from 'node:crypto';
import type { ReadStream } from 'node:fs';
import { Injectable } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import type { ImageAsset, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiException } from '../errors/api.exception.js';
import { FileStorageService } from './file-storage.service.js';
import type { ImageAssetMetaDto } from './image-asset.dto.js';
import {
  assertImageAssetRules,
  type DetectedImageInfo,
  type SaveImageMeta,
  SUPPORTED_IMAGE_TYPES,
  type SupportedImageMime,
  UnsupportedImageError,
  usageRightForKind,
} from './image-asset.rules.js';

/** sharp가 알려 주는 형식 이름 → mime(SUPPORTED_IMAGE_TYPES만) */
const FORMAT_TO_MIME: Record<string, SupportedImageMime> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

/** Prisma 클라이언트 또는 부르는 쪽의 트랜잭션 클라이언트 */
export type DbClient = Prisma.TransactionClient;

export interface OpenedImageFile {
  /** 파일 읽기 스트림을 만든다(본문이 필요할 때만 부른다) */
  open: () => ReadStream;
  byteSize: number;
  mimeType: string;
  sha256: string;
}

/**
 * 이미지 파일 저장·조회(common '파일 저장', ERD §3.6 image_asset).
 * - 내용 주소: 같은 sha256 파일은 디스크에 한 번만 둔다(images/<sha 앞 2자>/<sha>.<ext>).
 * - mime·width·height는 확장자가 아니라 파일 내용(sharp)으로 판별한다.
 * - image_asset은 추가만 한다(trg_append_only). ORIGINAL은 (source_item_code, sha256)이 같으면 기존 행을 돌려준다.
 * - 파일을 먼저 쓰고 행을 넣는다(행이 없는 파일은 남을 수 있지만, 파일이 없는 행은 만들지 않는다).
 */
@Injectable()
export class ImageAssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
  ) {}

  /** 파일 내용으로 형식·크기를 판별한다. 지원 밖 형식이면 UnsupportedImageError */
  static async detect(
    buffer: Buffer,
  ): Promise<DetectedImageInfo & { mimeType: SupportedImageMime }> {
    let meta: Metadata;
    try {
      meta = await sharp(buffer).metadata();
    } catch {
      throw new UnsupportedImageError(null);
    }
    const mimeType = FORMAT_TO_MIME[meta.format];
    if (!mimeType) throw new UnsupportedImageError(meta.format);
    const height = meta.pages && meta.pages > 1 && meta.pageHeight ? meta.pageHeight : meta.height;
    return { mimeType, width: meta.width, height, byteSize: buffer.length };
  }

  /**
   * 이미지 한 장을 저장한다. 공개 시그니처(이후 실행 문서가 그대로 쓴다):
   * `saveImage(buffer, meta, tx?) → ImageAsset`
   * @param tx 부르는 쪽의 Prisma 트랜잭션(있으면 그 안에서 행을 넣는다)
   */
  async saveImage(buffer: Buffer, meta: SaveImageMeta, tx?: DbClient): Promise<ImageAsset> {
    const info = await ImageAssetsService.detect(buffer);
    assertImageAssetRules(meta, info);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const filePath = this.files.imagePath(sha256, SUPPORTED_IMAGE_TYPES[info.mimeType]);
    await this.files.writeIfAbsent(filePath, buffer);

    const db: DbClient = tx ?? this.prisma;
    const data: Prisma.ImageAssetCreateManyInput = {
      kind: meta.kind,
      filePath,
      sha256,
      byteSize: info.byteSize,
      mimeType: info.mimeType,
      width: info.width,
      height: info.height,
      sourceSection: meta.sourceSection ?? null,
      sourceUrl: meta.sourceUrl ?? null,
      sourceItemCode: meta.sourceItemCode ?? null,
      sourceShopCode: meta.sourceShopCode ?? null,
      sourceModelCodeNorm: meta.sourceModelCodeNorm ?? null,
      sourceColorCode: meta.sourceColorCode ?? null,
      collectedAt: meta.collectedAt ?? null,
      usageRight: meta.usageRight ?? usageRightForKind(meta.kind),
      candidateId: meta.candidateId ?? null,
      derivedFromImageAssetId: meta.derivedFromImageAssetId ?? null,
    };

    if (meta.kind !== 'ORIGINAL') {
      return db.imageAsset.create({ data });
    }
    // ORIGINAL: uq_image_asset_original(부분 UNIQUE). ON CONFLICT DO NOTHING이라 트랜잭션 안에서도 깨지지 않는다
    const [created] = await db.imageAsset.createManyAndReturn({
      data: [data],
      skipDuplicates: true,
    });
    if (created) return created;
    const existing = await db.imageAsset.findFirst({
      where: { kind: 'ORIGINAL', sourceItemCode: data.sourceItemCode, sha256 },
      orderBy: { id: 'asc' },
    });
    if (!existing) throw new Error('ORIGINAL 중복인데 기존 행을 찾지 못했습니다.');
    return existing;
  }

  /** 행 하나. 없으면 404 IMAGE_ASSET_NOT_FOUND */
  async getAsset(id: number, tx?: DbClient): Promise<ImageAsset> {
    const db: DbClient = tx ?? this.prisma;
    const row = await db.imageAsset.findUnique({ where: { id } });
    if (!row) throw new ApiException('IMAGE_ASSET_NOT_FOUND', { details: { imageAssetId: id } });
    return row;
  }

  /** GET /image-assets/{id} 응답(05-2 ImageAssetMeta). 로컬 경로는 없다 */
  async getMeta(id: number): Promise<ImageAssetMetaDto> {
    return toImageAssetMeta(await this.getAsset(id));
  }

  /** 파일 읽기 스트림. 행이 없으면 IMAGE_ASSET_NOT_FOUND, 파일이 없으면 IMAGE_FILE_MISSING */
  async openFile(id: number): Promise<OpenedImageFile> {
    const row = await this.getAsset(id);
    const opened = await this.files.openRead(row.filePath);
    if (!opened) throw new ApiException('IMAGE_FILE_MISSING', { details: { imageAssetId: id } });
    return {
      open: opened.open,
      byteSize: opened.size,
      mimeType: row.mimeType,
      sha256: row.sha256,
    };
  }

  /** 파일 내용(업로드·AI 비전 입력 등 다른 모듈용). 오류는 openFile과 같다 */
  async readFile(id: number): Promise<{ buffer: Buffer; asset: ImageAsset }> {
    const asset = await this.getAsset(id);
    const buffer = await this.files.read(asset.filePath);
    if (!buffer) throw new ApiException('IMAGE_FILE_MISSING', { details: { imageAssetId: id } });
    return { buffer, asset };
  }
}

/** 이미지 파일 받기 경로(05-2 ImageAssetMeta.fileUrl) */
export function imageAssetFileUrl(id: number): string {
  return `/api/v1/image-assets/${id}/file`;
}

export function toImageAssetMeta(row: ImageAsset): ImageAssetMetaDto {
  return {
    id: row.id,
    kind: row.kind as ImageAssetMetaDto['kind'],
    sha256: row.sha256,
    byteSize: row.byteSize,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    sourceSection: row.sourceSection as ImageAssetMetaDto['sourceSection'],
    sourceUrl: row.sourceUrl,
    sourceItemCode: row.sourceItemCode,
    sourceShopCode: row.sourceShopCode,
    sourceModelCodeNorm: row.sourceModelCodeNorm,
    sourceColorCode: row.sourceColorCode,
    collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
    usageRight: row.usageRight as ImageAssetMetaDto['usageRight'],
    candidateId: row.candidateId,
    derivedFromImageAssetId: row.derivedFromImageAssetId,
    createdAt: row.createdAt.toISOString(),
    fileUrl: imageAssetFileUrl(row.id),
  };
}
