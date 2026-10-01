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
import { TagSetOutputDto } from './dto/tags.dto.js';
import { TagSetService } from './tag-set.service.js';

/** ⑦ 태그 산출물 조회(05-2 getCandidateTagSet, 태그 tags, P3-05). 태그 편집은 owner-edits(표 B) */
@ApiTags('tags')
@Controller()
export class TagSetController {
  constructor(private readonly sets: TagSetService) {}

  @Get('candidates/:candidateId/tag-set')
  @ApiOperation({
    operationId: 'getCandidateTagSet',
    summary: '⑦ 태그 후보표·최종 태그·뺀 태그 조회',
  })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'stepRunId',
    type: 'integer',
    required: false,
    description: '이전 버전을 볼 때 그 ⑦ 실행 기록 id. 없으면 현재 버전',
  })
  @ApiOkResponse({ type: TagSetOutputDto, description: '⑦ 산출물' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND, STEP_RUN_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<TagSetOutputDto> {
    return this.sets.get(candidateId, query);
  }
}
