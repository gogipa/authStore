import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * 실행 중 오너 입력(05-2 StepRunOwnerInputs, 표 A). 입력 지문에서 뺀다. 모르는 칸은 전역 ValidationPipe
 * (forbidNonWhitelisted)가 422 VALIDATION_FAILED로 막고, 단계에 맞지 않는 칸은 엔진이 422로 막는다.
 */
export class StepRunOwnerInputsDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 128,
    description: 'SOURCING — 라쿠텐 검색어(없으면 후보 검색어·앵커)',
  })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '1~128자여야 합니다.' })
  @MaxLength(128, { message: '1~128자여야 합니다.' })
  searchKeyword?: string;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 0,
    description: 'PRICING — 쿠폰 엔(URL 후보만)',
  })
  @IsOptional()
  @IsInt({ message: '정수여야 합니다.' })
  @Min(0, { message: '0 이상이어야 합니다.' })
  couponYen?: number;

  @ApiPropertyOptional({
    enum: ['FULL_FACE', 'CHIN_CROP', 'HANDS_UPPER_BODY'],
    description: 'THUMBNAIL — 얼굴 옵션',
  })
  @IsOptional()
  @IsIn(['FULL_FACE', 'CHIN_CROP', 'HANDS_UPPER_BODY'], {
    message: 'FULL_FACE·CHIN_CROP·HANDS_UPPER_BODY 중 하나여야 합니다.',
  })
  faceOption?: 'FULL_FACE' | 'CHIN_CROP' | 'HANDS_UPPER_BODY';

  @ApiPropertyOptional({ minLength: 1, description: 'THUMBNAIL — 프롬프트 조정 문구' })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '비울 수 없습니다.' })
  promptAdjustment?: string;
}

/** POST /candidates/{candidateId}/steps/{stepCode}/runs body(05-2 StepRunStartRequest). 비어도 된다 */
export class StepRunStartRequestDto {
  @ApiPropertyOptional({ type: StepRunOwnerInputsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => StepRunOwnerInputsDto)
  ownerInputs?: StepRunOwnerInputsDto;

  @ApiPropertyOptional({
    enum: ['NOTICE_HTML'],
    description: 'stepCode=COPY일 때만. ⑥-1→⑥-2→⑥-3을 이어서 돌린다',
  })
  @IsOptional()
  @IsIn(['NOTICE_HTML'], { message: 'NOTICE_HTML만 줄 수 있습니다.' })
  throughStepCode?: 'NOTICE_HTML';
}

/**
 * POST /candidates/{candidateId}/steps/{stepCode}/owner-edits body(05-2 StepOwnerEditRequest oneOf, 표 B).
 * 동작마다 모양이 달라 칸 검사는 `parseOwnerEditBody`가 한 곳에서 한다(422 VALIDATION_FAILED·KEEP_AS_IS_NOT_ALLOWED·
 * INVALID_STEP_CODE). 여기서는 받을 칸만 연다(그 밖 칸은 전역 ValidationPipe가 422).
 */
export class StepOwnerEditRequestDto {
  @ApiPropertyOptional({ enum: ['EDIT', 'KEEP_AS_IS', 'RESTORE_VERSION'] })
  @Allow()
  ownerAction?: unknown;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: '화면이 본 현재 버전 / 다시 고를 버전',
  })
  @Allow()
  baseStepRunId?: unknown;

  @ApiPropertyOptional({ description: 'EDIT(COPY·NOTICE_RAW·NOTICE_HTML) — 필드 값 편집' })
  @Allow()
  fields?: unknown;

  @ApiPropertyOptional({ type: [String], description: 'EDIT(TAGS) — 더할 태그' })
  @Allow()
  add?: unknown;

  @ApiPropertyOptional({ type: [String], description: 'EDIT(TAGS) — 뺄 태그' })
  @Allow()
  remove?: unknown;
}
