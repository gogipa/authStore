import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { PageQueryDto } from '../../../common/paging/page-query.dto.js';
import {
  CandidateGenderDto,
  CreateCandidateDto,
  ListCandidatesQueryDto,
} from '../dto/candidate-request.dto.js';
import {
  CandidateDetailDto,
  CandidateGenderResultDto,
  CandidatePageDto,
  CandidateResumeTargetDto,
  CandidateStatusChangeResultDto,
  CandidateStatusCountListDto,
  CandidateStatusHistoryPageDto,
} from '../dto/candidate-response.dto.js';
import { CandidateGenderService } from './candidate-gender.service.js';
import { parseCandidateId } from './candidate-guard.service.js';
import { CandidateService } from './candidate.service.js';

/** 경로 candidateId: 1 이상 int4 정수가 아니면 404 CANDIDATE_NOT_FOUND(그런 후보는 없다, P1-01 이미지 id와 같은 규칙) */
export class CandidateIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    return parseCandidateId(value);
  }
}

/** 201 Location: 만든 후보 경로(API_PREFIX 'api/v1' 포함) */
export function candidateLocation(candidateId: number): string {
  return `/api/v1/candidates/${candidateId}`;
}

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const CANDIDATE_ID_PARAM = { name: 'candidateId', type: 'integer', required: true } as const;

/**
 * step-engine 후보(05-2 태그 step-engine, P1-04): 목록·만들기·상태별 수·이어서 할 곳·상세·제외·다시 작업·상태 이력·성별.
 * 고정 경로(status-counts·resume-target)는 `:candidateId`보다 먼저 둔다.
 */
@ApiTags('step-engine')
@Controller('candidates')
export class CandidatesController {
  constructor(
    private readonly candidates: CandidateService,
    private readonly gender: CandidateGenderService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listCandidates', summary: '진행 중 후보 목록' })
  @ApiOkResponse({ type: CandidatePageDto })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  list(@Query() query: ListCandidatesQueryDto): Promise<CandidatePageDto> {
    return this.candidates.list(query);
  }

  @Post()
  @ApiOperation({ operationId: 'createCandidate', summary: '후보 만들기' })
  @ApiHeader(CLIENT_HEADER)
  @ApiBody({ type: CreateCandidateDto })
  @ApiCreatedResponse({
    type: CandidateDetailDto,
    description: '후보를 만들었다(WORKING). Location: /api/v1/candidates/{candidateId}',
  })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'KEYWORD_NOT_FOUND · RAKUTEN_ITEM_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'KEYWORD_NOT_SELECTED · KEYWORD_EXCLUDED · CANDIDATE_DUPLICATE(details.existingCandidateId)',
  })
  @ApiUnprocessableEntityResponse({ description: 'RAKUTEN_QUERY_INVALID · VALIDATION_FAILED' })
  async create(
    @Body() body: CreateCandidateDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CandidateDetailDto> {
    const detail = await this.candidates.create(body);
    res.status(201).setHeader('Location', candidateLocation(detail.id));
    return detail;
  }

  @Get('status-counts')
  @ApiOperation({ operationId: 'getCandidateStatusCounts', summary: '상태별 후보 수' })
  @ApiOkResponse({ type: CandidateStatusCountListDto })
  @ApiForbiddenResponse(FORBIDDEN)
  statusCounts(): Promise<CandidateStatusCountListDto> {
    return this.candidates.statusCounts();
  }

  @Get('resume-target')
  @ApiOperation({ operationId: 'getCandidateResumeTarget', summary: '이어서 할 곳 한 건' })
  @ApiOkResponse({ type: CandidateResumeTargetDto })
  @ApiNoContentResponse({ description: '이어서 할 곳이 없다' })
  @ApiForbiddenResponse(FORBIDDEN)
  async resumeTarget(
    @Res({ passthrough: true }) res: Response,
  ): Promise<CandidateResumeTargetDto | undefined> {
    const target = await this.candidates.resumeTarget();
    if (!target) {
      res.status(204);
      return undefined;
    }
    return target;
  }

  @Get(':candidateId')
  @ApiOperation({ operationId: 'getCandidate', summary: '후보 상세' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiOkResponse({ type: CandidateDetailDto })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  detail(@Param('candidateId', CandidateIdPipe) candidateId: number): Promise<CandidateDetailDto> {
    return this.candidates.detail(candidateId);
  }

  @Post(':candidateId/exclude')
  @HttpCode(200)
  @ApiOperation({ operationId: 'excludeCandidate', summary: '후보 제외' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiOkResponse({ type: CandidateStatusChangeResultDto, description: '제외했다' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'CANDIDATE_STATUS_INVALID · CANDIDATE_LOCKED · STEP_LOCKED_BY_RUNNING_STEP',
  })
  exclude(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
  ): Promise<CandidateStatusChangeResultDto> {
    return this.candidates.exclude(candidateId);
  }

  @Post(':candidateId/reopen')
  @HttpCode(200)
  @ApiOperation({ operationId: 'reopenCandidate', summary: '제외된 후보 다시 작업' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiOkResponse({ type: CandidateStatusChangeResultDto, description: '작업중으로 되돌렸다' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'CANDIDATE_DUPLICATE(details.existingCandidateId) · CANDIDATE_STATUS_INVALID · CANDIDATE_LOCKED',
  })
  reopen(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
  ): Promise<CandidateStatusChangeResultDto> {
    return this.candidates.reopen(candidateId);
  }

  @Get(':candidateId/status-history')
  @ApiOperation({ operationId: 'listCandidateStatusHistory', summary: '후보 상태 전이 이력' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiOkResponse({ type: CandidateStatusHistoryPageDto })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  statusHistory(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: PageQueryDto,
  ): Promise<CandidateStatusHistoryPageDto> {
    return this.candidates.statusHistory(candidateId, query);
  }

  @Put(':candidateId/gender')
  @ApiOperation({ operationId: 'setCandidateGender', summary: '후보 성별 직접 입력' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiOkResponse({ type: CandidateGenderResultDto, description: '성별을 저장했다' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'STEP_LOCKED_BY_RUNNING_STEP · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_FAILED' })
  setGender(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Body() body: CandidateGenderDto,
  ): Promise<CandidateGenderResultDto> {
    return this.gender.setOwnerGender(candidateId, body.gender);
  }
}
