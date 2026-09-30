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
import { CandidateIdPipe } from '../step-engine/candidates/candidates.controller.js';
import { PriceJudgementDetailDto } from './dto/price-judgement.dto.js';
import { PriceJudgementService } from './price-judgement.service.js';

/** ③ 판정 결과와 사이즈별 비용 분해(05-2 getPriceJudgement, 태그 pricing, P2-05) */
@ApiTags('pricing')
@Controller('candidates/:candidateId/price-judgement')
export class PriceJudgementController {
  constructor(private readonly judgements: PriceJudgementService) {}

  @Get()
  @ApiOperation({ operationId: 'getPriceJudgement', summary: '③ 판정 결과와 사이즈별 비용 분해' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({ name: 'stepRunId', type: 'integer', required: false, description: '볼 ③ 버전' })
  @ApiOkResponse({ type: PriceJudgementDetailDto, description: '판정 스냅샷' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description:
      'CANDIDATE_NOT_FOUND · STEP_RUN_NOT_FOUND · STEP_OUTPUT_NOT_FOUND(details.stepCode=PRICING)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_QUERY_PARAMETER — 다른 후보·단계의 stepRunId',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<PriceJudgementDetailDto> {
    return this.judgements.get(candidateId, query);
  }
}
