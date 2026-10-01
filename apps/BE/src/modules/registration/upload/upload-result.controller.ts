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
import { UploadResultOutputDto } from '../dto/upload-result.dto.js';
import { UploadResultService } from './upload-result.service.js';

/** ⑧ 업로드 산출물 조회(05-2 getCandidateUploadResult, 태그 registration, P4-01). ⑧ 실행은 공통 단계 실행(표 A) */
@ApiTags('registration')
@Controller()
export class UploadResultController {
  constructor(private readonly results: UploadResultService) {}

  @Get('candidates/:candidateId/upload-result')
  @ApiOperation({
    operationId: 'getCandidateUploadResult',
    summary: '⑧ 업로드 산출물 조회',
  })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'stepRunId',
    type: 'integer',
    required: false,
    description: '이전 버전을 볼 때 그 ⑧ 실행 기록 id. 없으면 현재 버전',
  })
  @ApiOkResponse({ type: UploadResultOutputDto, description: '⑧ 산출물' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND, STEP_RUN_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<UploadResultOutputDto> {
    return this.results.get(candidateId, query);
  }
}
