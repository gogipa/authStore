import { Body, Controller, HttpCode, Param, Post, Put, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadGatewayResponse,
  ApiBody,
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
import { AdultConfirmationService } from './adult-confirmation.service.js';
import { AnchorService, comparisonLocation } from './anchor.service.js';
import { AdultProductConfirmationDto } from './dto/rakuten.dto.js';
import {
  SourcingAnchorRequestDto,
  SourcingComparisonRowViewDto,
  SourcingJobAcceptedDto,
  SourcingManualRowRequestDto,
  SourcingSearchMoreResultDto,
  SourcingSelectionRequestDto,
  SourcingSelectionResultDto,
} from './dto/sourcing-comparison.dto.js';
import { ManualRowService } from './manual-row.service.js';
import { SearchMoreService } from './search-more.service.js';
import { SelectionService } from './selection.service.js';
import { NotFoundIdPipe } from './sourcing-ids.js';
import {
  parseAnchorRequest,
  parseManualRowRequest,
  parseSelectionRequest,
} from './sourcing-requests.js';

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;

/**
 * ② 비교표 머리(05-2 태그 sourcing, 경로 /sourcing-comparisons/{id}/…). 본문은 모두 `additionalProperties: false` —
 * 검사는 sourcing-requests.ts(422 VALIDATION_FAILED). 비교표 조회는 CandidateSourcingComparisonController, 행 수정·재고 확인은
 * SourcingComparisonRowsController.
 * - P2-02: 성인용 상품 확인(confirmSourcingAdultProduct)
 * - P2-03: 앵커 정하기(fixSourcingAnchor, 202 + 백그라운드), 수동 행 넣기(addSourcingComparisonManualRow, 201),
 *   최종 후보 고르기(selectSourcingComparisonRow, 200 — ② 완료)
 * - D-47: 검색 결과 더 보기(loadMoreSourcingSearchRows, 200 — 기준 상품 전 탐색 모드에서 목록을 다음 페이지로 늘린다)
 */
@ApiTags('sourcing')
@Controller('sourcing-comparisons/:sourcingComparisonId')
export class SourcingComparisonsController {
  constructor(
    private readonly adult: AdultConfirmationService,
    private readonly anchors: AnchorService,
    private readonly manualRows: ManualRowService,
    private readonly searchMore: SearchMoreService,
    private readonly selection: SelectionService,
  ) {}

  @Put('adult-product-confirmation')
  @ApiOperation({ operationId: 'confirmSourcingAdultProduct', summary: '성인용 상품 확인 체크' })
  @ApiParam({ name: 'sourcingComparisonId', type: 'integer', required: true })
  @ApiHeader(CLIENT_HEADER)
  @ApiOkResponse({ type: AdultProductConfirmationDto, description: '확인 기록' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'SOURCING_COMPARISON_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'CONFIRMATION_NOT_APPLICABLE — 아동화 의심·장르 문제가 아님. STEP_RUN_NOT_WAITING_INPUT',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  confirmAdult(
    @Param('sourcingComparisonId', new NotFoundIdPipe('SOURCING_COMPARISON_NOT_FOUND'))
    sourcingComparisonId: number,
  ): Promise<AdultProductConfirmationDto> {
    return this.adult.confirm(sourcingComparisonId);
  }

  @Put('anchor')
  @HttpCode(202)
  @ApiOperation({ operationId: 'fixSourcingAnchor', summary: '앵커 상품·색상 정하기' })
  @ApiParam({ name: 'sourcingComparisonId', type: 'integer', required: true })
  @ApiHeader(CLIENT_HEADER)
  @ApiBody({ type: SourcingAnchorRequestDto })
  @ApiAcceptedResponse({
    type: SourcingJobAcceptedDto,
    description:
      '앵커를 저장하고 분류·페이지 조회를 시작했다. Location: /api/v1/candidates/{candidateId}/sourcing-comparison',
  })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'SOURCING_COMPARISON_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'STEP_RUN_NOT_WAITING_INPUT · ANCHOR_KEY_MISMATCH · DAILY_LIMIT_REACHED · EXTERNAL_CALL_COOLDOWN · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED — anchorInputMethod별 필수값 누락',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async fixAnchor(
    @Param('sourcingComparisonId', new NotFoundIdPipe('SOURCING_COMPARISON_NOT_FOUND'))
    sourcingComparisonId: number,
    @Body() body: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SourcingJobAcceptedDto> {
    const request = parseAnchorRequest(body);
    const accepted = await this.anchors.fix(sourcingComparisonId, request);
    res.setHeader('Location', comparisonLocation(accepted.candidateId));
    return accepted;
  }

  @Post('search-more')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'loadMoreSourcingSearchRows',
    summary: '검색 결과 더 보기(다음 30건)',
  })
  @ApiParam({ name: 'sourcingComparisonId', type: 'integer', required: true })
  @ApiHeader(CLIENT_HEADER)
  @ApiOkResponse({
    type: SourcingSearchMoreResultDto,
    description: '더한 행 수와 다음 페이지가 더 있는지',
  })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'SOURCING_COMPARISON_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'ANCHOR_ALREADY_FIXED · STEP_RUN_NOT_WAITING_INPUT · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED · EXTERNAL_CALL_COOLDOWN · SECRET_NOT_CONFIGURED',
  })
  @ApiUnprocessableEntityResponse({
    description: 'RAKUTEN_QUERY_INVALID — 검색어가 없거나 형식이 맞지 않음',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiBadGatewayResponse({ description: 'EXTERNAL_API_ERROR(details.target=RAKUTEN_API·reason)' })
  loadMoreSearchRows(
    @Param('sourcingComparisonId', new NotFoundIdPipe('SOURCING_COMPARISON_NOT_FOUND'))
    sourcingComparisonId: number,
  ): Promise<SourcingSearchMoreResultDto> {
    return this.searchMore.loadMore(sourcingComparisonId);
  }

  @Post('rows')
  @HttpCode(201)
  @ApiOperation({
    operationId: 'addSourcingComparisonManualRow',
    summary: "URL 상품을 비교표 '수동' 행으로 넣기",
  })
  @ApiParam({ name: 'sourcingComparisonId', type: 'integer', required: true })
  @ApiHeader(CLIENT_HEADER)
  @ApiBody({ type: SourcingManualRowRequestDto })
  @ApiCreatedResponse({ type: SourcingComparisonRowViewDto, description: '넣은 행(검증됨)' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'SOURCING_COMPARISON_NOT_FOUND · RAKUTEN_ITEM_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'ROW_ALREADY_EXISTS · ANCHOR_NOT_FIXED · STEP_RUN_NOT_WAITING_INPUT · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({ description: 'RAKUTEN_ITEM_EXCLUDED_WORD · VALIDATION_FAILED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  addManualRow(
    @Param('sourcingComparisonId', new NotFoundIdPipe('SOURCING_COMPARISON_NOT_FOUND'))
    sourcingComparisonId: number,
    @Body() body: Record<string, unknown>,
  ) {
    const { rakutenItemId } = parseManualRowRequest(body);
    return this.manualRows.add(sourcingComparisonId, rakutenItemId);
  }

  @Put('selection')
  @ApiOperation({
    operationId: 'selectSourcingComparisonRow',
    summary: '최종 후보 한 개 고르기(② 완료)',
  })
  @ApiParam({ name: 'sourcingComparisonId', type: 'integer', required: true })
  @ApiHeader(CLIENT_HEADER)
  @ApiBody({ type: SourcingSelectionRequestDto })
  @ApiOkResponse({ type: SourcingSelectionResultDto, description: '선택 결과' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({
    description: 'SOURCING_COMPARISON_NOT_FOUND · SOURCING_COMPARISON_ROW_NOT_FOUND',
  })
  @ApiConflictResponse({
    description:
      'ROW_NOT_VERIFIED · ROW_STOCK_INSUFFICIENT · ANCHOR_KEY_MISMATCH · ANCHOR_NOT_FIXED · ADULT_CONFIRMATION_REQUIRED · GENDER_REQUIRED · CANDIDATE_DUPLICATE · STEP_RUN_NOT_WAITING_INPUT · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED — rowId 없음·다른 비교표의 행',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  select(
    @Param('sourcingComparisonId', new NotFoundIdPipe('SOURCING_COMPARISON_NOT_FOUND'))
    sourcingComparisonId: number,
    @Body() body: Record<string, unknown>,
  ): Promise<SourcingSelectionResultDto> {
    const { rowId } = parseSelectionRequest(body);
    return this.selection.select(sourcingComparisonId, rowId);
  }
}
