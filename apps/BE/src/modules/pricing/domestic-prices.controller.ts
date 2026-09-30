import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import { CandidateIdPipe } from '../step-engine/candidates/candidates.controller.js';
import {
  CreateDomesticPriceDto,
  DomesticPriceCreatedDto,
  DomesticPricePageDto,
  ListDomesticPricesQueryDto,
} from './dto/domestic-price.dto.js';
import { DomesticPricesService, domesticPricesLocation } from './domestic-prices.service.js';

/** 국내 기준가 입력·이력(05-2 createDomesticPrice·listDomesticPrices, 태그 pricing, P2-05) */
@ApiTags('pricing')
@Controller('candidates/:candidateId/domestic-prices')
export class DomesticPricesController {
  constructor(private readonly prices: DomesticPricesService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createDomesticPrice', summary: '국내 기준가 입력' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiCreatedResponse({ type: DomesticPriceCreatedDto, description: '저장한 국내 기준가와 ③ 상태' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'CANDIDATE_LOCKED · CANDIDATE_EXCLUDED · STEP_LOCKED_BY_RUNNING_STEP(③ 실행 중)',
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async create(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Body() body: CreateDomesticPriceDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<DomesticPriceCreatedDto> {
    const created = await this.prices.create(candidateId, body);
    res.setHeader('Location', domesticPricesLocation(candidateId));
    return created;
  }

  @Get()
  @ApiOperation({ operationId: 'listDomesticPrices', summary: '국내 기준가 입력 이력' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiOkResponse({ type: DomesticPricePageDto, description: '입력 이력' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: ListDomesticPricesQueryDto,
  ): Promise<DomesticPricePageDto> {
    return this.prices.list(candidateId, query);
  }
}
