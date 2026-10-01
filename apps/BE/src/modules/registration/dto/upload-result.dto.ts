import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** 05-2 registration ⑧ 스키마(P4-01). 모양은 05-2 그대로다(응답 문서용) */

const STEP_STATUSES = [
  'NOT_RUN',
  'RUNNING',
  'WAITING_INPUT',
  'COMPLETED',
  'FAILED',
  'RERUN_REQUIRED',
] as const;
const IMAGE_ROLES = ['REPRESENTATIVE', 'ADDITIONAL'] as const;

export type UploadStepRunStatus = (typeof STEP_STATUSES)[number];
export type UploadImageRole = (typeof IMAGE_ROLES)[number];

/** 05-2 UploadResultImageItem: ⑧ 산출물에 들어간 업로드 이미지(upload_result_image + uploaded_image) */
export class UploadResultImageItemDto {
  @ApiProperty({ type: 'integer', minimum: 1 })
  id!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  uploadedImageId!: number;

  @ApiProperty({ enum: IMAGE_ROLES })
  role!: UploadImageRole;

  @ApiProperty({ type: 'integer', minimum: 0, maximum: 9 })
  sortOrder!: number;

  @ApiProperty({ maxLength: 500, description: '업로드 API가 준 shop-phinf URL' })
  url!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$', description: '원천 파일(G3 선택본) SHA-256' })
  sourceSha256!: string;

  @ApiProperty({
    type: 'integer',
    minimum: 1,
    description: '올린 1000×1000 JPEG 정규화본(kind=UPLOAD)',
  })
  imageAssetId!: number;

  @ApiProperty({ format: 'date-time' })
  uploadedAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  traceId?: string | null;

  @ApiProperty({ description: '이 실행 전에 올린 URL을 다시 썼는지(계산)' })
  reused!: boolean;
}

/** 05-2 UploadResultOutput: ⑧ 업로드 한 버전(upload_result + 이미지) */
export class UploadResultOutputDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '⑧ 실행 기록(버전) id' })
  stepRunId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  candidateId!: number;

  @ApiProperty({ type: 'integer', minimum: 1 })
  version!: number;

  @ApiProperty({ enum: STEP_STATUSES })
  stepRunStatus!: UploadStepRunStatus;

  @ApiProperty()
  isCurrent!: boolean;

  @ApiProperty({ type: 'integer', minimum: 1 })
  uploadResultId!: number;

  @ApiProperty({ description: '자리표시자를 업로드 URL로 바꾼 최종 detailContent HTML' })
  detailContent!: string;

  @ApiProperty({ pattern: '^[0-9a-f]{64}$' })
  detailContentSha256!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: [UploadResultImageItemDto], minItems: 1, maxItems: 10 })
  images!: UploadResultImageItemDto[];
}
