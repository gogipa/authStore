import { ApiProperty } from '@nestjs/swagger';
import {
  IMAGE_ASSET_KINDS,
  IMAGE_SOURCE_SECTIONS,
  IMAGE_USAGE_RIGHTS,
  type ImageAssetKind,
  type ImageSourceSection,
  type ImageUsageRight,
} from './image-asset.rules.js';

/**
 * 05-2 components.schemas.ImageAssetMeta(required 19개).
 * file_path(로컬 경로)는 두지 않고 fileUrl을 준다(05-1 §1.2). M2 필드(personDetected·autoRecommended)는 없다.
 */
export class ImageAssetMetaDto {
  @ApiProperty({ type: 'integer' })
  id!: number;

  @ApiProperty({ enum: IMAGE_ASSET_KINDS })
  kind!: ImageAssetKind;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  sha256!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  byteSize!: number;

  @ApiProperty({ maxLength: 32 })
  mimeType!: string;

  @ApiProperty({ type: 'integer', minimum: 1 })
  width!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  height!: number;

  @ApiProperty({ enum: IMAGE_SOURCE_SECTIONS, nullable: true, description: 'ORIGINAL만' })
  sourceSection!: ImageSourceSection | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 2048 })
  sourceUrl!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 128 })
  sourceItemCode!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  sourceShopCode!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 128 })
  sourceModelCodeNorm!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 64 })
  sourceColorCode!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  collectedAt!: string | null;

  @ApiProperty({ enum: IMAGE_USAGE_RIGHTS })
  usageRight!: ImageUsageRight;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description: '후보에 딸린 파일만. 라쿠텐 원본은 null',
  })
  candidateId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, description: '원 파일' })
  derivedFromImageAssetId!: number | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ description: '파일 받기 경로(/api/v1/image-assets/{id}/file)' })
  fileUrl!: string;
}
