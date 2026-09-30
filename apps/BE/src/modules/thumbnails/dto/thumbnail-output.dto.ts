import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ThumbnailGenerationSummaryDto } from './generation-run.dto.js';
import { ThumbnailReferenceItemDto } from './thumbnail-references.dto.js';

export const THUMBNAIL_IMAGE_ROLES = ['REPRESENTATIVE', 'ADDITIONAL'] as const;
export type ThumbnailImageRole = (typeof THUMBNAIL_IMAGE_ROLES)[number];

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;

/** 05-2 ThumbnailG3Checklist(thumbnail_selection.checklist jsonb) */
export class ThumbnailG3ChecklistDto {
  @ApiProperty({ description: '체크리스트 버전(앱 상수) 스냅샷' })
  version!: string;

  @ApiProperty({ description: '신발 비중 70% 이상' })
  shoeRatioOver70!: boolean;

  @ApiProperty({ description: '디테일이 원본과 같음' })
  detailMatch!: boolean;

  @ApiProperty({ description: '선택 색상과 같음' })
  colorMatchesSelectedColor!: boolean;

  @ApiProperty({ description: '레퍼런스에 사람·얼굴 없음' })
  referenceNoPerson!: boolean;

  @ApiProperty({ description: '실존 인물 연상 없음' })
  noRealPersonResemblance!: boolean;

  @ApiProperty({ description: '문구·가격 없음' })
  noTextOrPrice!: boolean;

  @ApiProperty({ description: '상품 1개·모델 1명' })
  singleProductSingleModel!: boolean;
}

/** 05-2 ThumbnailSelectionImageItem */
export class ThumbnailSelectionImageItemDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '고른 이미지(M1은 kind=GENERATED만)' })
  imageAssetId!: number;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    description: '이 이미지를 만든 생성 시도(계산)',
  })
  generationRunId!: number | null;

  @ApiProperty({ enum: THUMBNAIL_IMAGE_ROLES })
  role!: ThumbnailImageRole;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 9 })
  sortOrder!: number;

  @ApiProperty()
  fileUrl!: string;
}

/** 05-2 ThumbnailSelectionView */
export class ThumbnailSelectionViewDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  thumbnailSelectionId!: number;

  @ApiProperty({ type: ThumbnailG3ChecklistDto })
  checklist!: ThumbnailG3ChecklistDto;

  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  sameProductColorConfirmedAt!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  selectedAt!: string;

  @ApiProperty({ type: ThumbnailSelectionImageItemDto, isArray: true, minItems: 1, maxItems: 10 })
  images!: ThumbnailSelectionImageItemDto[];
}

/** 05-2 ThumbnailG3Validity */
export class ThumbnailG3ValidityDto {
  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1 })
  gatePassId!: number | null;

  @ApiPropertyOptional({ type: 'string', format: 'date-time', nullable: true })
  passedAt!: string | null;

  @ApiPropertyOptional({ type: 'integer', nullable: true, minimum: 1 })
  basisStepRunId!: number | null;

  @ApiProperty({ description: '최신 통과 지문이 현재 값과 같은지' })
  valid!: boolean;

  @ApiProperty({ type: 'string', isArray: true })
  changedBasisKeys!: string[];
}

/** 05-2 ThumbnailOutput: ⑤ 한 버전의 산출물 화면 단위 */
export class ThumbnailOutputDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepRunStatus!: (typeof STEP_STATUSES)[number];

  @ApiProperty({ description: '후보의 현재 ⑤ 버전인지' })
  isCurrent!: boolean;

  @ApiProperty({ type: ThumbnailReferenceItemDto, isArray: true, maxItems: 3 })
  references!: ThumbnailReferenceItemDto[];

  @ApiProperty({ description: "레퍼런스를 고르고 '사람·얼굴 없음'을 확인했는지" })
  referencesConfirmed!: boolean;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: 4, description: '후보 칸 수(설정)' })
  candidateCount!: number;

  @ApiProperty({ type: ThumbnailGenerationSummaryDto, isArray: true })
  generationRuns!: ThumbnailGenerationSummaryDto[];

  @ApiPropertyOptional({ type: ThumbnailSelectionViewDto, nullable: true })
  selection!: ThumbnailSelectionViewDto | null;

  @ApiProperty({ type: ThumbnailG3ValidityDto })
  g3!: ThumbnailG3ValidityDto;

  @ApiProperty({ description: "'같은 상품·색상' 확인이 필요한지(계산)" })
  sameProductColorRequired!: boolean;
}
