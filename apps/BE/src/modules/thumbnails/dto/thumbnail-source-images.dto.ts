import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const THUMBNAIL_SOURCE_SECTIONS = ['PRODUCT_IMAGE', 'DESCRIPTION_IMAGE'] as const;
export type ThumbnailSourceSection = (typeof THUMBNAIL_SOURCE_SECTIONS)[number];

/** 05-2 ThumbnailSourceImage: 라쿠텐 원본 이미지 한 장(image_asset kind=ORIGINAL). file_path는 내보내지 않는다 */
export class ThumbnailSourceImageDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: 'image_asset.id' })
  imageAssetId!: number;

  @ApiProperty({
    enum: ['ORIGINAL', 'REFERENCE'],
    description: '원본, 또는 (M2) 원본에서 가공한 레퍼런스',
  })
  kind!: 'ORIGINAL' | 'REFERENCE';

  @ApiProperty({
    enum: [...THUMBNAIL_SOURCE_SECTIONS, null],
    nullable: true,
    description:
      '용도 배지. PRODUCT_IMAGE=상품 이미지(레퍼런스 후보), DESCRIPTION_IMAGE=설명 속 스펙표 이미지(⑥-2 OCR 근거)',
  })
  sourceSection!: ThumbnailSourceSection | null;

  @ApiProperty({ type: 'integer', minimum: 1, description: '가로 px' })
  width!: number;

  @ApiProperty({ type: 'integer', minimum: 1, description: '세로 px' })
  height!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  byteSize!: number;

  @ApiProperty({ maxLength: 32 })
  mimeType!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  sha256!: string;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 2048, description: '출처 URL' })
  sourceUrl!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 128 })
  sourceItemCode!: string | null;

  @ApiPropertyOptional({ type: 'string', nullable: true, maxLength: 64, description: '출처 샵' })
  sourceShopCode!: string | null;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: 128,
    description: '출처 상품 정규화 型番',
  })
  sourceModelCodeNorm!: string | null;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: 64,
    description: '알면 이미지가 보여 주는 SKU 색상 코드',
  })
  sourceColorCode!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  collectedAt!: string | null;

  @ApiProperty({
    enum: ['REFERENCE_ONLY', 'PERMITTED'],
    description: '권리 용도. 원본·레퍼런스는 항상 REFERENCE_ONLY',
  })
  usageRight!: 'REFERENCE_ONLY' | 'PERMITTED';

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    description: '(M2) 가공 레퍼런스의 원 파일',
  })
  derivedFromImageAssetId!: number | null;

  @ApiProperty({ description: '파일 받는 경로(/api/v1/image-assets/{imageAssetId}/file)' })
  fileUrl!: string;

  @ApiProperty({ description: '이미지 型番·색상이 후보 앵커 키와 같은지(계산)' })
  isSameAnchor!: boolean;

  @ApiPropertyOptional({
    type: 'boolean',
    nullable: true,
    description: '(M2) 인물·얼굴 자동 탐지(IM-02). M1은 null',
  })
  personDetected!: boolean | null;

  @ApiPropertyOptional({
    type: 'boolean',
    nullable: true,
    description: '(M2) 레퍼런스 자동 추천(IM-02). M1은 null',
  })
  autoRecommended!: boolean | null;
}

/** 05-2 ThumbnailSourceImageList */
export class ThumbnailSourceImageListDto {
  @ApiProperty({ maxLength: 128, description: '원본을 찾은 현재 ② 소싱 선택 itemCode' })
  itemCode!: string;

  @ApiProperty({ type: ThumbnailSourceImageDto, isArray: true, maxItems: 40 })
  items!: ThumbnailSourceImageDto[];
}
