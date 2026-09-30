import { Body, Controller, HttpCode, Param, Patch, Post, Res } from '@nestjs/common';
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
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { comparisonLocation } from './anchor.service.js';
import {
  SourcingComparisonRowPatchDto,
  SourcingJobAcceptedDto,
} from './dto/sourcing-comparison.dto.js';
import { RowUpdateService } from './row-update.service.js';
import { NotFoundIdPipe } from './sourcing-ids.js';
import { parseRowPatch } from './sourcing-requests.js';
import { StockCheckService } from './stock-check.service.js';

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;

/**
 * ② 비교표 행(05-2 태그 sourcing, P2-03): 행 수정·실질가 재계산(updateSourcingComparisonRow, 200 `{ row, rankedRowIds }`),
 * 미검증 행 재고 확인(requestSourcingRowStockCheck, 202 — 결과는 SSE sourcing.row-updated).
 */
@ApiTags('sourcing')
@Controller('sourcing-comparison-rows/:rowId')
export class SourcingComparisonRowsController {
  constructor(
    private readonly rows: RowUpdateService,
    private readonly stockChecks: StockCheckService,
  ) {}

  @Patch()
  @ApiOperation({
    operationId: 'updateSourcingComparisonRow',
    summary: '비교표 행 수정·실질가 재계산',
  })
  @ApiParam({ name: 'rowId', type: 'integer', required: true })
  @ApiHeader(CLIENT_HEADER)
  @ApiBody({ type: SourcingComparisonRowPatchDto })
  @ApiOkResponse({ description: '다시 계산한 행과 실질가 순서' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'SOURCING_COMPARISON_ROW_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'STEP_RUN_NOT_WAITING_INPUT — 닫힌 버전의 행. CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_FAILED — 음수, 빈 본문' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  update(
    @Param('rowId', new NotFoundIdPipe('SOURCING_COMPARISON_ROW_NOT_FOUND')) rowId: number,
    @Body() body: Record<string, unknown>,
  ) {
    return this.rows.update(rowId, parseRowPatch(body));
  }

  @Post('stock-checks')
  @HttpCode(202)
  @ApiOperation({ operationId: 'requestSourcingRowStockCheck', summary: '미검증 행 재고 확인' })
  @ApiParam({ name: 'rowId', type: 'integer', required: true })
  @ApiHeader(CLIENT_HEADER)
  @ApiAcceptedResponse({
    type: SourcingJobAcceptedDto,
    description:
      '재고 확인을 받았다. Location: /api/v1/candidates/{candidateId}/sourcing-comparison',
  })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'SOURCING_COMPARISON_ROW_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'ALREADY_IN_PROGRESS(details.job=STOCK_CHECK) · DAILY_LIMIT_REACHED · EXTERNAL_CALL_COOLDOWN · STEP_RUN_NOT_WAITING_INPUT · ANCHOR_NOT_FIXED · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async requestStockCheck(
    @Param('rowId', new NotFoundIdPipe('SOURCING_COMPARISON_ROW_NOT_FOUND')) rowId: number,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SourcingJobAcceptedDto> {
    const accepted = await this.stockChecks.request(rowId);
    res.setHeader('Location', comparisonLocation(accepted.candidateId));
    return accepted;
  }
}
