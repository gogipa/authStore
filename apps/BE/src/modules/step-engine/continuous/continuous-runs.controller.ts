import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiException } from '../../../common/errors/api.exception.js';
import { CandidateIdPipe } from '../candidates/candidates.controller.js';
import {
  ContinuousRunAcceptedDto,
  ContinuousRunDetailDto,
  ContinuousRunStartRequestDto,
} from '../dto/continuous-run.dto.js';
import { ContinuousRunService, continuousRunLocation } from './continuous-run.service.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

/** 경로 stepChainId: 1 이상 int4 정수가 아니면 그런 묶음은 없다(404 CONTINUOUS_RUN_NOT_FOUND, 후보 id와 같은 규칙) */
export class StepChainIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text)) {
      const id = Number(text);
      if (id <= MAX_ID) return id;
    }
    throw new ApiException('CONTINUOUS_RUN_NOT_FOUND');
  }
}

/** 연속 실행 시작(후보 아래) */
@ApiTags('step-engine')
@Controller('candidates/:candidateId/continuous-runs')
export class CandidateContinuousRunsController {
  constructor(private readonly runs: ContinuousRunService) {}

  @Post()
  @HttpCode(202)
  @ApiOperation({ operationId: 'startCandidateContinuousRun', summary: '연속 실행 시작' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiBody({ type: ContinuousRunStartRequestDto })
  @ApiAcceptedResponse({
    type: ContinuousRunAcceptedDto,
    description: '연속 실행을 받았다. Location: /api/v1/continuous-runs/{stepChainId}',
  })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'CONTINUOUS_RUN_ALREADY_OPEN · CONTINUOUS_RUN_BEFORE_G2 · NO_RERUN_REQUIRED_STEPS · STEP_ALREADY_RUNNING · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED · AI_ENGINE_UNAVAILABLE',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STEP_CODE · VALIDATION_FAILED' })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID' })
  async start(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Body() body: ContinuousRunStartRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ContinuousRunAcceptedDto> {
    const accepted = await this.runs.start(candidateId, body);
    res.setHeader('Location', continuousRunLocation(accepted.stepChainId));
    return accepted;
  }
}

/** 연속 실행 한 번 조회 */
@ApiTags('step-engine')
@Controller('continuous-runs')
export class ContinuousRunsController {
  constructor(private readonly runs: ContinuousRunService) {}

  @Get(':stepChainId')
  @ApiOperation({ operationId: 'getContinuousRun', summary: '연속 실행 진행·멈춘 이유' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiParam({ name: 'stepChainId', type: 'integer', required: true })
  @ApiOkResponse({ type: ContinuousRunDetailDto })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CONTINUOUS_RUN_NOT_FOUND' })
  get(@Param('stepChainId', StepChainIdPipe) stepChainId: number): Promise<ContinuousRunDetailDto> {
    return this.runs.detail(stepChainId);
  }
}
