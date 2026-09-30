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
import { CandidateIdPipe } from '../../step-engine/candidates/candidates.controller.js';
import { ContentFactOutputDto } from '../dto/content.dto.js';
import { ContentFactService } from './content-fact.service.js';

/** ⑥-2 고시 원자료와 원문 근거 대조(05-2 getCandidateContentFact, 태그 content, P3-03) */
@ApiTags('content')
@Controller()
export class ContentFactController {
  constructor(private readonly facts: ContentFactService) {}

  @Get('candidates/:candidateId/content-fact')
  @ApiOperation({
    operationId: 'getCandidateContentFact',
    summary: '⑥-2 고시 원자료와 원문 근거 대조',
  })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'stepRunId',
    type: 'integer',
    required: false,
    description: '이전 버전을 볼 때 그 ⑥-2 실행 기록 id. 없으면 현재 버전',
  })
  @ApiOkResponse({ type: ContentFactOutputDto, description: '⑥-2 산출물' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND, STEP_RUN_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<ContentFactOutputDto> {
    return this.facts.get(candidateId, query);
  }
}
