import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ListCandidateStepsQueryDto } from '../dto/candidate-request.dto.js';
import { CandidateStepAttentionPageDto } from '../dto/candidate-response.dto.js';
import { CandidateService } from './candidate.service.js';

/** GET /candidate-steps: 대시보드 '재실행 필요·멈춘 후보'(단계 단위, F-DB-01) */
@ApiTags('step-engine')
@Controller('candidate-steps')
export class CandidateStepsController {
  constructor(private readonly candidates: CandidateService) {}

  @Get()
  @ApiOperation({
    operationId: 'listAttentionCandidateSteps',
    summary: '재실행 필요·멈춘 후보 단계 모아 보기',
  })
  @ApiOkResponse({ type: CandidateStepAttentionPageDto })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  list(@Query() query: ListCandidateStepsQueryDto): Promise<CandidateStepAttentionPageDto> {
    return this.candidates.attentionSteps(query);
  }
}
