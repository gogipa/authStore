import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDefined, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import {
  THUMBNAIL_FACE_OPTIONS,
  type ThumbnailFaceOption,
} from '../../settings/schema/settings.types.js';
import { PROMPT_ADJUSTMENT_MAX } from '../prompt/prompt-builder.js';

/** 05-2 ThumbnailFaceOption(IM-07): FULL_FACE=전체, CHIN_CROP=턱 아래 크롭, HANDS_UPPER_BODY=손·상반신만 */
export const THUMBNAIL_FACE_OPTION_VALUES = THUMBNAIL_FACE_OPTIONS;
export type ThumbnailFaceOptionDto = ThumbnailFaceOption;

const FACE_OPTION_MESSAGE = 'FULL_FACE·CHIN_CROP·HANDS_UPPER_BODY 중 하나여야 합니다.';

/** 05-2 ThumbnailPromptPreviewRequest. 얼굴 옵션이 3종 밖·조정 문구 2000자 초과면 422 VALIDATION_FAILED */
export class ThumbnailPromptPreviewRequestDto {
  @ApiProperty({ type: 'integer', minimum: 1, description: '입력 대기 중인 ⑤ 실행 기록 id' })
  @IsDefined({ message: '실행 기록 id가 필요합니다.' })
  @IsInt({ message: '1 이상의 정수여야 합니다.' })
  @Min(1, { message: '1 이상의 정수여야 합니다.' })
  @Max(2_147_483_647, { message: '너무 큰 id입니다.' })
  stepRunId!: number;

  @ApiProperty({ enum: THUMBNAIL_FACE_OPTIONS })
  @IsDefined({ message: '얼굴 노출 수준이 필요합니다.' })
  @IsIn(THUMBNAIL_FACE_OPTIONS, { message: FACE_OPTION_MESSAGE })
  faceOption!: ThumbnailFaceOption;

  @ApiPropertyOptional({
    type: 'string',
    nullable: true,
    maxLength: PROMPT_ADJUSTMENT_MAX,
    description: '오너 프롬프트 조정 문구',
  })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MaxLength(PROMPT_ADJUSTMENT_MAX, { message: `${PROMPT_ADJUSTMENT_MAX}자 이하여야 합니다.` })
  promptAdjustment?: string | null;
}

/** 05-2 ThumbnailPromptPreview */
export class ThumbnailPromptPreviewDto {
  @ApiProperty({ description: '골격 + 해상도 + 얼굴 옵션 + 오너 조정을 채운 프롬프트' })
  prompt!: string;

  @ApiProperty({ enum: THUMBNAIL_FACE_OPTIONS })
  faceOption!: ThumbnailFaceOption;

  @ApiProperty({ type: 'integer', minimum: 1 })
  requestedSizePx!: number;

  @ApiProperty()
  promptAdjusted!: boolean;

  @ApiProperty({ description: '실존 인물 차단어가 있는지' })
  realPersonNameDetected!: boolean;

  @ApiProperty({ type: 'string', isArray: true, description: '걸린 차단어' })
  blockedTerms!: string[];

  @ApiProperty({ description: '생성 버튼을 켤 수 있는지(차단어 없음 + 레퍼런스 확인)' })
  generationAllowed!: boolean;
}
