import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { imageAssetFileUrl } from '../../../common/files/image-assets.service.js';
import type { Candidate, ImageAsset } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import {
  THUMBNAIL_SOURCE_SECTIONS,
  type ThumbnailSourceImageDto,
  type ThumbnailSourceImageListDto,
  type ThumbnailSourceSection,
} from '../dto/thumbnail-source-images.dto.js';
import { isSameAnchor, type AnchorKeyFields } from '../thumbnail-anchor.js';
import { SOURCE_IMAGE_LIST_MAX } from '../thumbnail-sources.js';

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/** 쿼리(05-2 listCandidateSourceImages: sourceSection만) — 어기면 422 INVALID_QUERY_PARAMETER */
export function parseSourceImagesQuery(query: Record<string, unknown>): {
  sourceSection: ThumbnailSourceSection | null;
} {
  for (const key of Object.keys(query)) {
    if (key !== 'sourceSection') throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  const raw = query.sourceSection;
  if (raw === undefined) return { sourceSection: null };
  if (typeof raw !== 'string' || !(THUMBNAIL_SOURCE_SECTIONS as readonly string[]).includes(raw)) {
    throw invalidQuery('sourceSection', 'PRODUCT_IMAGE·DESCRIPTION_IMAGE 중 하나여야 합니다.');
  }
  return { sourceSection: raw as ThumbnailSourceSection };
}

/** 후보 앵커 키 칸 */
export function anchorOf(candidate: Candidate): AnchorKeyFields {
  return {
    anchorModelCode: candidate.anchorModelCode,
    anchorItemCode: candidate.anchorItemCode,
    anchorColorCode: candidate.anchorColorCode,
  };
}

/** image_asset → 05-2 ThumbnailSourceImage(로컬 경로 없이 fileUrl) */
export function toSourceImage(row: ImageAsset, anchor: AnchorKeyFields): ThumbnailSourceImageDto {
  return {
    imageAssetId: row.id,
    kind: row.kind as ThumbnailSourceImageDto['kind'],
    sourceSection: row.sourceSection as ThumbnailSourceSection | null,
    width: row.width,
    height: row.height,
    byteSize: row.byteSize,
    mimeType: row.mimeType,
    sha256: row.sha256,
    sourceUrl: row.sourceUrl,
    sourceItemCode: row.sourceItemCode,
    sourceShopCode: row.sourceShopCode,
    sourceModelCodeNorm: row.sourceModelCodeNorm,
    sourceColorCode: row.sourceColorCode,
    collectedAt: row.collectedAt ? row.collectedAt.toISOString() : null,
    usageRight: row.usageRight as ThumbnailSourceImageDto['usageRight'],
    derivedFromImageAssetId: row.derivedFromImageAssetId,
    fileUrl: imageAssetFileUrl(row.id),
    isSameAnchor: isSameAnchor(anchor, row),
    personDetected: null,
    autoRecommended: null,
  };
}

/**
 * 후보의 라쿠텐 원본 이미지 목록(05-2 `listCandidateSourceImages`, F-TH-03, P3-01 규칙 5). 원본은 itemCode 단위로 후보끼리
 * 공유하므로(`candidate_id` NULL) 후보의 **현재 ② 소싱 선택 itemCode**(`candidate.item_code`)의 ORIGINAL만 준다(페이징 없음,
 * 받은 순서 = 페이지 순서, 최대 40장). ② 선택 전이면 409 `SOURCING_SELECTION_REQUIRED`. 로컬 경로는 주지 않는다.
 */
@Injectable()
export class SourceImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
  ) {}

  async list(
    candidateId: number,
    query: Record<string, unknown>,
  ): Promise<ThumbnailSourceImageListDto> {
    const { sourceSection } = parseSourceImagesQuery(query);
    const candidate = await this.guard.findOr404(this.prisma, candidateId);
    const itemCode = candidate.itemCode;
    if (!itemCode) throw new ApiException('SOURCING_SELECTION_REQUIRED');
    const rows = await this.prisma.imageAsset.findMany({
      where: {
        kind: 'ORIGINAL',
        sourceItemCode: itemCode,
        ...(sourceSection ? { sourceSection } : {}),
      },
      orderBy: { id: 'asc' },
      take: SOURCE_IMAGE_LIST_MAX,
    });
    const anchor = anchorOf(candidate);
    return { itemCode, items: rows.map((row) => toSourceImage(row, anchor)) };
  }
}
