import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CandidateIdPipe } from '../../step-engine/candidates/candidates.controller.js';
import { ContentAssemblyOutputDto } from '../dto/content-assembly.dto.js';
import { ContentAssemblyService, PREVIEW_CSP } from './content-assembly.service.js';

const STEP_RUN_QUERY = {
  name: 'stepRunId',
  type: 'integer',
  required: false,
  description: '이전 버전을 볼 때 그 ⑥-3 실행 기록 id. 없으면 현재 버전',
} as const;

/** ⑥-3 고시·사양 블록·구매대행 고지·상품명 조회와 상세페이지 미리보기(05-2 태그 content, P3-04) */
@ApiTags('content')
@Controller()
export class ContentAssemblyController {
  constructor(private readonly assembly: ContentAssemblyService) {}

  @Get('candidates/:candidateId/content-assembly')
  @ApiOperation({
    operationId: 'getCandidateContentAssembly',
    summary: '⑥-3 고시·사양 블록·구매대행 고지·상품명 조회',
  })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery(STEP_RUN_QUERY)
  @ApiOkResponse({ type: ContentAssemblyOutputDto, description: '⑥-3 산출물(HTML 본문 제외)' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND, STEP_RUN_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<ContentAssemblyOutputDto> {
    return this.assembly.get(candidateId, query);
  }

  /**
   * 미리보기(text/html). 헤더 `Content-Security-Policy: sandbox; img-src 'self'`는 성공 응답에만 단다 — 오류는 전역 필터가
   * JSON 봉투로 준다(05-2). 캐시하지 않는다(G3을 다시 고르면 바로 바뀐다)
   */
  @Get('candidates/:candidateId/content-assembly/preview')
  @ApiOperation({ operationId: 'getContentAssemblyPreview', summary: '상세페이지 미리보기(HTML)' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery(STEP_RUN_QUERY)
  @ApiProduces('text/html')
  @ApiOkResponse({ description: '미리보기 HTML', type: String })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND, STEP_RUN_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async preview(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const html = await this.assembly.preview(candidateId, query);
    res.status(200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', PREVIEW_CSP);
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  }
}
