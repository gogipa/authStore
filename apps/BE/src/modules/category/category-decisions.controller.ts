import { Body, Controller, Get, Param, Put, Query, type PipeTransform } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ApiException } from '../../common/errors/api.exception.js';
import { CandidateIdPipe } from '../step-engine/candidates/candidates.controller.js';
import { CategoryDecisionsService } from './category-decisions.service.js';
import {
  CategoryDecisionDetailDto,
  CategorySelectionRequestDto,
  CategorySelectionResultDto,
} from './dto/category-decision.dto.js';

const MAX_ID = 2_147_483_647;

/** 경로의 결정 id: 1 이상 int4 정수가 아니면 그런 결정은 없다(404 CATEGORY_DECISION_NOT_FOUND — 05-2 경로 422 없음) */
export class CategoryDecisionIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text) && Number(text) <= MAX_ID) {
      return Number(text);
    }
    throw new ApiException('CATEGORY_DECISION_NOT_FOUND');
  }
}

/** ④ 카테고리 결정 조회·리프 고르기(05-2 getCategoryDecision·selectCategoryDecisionLeaf, 태그 category, P2-06) */
@ApiTags('category')
@Controller()
export class CategoryDecisionsController {
  constructor(private readonly decisions: CategoryDecisionsService) {}

  @Get('candidates/:candidateId/category-decision')
  @ApiOperation({ operationId: 'getCategoryDecision', summary: '④ 카테고리 결정 조회' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'stepRunId',
    type: 'integer',
    required: false,
    description: '볼 ④ 버전의 실행 id. 없으면 현재 버전',
  })
  @ApiOkResponse({ type: CategoryDecisionDetailDto, description: '카테고리 결정' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description:
      'CANDIDATE_NOT_FOUND · STEP_RUN_NOT_FOUND · STEP_OUTPUT_NOT_FOUND(details.stepCode=CATEGORY)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_QUERY_PARAMETER — 다른 후보·단계의 stepRunId',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<CategoryDecisionDetailDto> {
    return this.decisions.get(candidateId, query);
  }

  @Put('category-decisions/:categoryDecisionId/selection')
  @ApiOperation({
    operationId: 'selectCategoryDecisionLeaf',
    summary: '리프 카테고리 고르기(④ 완료)',
  })
  @ApiParam({ name: 'categoryDecisionId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: CategorySelectionResultDto, description: '확정 결과' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CATEGORY_DECISION_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'CATEGORY_GENDER_MISMATCH · CATEGORY_CHILD_BLOCKED · CATEGORY_EXCLUDED_ITEM · KC_EXEMPT_CONFIRMATION_REQUIRED · STEP_RUN_NOT_WAITING_INPUT · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({
    description: 'CATEGORY_NOT_IN_OPTIONS — 보여 준 목록·성별 경로 리프가 아님. VALIDATION_FAILED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  select(
    @Param('categoryDecisionId', CategoryDecisionIdPipe) categoryDecisionId: number,
    @Body() body: CategorySelectionRequestDto,
  ): Promise<CategorySelectionResultDto> {
    return this.decisions.select(categoryDecisionId, body);
  }
}
