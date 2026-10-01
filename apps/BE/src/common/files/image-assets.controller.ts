import { pipeline } from 'node:stream/promises';
import { Controller, Get, Headers, Param, Res } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiException } from '../errors/api.exception.js';
import { ImageAssetMetaDto } from './image-asset.dto.js';
import { ImageAssetsService } from './image-assets.service.js';

/** 파일 받기의 Cache-Control(05-2 getImageAssetFile) */
export const IMAGE_FILE_CACHE_CONTROL = 'private, immutable';

const INT4_MAX = 2_147_483_647;

/**
 * 경로의 imageAssetId. 1 이상 정수가 아니면 그런 이미지는 없으므로 404 IMAGE_ASSET_NOT_FOUND
 * (05-2 두 API의 응답에 422가 없다).
 */
function parseImageAssetId(raw: string): number {
  const id = /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isInteger(id) || id > INT4_MAX) {
    throw new ApiException('IMAGE_ASSET_NOT_FOUND');
  }
  return id;
}

/** If-None-Match가 이 ETag와 맞는지(목록·약한 비교·* 포함) */
export function etagMatches(ifNoneMatch: string | undefined, etag: string): boolean {
  if (!ifNoneMatch) return false;
  return ifNoneMatch
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

@ApiTags('common')
@Controller('image-assets')
export class ImageAssetsController {
  constructor(private readonly images: ImageAssetsService) {}

  @Get(':imageAssetId')
  @ApiOperation({ operationId: 'getImageAsset', summary: '이미지 메타' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiParam({ name: 'imageAssetId', type: 'integer', description: '이미지(image_asset) id' })
  @ApiOkResponse({ type: ImageAssetMetaDto, description: '이미지 메타' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'IMAGE_ASSET_NOT_FOUND' })
  getImageAsset(@Param('imageAssetId') imageAssetId: string): Promise<ImageAssetMetaDto> {
    return this.images.getMeta(parseImageAssetId(imageAssetId));
  }

  /**
   * 파일 받기. Content-Type = mime_type, ETag = "sha256", Cache-Control: private, immutable.
   * If-None-Match가 같으면 304(본문 없음).
   */
  @Get(':imageAssetId/file')
  @ApiOperation({ operationId: 'getImageAssetFile', summary: '이미지 파일 받기' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiParam({ name: 'imageAssetId', type: 'integer', description: '이미지(image_asset) id' })
  @ApiHeader({ name: 'If-None-Match', required: false, description: '이전에 받은 ETag(sha256)' })
  @ApiProduces('image/*')
  @ApiOkResponse({ description: '이미지 파일', schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 304, description: '파일이 바뀌지 않았다(If-None-Match 일치)' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'IMAGE_ASSET_NOT_FOUND · IMAGE_FILE_MISSING' })
  async getImageAssetFile(
    @Param('imageAssetId') imageAssetId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.images.openFile(parseImageAssetId(imageAssetId));
    const etag = `"${file.sha256}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', IMAGE_FILE_CACHE_CONTROL);
    if (etagMatches(ifNoneMatch, etag)) {
      res.status(304).end();
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.byteSize));
    try {
      await pipeline(file.open(), res);
    } catch (e) {
      // 받는 쪽이 중간에 끊으면 여기로 온다. 헤더를 이미 보냈으면 오류 봉투를 쓸 수 없다
      if (!res.headersSent) throw e;
      res.destroy();
    }
  }
}
