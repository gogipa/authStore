import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/** 05-2 ThumbnailReferenceChoice: 레퍼런스 한 장 고르기 */
export class ThumbnailReferenceChoiceDto {
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: 'ORIGINAL(PRODUCT_IMAGE) 또는 (M2) REFERENCE 이미지',
  })
  @IsDefined({ message: '이미지 id가 필요합니다.' })
  @IsInt({ message: '1 이상의 정수여야 합니다.' })
  @Min(1, { message: '1 이상의 정수여야 합니다.' })
  @Max(2_147_483_647, { message: '너무 큰 id입니다.' })
  imageAssetId!: number;

  /** 1~3 범위는 장수 검사(IMAGE_COUNT_INVALID) 뒤에 서비스가 본다 — 4장이면 순서 4가 있어도 IMAGE_COUNT_INVALID가 먼저다 */
  @ApiProperty({ type: 'integer', minimum: 1, maximum: 3 })
  @IsDefined({ message: '순서가 필요합니다.' })
  @IsInt({ message: '1~3이어야 합니다.' })
  sortOrder!: number;
}

/**
 * 05-2 ThumbnailReferencesRequest. 장수(1~3)는 서비스가 422 IMAGE_COUNT_INVALID로, '사람·얼굴 없음' 확인(true가 아님·빠짐)은
 * 422 NO_PERSON_CONFIRMATION_REQUIRED로 본다(05-2 설명 그대로 — 그래서 여기서는 개수·필수 검사를 하지 않는다).
 */
export class ThumbnailReferencesRequestDto {
  @ApiProperty({
    type: ThumbnailReferenceChoiceDto,
    isArray: true,
    description: '레퍼런스 1~3장(개수 위반은 422 IMAGE_COUNT_INVALID)',
  })
  @IsDefined({ message: '레퍼런스 목록이 필요합니다.' })
  @IsArray({ message: '배열이어야 합니다.' })
  @ArrayMaxSize(100, { message: '너무 많습니다.' })
  @ValidateNested({ each: true })
  @Type(() => ThumbnailReferenceChoiceDto)
  references!: ThumbnailReferenceChoiceDto[];

  @ApiProperty({
    description: "'사람·얼굴 없음' 확인. true가 아니면 422 NO_PERSON_CONFIRMATION_REQUIRED",
  })
  @IsOptional()
  @IsBoolean({ message: 'true 또는 false여야 합니다.' })
  noPersonConfirmed!: boolean;
}

/** 05-2 ThumbnailReferenceItem: ⑤ 버전이 실제로 쓴 레퍼런스 한 장(thumbnail_reference) */
export class ThumbnailReferenceItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  imageAssetId!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: 3,
    description: '1~3(정면·측면·로고 클로즈업 순서 권장)',
  })
  sortOrder!: number;

  @ApiProperty({ type: 'string', format: 'date-time', description: "'사람·얼굴 없음' 확인 시각" })
  noPersonConfirmedAt!: string;

  @ApiProperty({ type: 'string', format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ description: '레퍼런스 앵커 키가 후보 앵커 키와 같은지(계산)' })
  isSameAnchor!: boolean;

  @ApiProperty()
  fileUrl!: string;
}

/** 05-2 ThumbnailReferencesResult */
export class ThumbnailReferencesResultDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: '후보 단위 선택 번호(thumbnail_reference_input.input_no)',
  })
  inputNo!: number;

  @ApiProperty({ type: ThumbnailReferenceItemDto, isArray: true, minItems: 1, maxItems: 3 })
  references!: ThumbnailReferenceItemDto[];

  @ApiProperty()
  sameProductColorRequired!: boolean;
}
