import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CommerceMetaSyncService } from './commerce-meta-sync.service.js';
import { META_SYNC_LATEST_LOCATION } from './commerce-meta.constants.js';
import {
  CommerceMetaSyncAcceptedDto,
  CommerceMetaSyncRequestDto,
  CommerceMetaSyncStatusListDto,
} from './dto/commerce-meta-sync.dto.js';

/** 메타데이터 동기화 상태·지금 동기화(05-2 태그 integrations, P1-08 규칙 6·8) */
@ApiTags('integrations')
@Controller('commerce-meta-sync-runs')
export class CommerceMetaSyncController {
  constructor(private readonly sync: CommerceMetaSyncService) {}

  @Get('latest')
  @ApiOperation({
    operationId: 'getLatestCommerceMetaSyncRuns',
    summary: '메타데이터 대상별 최신 동기화 상태 조회',
  })
  @ApiOkResponse({ type: CommerceMetaSyncStatusListDto, description: '대상별 최신 동기화 상태' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  latest(): Promise<CommerceMetaSyncStatusListDto> {
    return this.sync.latest();
  }

  @Post()
  @HttpCode(202)
  @ApiOperation({ operationId: 'createCommerceMetaSyncRuns', summary: '메타데이터 지금 동기화' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiBody({ type: CommerceMetaSyncRequestDto, required: false })
  @ApiAcceptedResponse({
    type: CommerceMetaSyncAcceptedDto,
    description:
      '대상별 동기화 실행 기록(RUNNING). Location: /api/v1/commerce-meta-sync-runs/latest',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiConflictResponse({
    description:
      'ALREADY_IN_PROGRESS(details.job=META_SYNC, 진행 중 대상) · SECRET_NOT_CONFIGURED(커머스 키 없음)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED — 빈 배열·중복·알 수 없는 대상',
  })
  @ApiServiceUnavailableResponse({ description: 'KEYCHAIN_UNAVAILABLE — 키체인을 열 수 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async create(
    @Body() body: CommerceMetaSyncRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CommerceMetaSyncAcceptedDto> {
    const items = await this.sync.start(body?.targets);
    res.setHeader('Location', META_SYNC_LATEST_LOCATION);
    return { items };
  }
}
