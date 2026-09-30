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
import { ContentCopyOutputDto } from '../dto/content.dto.js';
import { ContentCopyService } from './content-copy.service.js';

/** ⑥-1 카피 산출물 조회(05-2 getCandidateContentCopy, 태그 content, P3-03) */
@ApiTags('content')
@Controller()
export class ContentCopyController {
  constructor(private readonly copies: ContentCopyService) {}

  @Get('candidates/:candidateId/content-copy')
  @ApiOperation({ operationId: 'getCandidateContentCopy', summary: '⑥-1 카피 산출물 조회' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'stepRunId',
    type: 'integer',
    required: false,
    description: '이전 버전을 볼 때 그 ⑥-1 실행 기록 id. 없으면 현재 버전',
  })
  @ApiOkResponse({ type: ContentCopyOutputDto, description: '⑥-1 산출물' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND, STEP_RUN_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<ContentCopyOutputDto> {
    return this.copies.get(candidateId, query);
  }
}
