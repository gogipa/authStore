import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import {
  AiCliCheckAcceptedDto,
  AiCliCheckLatestListDto,
  AiCliCheckListQueryDto,
  AiCliCheckPageDto,
  AiCliCheckRequestDto,
} from './ai-cli-check.dto.js';
import { AI_CLI_CHECKS_LATEST_LOCATION, AiCliChecksService } from './ai-cli-checks.service.js';

@ApiTags('system')
@Controller('ai-cli-checks')
export class AiCliChecksController {
  constructor(private readonly service: AiCliChecksService) {}

  @Get('latest')
  @ApiOperation({
    operationId: 'getLatestAiCliChecks',
    summary: 'AI 엔진별 최신 점검 결과 조회',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiOkResponse({
    type: AiCliCheckLatestListDto,
    description: '엔진별 최신 점검 결과와 선택 엔진',
  })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  getLatest(): Promise<AiCliCheckLatestListDto> {
    return this.service.getLatest();
  }

  @Get()
  @ApiOperation({
    operationId: 'listAiCliChecks',
    summary: 'AI 엔진 점검 이력 조회',
    description: 'P1-11 Proposed — SCR-13 최근 점검 이력 표(최신순 페이징)',
  })
  @ApiOkResponse({ type: AiCliCheckPageDto, description: '점검 이력 한 쪽' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(@Query() query: AiCliCheckListQueryDto): Promise<AiCliCheckPageDto> {
    return this.service.list(query);
  }

  @Post()
  @HttpCode(202)
  @ApiOperation({ operationId: 'createAiCliCheck', summary: 'AI 엔진 감지·연결 테스트 실행' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiAcceptedResponse({
    type: AiCliCheckAcceptedDto,
    description: '점검을 받았다(Location: /api/v1/ai-cli-checks/latest)',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiConflictResponse({ description: 'ALREADY_IN_PROGRESS(details.job=AI_CLI_CHECK)' })
  @ApiUnprocessableEntityResponse({
    description:
      'VALIDATION_FAILED(smokeTest=true인데 engineCodes 없음·STARTUP 등) · AI_MODEL_INVALID',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async create(
    @Body() body: AiCliCheckRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AiCliCheckAcceptedDto> {
    const accepted = await this.service.start(body);
    res.setHeader('Location', AI_CLI_CHECKS_LATEST_LOCATION);
    return accepted;
  }
}
