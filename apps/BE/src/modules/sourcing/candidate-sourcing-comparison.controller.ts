import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SourcingComparisonDetailDto } from './dto/sourcing-comparison.dto.js';
import { NotFoundIdPipe } from './sourcing-ids.js';
import { SourcingComparisonsService } from './sourcing-comparisons.service.js';

/**
 * ② 비교표 조회(05-2 getSourcingComparison, P2-02가 머리 행·행을 먼저 만들고 P2-03이 앵커 분류·재고·실질가 값을 채운다).
 * 현재 또는 `?stepRunId=` 버전, 페이징 없음. `sort`는 effectivePriceYen(기본 asc, 미검증 뒤)·searchRank·fetchOrder,
 * `includeNoMatch=false`(기본)면 NO_MATCH 행을 뺀다. `creditText`='Supported by Rakuten Developers'(F-SO-30).
 */
@ApiTags('sourcing')
@Controller('candidates/:candidateId/sourcing-comparison')
export class CandidateSourcingComparisonController {
  constructor(private readonly comparisons: SourcingComparisonsService) {}

  @Get()
  @ApiOperation({ operationId: 'getSourcingComparison', summary: '② 비교표 조회' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'stepRunId',
    type: 'integer',
    required: false,
    description: '볼 ② 버전의 실행 id. 없으면 현재 버전',
  })
  @ApiQuery({
    name: 'includeNoMatch',
    type: Boolean,
    required: false,
    description: 'NO_MATCH 행도 줄지(기본 false)',
  })
  @ApiQuery({
    name: 'sort',
    type: String,
    isArray: true,
    required: false,
    description: 'effectivePriceYen(기본, asc)·searchRank·fetchOrder. `필드,asc|desc`',
  })
  @ApiOkResponse({ type: SourcingComparisonDetailDto, description: '비교표 한 장' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND · STEP_RUN_NOT_FOUND · STEP_OUTPUT_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  getComparison(
    @Param('candidateId', new NotFoundIdPipe('CANDIDATE_NOT_FOUND')) candidateId: number,
    @Query() query: Record<string, unknown>,
  ) {
    return this.comparisons.get(candidateId, query);
  }
}
