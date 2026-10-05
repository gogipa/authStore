import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiException } from '../../../common/errors/api.exception.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { PageQueryDto } from '../../../common/paging/page-query.dto.js';
import { CANDIDATE_STATUSES, STEP_FLOW, STEP_STATUSES } from '../domain/steps.js';

export const CREATION_PATHS = ['KEYWORD', 'SEARCH_QUERY', 'RAKUTEN_URL', 'DIRECT_INPUT'] as const;
export type CreationPath = (typeof CREATION_PATHS)[number];

/** 쿼리의 한 값·여러 값을 배열로 */
const toArray = ({ value }: { value: unknown }): unknown =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/**
 * POST /candidates body(05-2 CandidateCreateRequest, 표 D). creationPath로 모양이 정해진다.
 * 칸의 타입은 class-validator가, 경로별 필수·허용 칸은 `assertCreateShape`가 본다(둘 다 422 VALIDATION_FAILED).
 * 검색어 길이(반각 128자)는 VALIDATION_FAILED가 아니라 422 RAKUTEN_QUERY_INVALID라 여기서 막지 않는다.
 */
export class CreateCandidateDto {
  @ApiProperty({ enum: CREATION_PATHS, description: '생성 경로(표 D). DIRECT_INPUT은 M2' })
  @IsIn(CREATION_PATHS, {
    message: `creationPath는 ${CREATION_PATHS.join('·')} 중 하나여야 합니다.`,
  })
  creationPath!: CreationPath;

  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    description: 'KEYWORD: G1에서 고른 키워드 id',
  })
  @IsOptional()
  @IsInt({ message: '정수여야 합니다.' })
  @Min(1, { message: '1 이상이어야 합니다.' })
  sourceKeywordId?: number;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 128,
    description: 'KEYWORD·SEARCH_QUERY: 라쿠텐 검색어(반각 128자 이내)',
  })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @MinLength(1, { message: '비울 수 없습니다.' })
  rakutenQuery?: string;

  @ApiPropertyOptional({ type: 'integer', minimum: 1, description: 'RAKUTEN_URL: rakuten_item.id' })
  @IsOptional()
  @IsInt({ message: '정수여야 합니다.' })
  @Min(1, { message: '1 이상이어야 합니다.' })
  rakutenItemId?: number;

  @ApiPropertyOptional({ minLength: 1, maxLength: 128, description: 'RAKUTEN_URL: 고른 색상' })
  @IsOptional()
  @IsString({ message: '글자여야 합니다.' })
  @Length(1, 128, { message: '1~128자여야 합니다.' })
  selectedColor?: string;
}

/** 경로별 필수 칸과 받는 칸(05-2 CandidateCreate*Request, additionalProperties: false) */
const SHAPES: Record<
  Exclude<CreationPath, 'DIRECT_INPUT'>,
  { required: string[]; allowed: string[] }
> = {
  KEYWORD: {
    required: ['sourceKeywordId', 'rakutenQuery'],
    allowed: ['sourceKeywordId', 'rakutenQuery'],
  },
  SEARCH_QUERY: { required: ['rakutenQuery'], allowed: ['rakutenQuery'] },
  RAKUTEN_URL: {
    required: ['rakutenItemId', 'selectedColor'],
    allowed: ['rakutenItemId', 'selectedColor'],
  },
};

const BODY_FIELDS = ['sourceKeywordId', 'rakutenQuery', 'rakutenItemId', 'selectedColor'] as const;

/**
 * 경로별 모양 검사. 빠진 값·그 경로에서 받지 않는 값은 422 VALIDATION_FAILED(fieldErrors).
 * DIRECT_INPUT(M2 임시 후보)은 M1에서 받지 않는다(Proposed P1-04: 연결 API가 M2라 임시 후보가 남기만 한다).
 */
export function assertCreateShape(body: CreateCandidateDto): void {
  if (body.creationPath === 'DIRECT_INPUT') {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [
        {
          field: 'creationPath',
          message: '직접 입력으로 여정 만들기는 아직 쓸 수 없습니다(M2).',
          rejectedValue: body.creationPath,
        },
      ],
    });
  }
  const shape = SHAPES[body.creationPath];
  const fieldErrors: FieldError[] = [];
  for (const field of BODY_FIELDS) {
    const value = body[field];
    const present = value !== undefined && value !== null;
    if (shape.required.includes(field) && !present) {
      fieldErrors.push({ field, message: `${body.creationPath} 경로에 필요한 값입니다.` });
    } else if (!shape.allowed.includes(field) && value !== undefined) {
      fieldErrors.push({
        field,
        message: `${body.creationPath} 경로에서는 받지 않는 값입니다.`,
        rejectedValue: value,
      });
    }
  }
  if (fieldErrors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors });
}

/** PUT /candidates/{candidateId}/gender(05-2 CandidateGenderRequest). MALE·FEMALE만(공용 NULL 복귀 없음, §7.2-9) */
export class CandidateGenderDto {
  @ApiProperty({ enum: ['MALE', 'FEMALE'] })
  @IsIn(['MALE', 'FEMALE'], { message: '성별은 MALE 또는 FEMALE이어야 합니다.' })
  gender!: 'MALE' | 'FEMALE';
}

/** GET /candidates 쿼리(05-2 listCandidates) */
export class ListCandidatesQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: CANDIDATE_STATUSES,
    isArray: true,
    description: '후보 상태. 여러 번 줄 수 있다. 주지 않으면 EXCLUDED·REGISTERED를 뺀다',
  })
  @IsOptional()
  @Transform(toArray)
  @IsIn(CANDIDATE_STATUSES, { each: true, message: '알 수 없는 여정 상태입니다.' })
  status?: string[];

  @ApiPropertyOptional({ enum: STEP_FLOW, description: '이 단계를 지금 실행할 수 있는 후보만' })
  @IsOptional()
  @IsIn(STEP_FLOW, { message: '알 수 없는 단계 코드입니다.' })
  runnableStep?: string;

  @ApiPropertyOptional({
    minLength: 1,
    maxLength: 128,
    description: '型番·itemCode·검색어 부분 일치',
  })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: '1~128자여야 합니다.' })
  @MaxLength(128, { message: '1~128자여야 합니다.' })
  q?: string;
}

/** GET /candidate-steps 쿼리(05-2 listAttentionCandidateSteps) */
export class ListCandidateStepsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: STEP_STATUSES,
    isArray: true,
    description: '단계 상태. 여러 번 줄 수 있다. 기본 RERUN_REQUIRED·FAILED·WAITING_INPUT',
  })
  @IsOptional()
  @Transform(toArray)
  @IsIn(STEP_STATUSES, { each: true, message: '알 수 없는 단계 상태입니다.' })
  status?: string[];

  @ApiPropertyOptional({ enum: STEP_FLOW, description: '이 단계만' })
  @IsOptional()
  @IsIn(STEP_FLOW, { message: '알 수 없는 단계 코드입니다.' })
  stepCode?: string;
}
