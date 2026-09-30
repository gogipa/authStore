import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  type PipeTransform,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiException } from '../../../common/errors/api.exception.js';
import { StepRunIdPipe } from '../../step-engine/step-runs.controller.js';
import {
  GenerationRunAcceptedDto,
  GenerationRunCreateRequestDto,
  GenerationRunDetailDto,
} from '../dto/generation-run.dto.js';
import { generationRunLocation, GenerationRunsService } from './generation-runs.service.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

/** 경로 generationRunId: 1 이상 int4 정수가 아니면 그런 시도는 없다(404 GENERATION_RUN_NOT_FOUND — 실행 id와 같은 규칙) */
export class GenerationRunIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text)) {
      const id = Number(text);
      if (id <= MAX_ID) return id;
    }
    throw new ApiException('GENERATION_RUN_NOT_FOUND');
  }
}

/** AI 썸네일 후보 생성·시도 조회(05-2 createThumbnailGenerationRuns·getThumbnailGenerationRun, 태그 thumbnails, P3-02) */
@ApiTags('thumbnails')
@Controller()
export class GenerationRunsController {
  constructor(private readonly generations: GenerationRunsService) {}

  @Post('step-runs/:stepRunId/generation-runs')
  @HttpCode(202)
  @ApiOperation({
    operationId: 'createThumbnailGenerationRuns',
    summary: 'AI 썸네일 후보 생성·다시 만들기',
  })
  @ApiParam({ name: 'stepRunId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiAcceptedResponse({
    type: GenerationRunAcceptedDto,
    description:
      '생성 시도를 받았다. 진행은 SSE generation-run.updated. Location: /api/v1/generation-runs/{첫 시도 id}',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'STEP_RUN_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'REFERENCES_NOT_CONFIRMED, STEP_RUN_NOT_WAITING_INPUT, ALREADY_IN_PROGRESS(details.job=GENERATION), CANDIDATE_LOCKED, CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({
    description: 'REAL_PERSON_NAME_BLOCKED, INVALID_STEP_CODE, VALIDATION_FAILED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async create(
    @Param('stepRunId', StepRunIdPipe) stepRunId: number,
    @Body() body: GenerationRunCreateRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GenerationRunAcceptedDto> {
    const accepted = await this.generations.create(stepRunId, {
      slotNos: body.slotNos,
      faceOption: body.faceOption,
      promptAdjustment: body.promptAdjustment,
    });
    res.setHeader('Location', generationRunLocation(accepted.generationRuns[0]!.generationRunId));
    return accepted;
  }

  @Get('generation-runs/:generationRunId')
  @ApiOperation({
    operationId: 'getThumbnailGenerationRun',
    summary: '썸네일 생성 시도 한 건 조회',
  })
  @ApiParam({ name: 'generationRunId', type: 'integer', required: true })
  @ApiOkResponse({ type: GenerationRunDetailDto, description: '생성 시도' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'GENERATION_RUN_NOT_FOUND' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('generationRunId', GenerationRunIdPipe) generationRunId: number,
  ): Promise<GenerationRunDetailDto> {
    return this.generations.get(generationRunId);
  }
}
