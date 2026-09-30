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
import { ThumbnailOutputDto } from './dto/thumbnail-output.dto.js';
import { ThumbnailOutputService } from './thumbnail-output.service.js';

/** ⑤ 썸네일 산출물 조회(05-2 getCandidateThumbnail, 태그 thumbnails, P3-02) */
@ApiTags('thumbnails')
@Controller()
export class ThumbnailOutputController {
  constructor(private readonly output: ThumbnailOutputService) {}

  @Get('candidates/:candidateId/thumbnail')
  @ApiOperation({ operationId: 'getCandidateThumbnail', summary: '⑤ 썸네일 산출물 조회' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'stepRunId',
    type: 'integer',
    required: false,
    description: '이전 버전을 볼 때 그 ⑤ 실행 기록 id. 없으면 현재 버전',
  })
  @ApiOkResponse({ type: ThumbnailOutputDto, description: '⑤ 산출물' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND(⑤ 미실행), STEP_RUN_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<ThumbnailOutputDto> {
    return this.output.get(candidateId, query);
  }
}
