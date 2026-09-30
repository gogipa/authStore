import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiException } from '../../common/errors/api.exception.js';
import { PageQueryDto } from '../../common/paging/page-query.dto.js';
import { CandidateIdPipe } from './candidates/candidates.controller.js';
import { isStepCode, type StepCode } from './domain/steps.js';
import { StepOwnerEditRequestDto, StepRunStartRequestDto } from './dto/step-run-request.dto.js';
import {
  CandidateStepRailDto,
  StepOwnerEditResultDto,
  StepRunAcceptedDto,
  StepRunVersionPageDto,
  StepStaleDiffDto,
} from './dto/step-run-response.dto.js';
import { StepExecutionService } from './execution/step-execution.service.js';
import { OwnerEditService } from './owner-edits/owner-edit.service.js';
import { StaleDiffService } from './rail/stale-diff.service.js';
import { StepRailService } from './rail/step-rail.service.js';
import { stepRunLocation, toAccepted } from './rail/step-run-view.js';

/** 경로 stepCode: 모르는 코드는 422 INVALID_STEP_CODE(05-3 §5.1 '알 수 없는 stepCode') */
export class StepCodePipe implements PipeTransform<unknown, StepCode> {
  transform(value: unknown): StepCode {
    if (isStepCode(value)) return value;
    throw new ApiException('INVALID_STEP_CODE', {
      details: { stepCode: typeof value === 'string' ? value.slice(0, 32) : null },
    });
  }
}

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const CANDIDATE_ID_PARAM = { name: 'candidateId', type: 'integer', required: true } as const;
const STEP_CODE_PARAM = {
  name: 'stepCode',
  required: true,
  enum: [
    'SOURCING',
    'PRICING',
    'CATEGORY',
    'THUMBNAIL',
    'COPY',
    'NOTICE_RAW',
    'NOTICE_HTML',
    'TAGS',
    'UPLOAD',
    'REGISTER',
  ],
} as const;

/**
 * 단계 레일·단계 실행·버전 이력·바뀐 입력·오너 수정(05-2 태그 step-engine, P1-05).
 */
@ApiTags('step-engine')
@ApiExtraModels(StepRunAcceptedDto)
@Controller('candidates/:candidateId/steps')
export class CandidateStepRailController {
  constructor(
    private readonly rail: StepRailService,
    private readonly executions: StepExecutionService,
    private readonly staleDiffs: StaleDiffService,
    private readonly ownerEdits: OwnerEditService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listCandidateSteps', summary: '단계 레일' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiOkResponse({ type: CandidateStepRailDto })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  list(@Param('candidateId', CandidateIdPipe) candidateId: number): Promise<CandidateStepRailDto> {
    return this.rail.rail(candidateId);
  }

  @Post(':stepCode/runs')
  @HttpCode(202)
  @ApiOperation({ operationId: 'startCandidateStepRun', summary: '단계 하나 실행·다시 실행' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiParam(STEP_CODE_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiBody({ type: StepRunStartRequestDto, required: false })
  @ApiAcceptedResponse({
    type: StepRunAcceptedDto,
    description: '실행을 받았다. Location: /api/v1/step-runs/{stepRunId}',
  })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'STEP_START_CONDITION_UNMET · STEP_ALREADY_RUNNING · STEP_LOCKED_BY_RUNNING_STEP · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED · GATE_NOT_PASSED',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STEP_CODE · VALIDATION_FAILED' })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID' })
  async start(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Param('stepCode', StepCodePipe) stepCode: StepCode,
    @Body() body: StepRunStartRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StepRunAcceptedDto> {
    const result = await this.executions.start(candidateId, stepCode, {
      mode: 'STEP',
      ownerInputs: { ...(body?.ownerInputs ?? {}) },
      throughStepCode: body?.throughStepCode ?? null,
    });
    res.setHeader('Location', stepRunLocation(result.run.id));
    return toAccepted(result);
  }

  @Get(':stepCode/runs')
  @ApiOperation({ operationId: 'listCandidateStepRuns', summary: '단계별 버전 이력' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiParam(STEP_CODE_PARAM)
  @ApiOkResponse({ type: StepRunVersionPageDto })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STEP_CODE · INVALID_QUERY_PARAMETER' })
  runs(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Param('stepCode', StepCodePipe) stepCode: StepCode,
    @Query() query: PageQueryDto,
  ): Promise<StepRunVersionPageDto> {
    return this.rail.runs(candidateId, stepCode, query);
  }

  @Get(':stepCode/stale-diff')
  @ApiOperation({
    operationId: 'getCandidateStepStaleDiff',
    summary: '재실행 필요 단계의 바뀐 입력',
  })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiParam(STEP_CODE_PARAM)
  @ApiOkResponse({ type: StepStaleDiffDto })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({ description: 'STEP_NOT_RERUN_REQUIRED' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_STEP_CODE' })
  staleDiff(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Param('stepCode', StepCodePipe) stepCode: StepCode,
  ): Promise<StepStaleDiffDto> {
    return this.staleDiffs.diff(candidateId, stepCode);
  }

  @Post(':stepCode/owner-edits')
  @ApiOperation({
    operationId: 'createCandidateStepOwnerEdit',
    summary: '오너 수정 새 버전 만들기',
  })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiParam(STEP_CODE_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiBody({ type: StepOwnerEditRequestDto })
  @ApiCreatedResponse({
    type: StepOwnerEditResultDto,
    description: '새 버전(OWNER_EDIT)을 만들었다. Location: /api/v1/step-runs/{stepRunId}',
  })
  @ApiAcceptedResponse({
    type: StepRunAcceptedDto,
    description: 'TAGS 편집을 받았다(재검증 뒤 SSE)',
  })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND · STEP_RUN_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'VERSION_NOT_CURRENT · STEP_ALREADY_RUNNING · STEP_LOCKED_BY_RUNNING_STEP · CANDIDATE_LOCKED · STEP_NOT_RERUN_REQUIRED · STEP_NOT_COMPLETED · STEP_RUN_ALREADY_CURRENT · ANCHOR_KEY_MISMATCH',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'INVALID_STEP_CODE · KEEP_AS_IS_NOT_ALLOWED · FIELD_NOT_EDITABLE · VALIDATION_FAILED',
  })
  async ownerEdit(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Param('stepCode', StepCodePipe) stepCode: StepCode,
    @Body() body: StepOwnerEditRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StepOwnerEditResultDto | StepRunAcceptedDto> {
    const outcome = await this.ownerEdits.create(candidateId, stepCode, body ?? {});
    if (outcome.kind === 'ACCEPTED') {
      res.status(202).setHeader('Location', stepRunLocation(outcome.accepted.run.id));
      return toAccepted(outcome.accepted);
    }
    res.status(201).setHeader('Location', stepRunLocation(outcome.result.stepRunId));
    return outcome.result;
  }
}
