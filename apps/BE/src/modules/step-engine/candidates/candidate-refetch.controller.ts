import { Controller, HttpCode, Param, Post, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { StepRunAcceptedDto } from '../dto/step-run-response.dto.js';
import { StepExecutionService } from '../execution/step-execution.service.js';
import { stepRunLocation, toAccepted } from '../rail/step-run-view.js';
import { CandidateIdPipe } from './candidates.controller.js';

/**
 * 고른 상품 재조회(05-2 refetchCandidate, 태그 step-engine, P2-02 규칙 15). ② 재조회 새 버전(라쿠텐 페이지 1건 차감) →
 * ③을 실행한 적이 있으면 이어서 ③(execution_mode=STEP). 진행은 SSE step-run.status-changed(폴링 없음).
 */
@ApiTags('step-engine')
@Controller('candidates/:candidateId')
export class CandidateRefetchController {
  constructor(private readonly executions: StepExecutionService) {}

  @Post('refetch')
  @HttpCode(202)
  @ApiOperation({ operationId: 'refetchCandidate', summary: '고른 상품 재조회' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiAcceptedResponse({
    type: StepRunAcceptedDto,
    description: '재조회를 받았다. stepRunId는 ② 새 버전. Location: /api/v1/step-runs/{stepRunId}',
  })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'SOURCING_SELECTION_REQUIRED · DAILY_LIMIT_REACHED · EXTERNAL_CALL_COOLDOWN(Retry-After) · STEP_ALREADY_RUNNING · STEP_LOCKED_BY_RUNNING_STEP · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async refetch(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StepRunAcceptedDto> {
    const result = await this.executions.startRefetch(candidateId);
    res.setHeader('Location', stepRunLocation(result.run.id));
    return toAccepted(result);
  }
}
