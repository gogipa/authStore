import { Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
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
import { AdultConfirmationService } from './adult-confirmation.service.js';
import { AdultProductConfirmationDto } from './dto/rakuten.dto.js';
import { NotFoundIdPipe } from './sourcing-ids.js';
import { SourcingComparisonsService } from './sourcing-comparisons.service.js';

/**
 * ② 비교표(05-2 태그 sourcing). P2-02: 성인용 상품 확인(confirmSourcingAdultProduct)과 비교표 조회(getSourcingComparison —
 * 머리 행·행을 있는 그대로, 앵커 분류·재고·실질가 값은 P2-03). 앵커·행 수정·재고 확인·수동 행·선택은 P2-03이 이 컨트롤러에 더한다.
 */
@ApiTags('sourcing')
@Controller()
export class SourcingComparisonsController {
  constructor(
    private readonly adult: AdultConfirmationService,
    private readonly comparisons: SourcingComparisonsService,
  ) {}

  @Put('sourcing-comparisons/:sourcingComparisonId/adult-product-confirmation')
  @ApiOperation({ operationId: 'confirmSourcingAdultProduct', summary: '성인용 상품 확인 체크' })
  @ApiParam({ name: 'sourcingComparisonId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
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

  @Get('candidates/:candidateId/sourcing-comparison')
  @ApiOperation({ operationId: 'getSourcingComparison', summary: '② 비교표 조회' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiOkResponse({ description: '비교표 한 장' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({
    description: 'CANDIDATE_NOT_FOUND · STEP_RUN_NOT_FOUND · STEP_OUTPUT_NOT_FOUND',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  getComparison(
    @Param('candidateId', new NotFoundIdPipe('CANDIDATE_NOT_FOUND')) candidateId: number,
    @Query() query: Record<string, unknown>,
  ) {
    return this.comparisons.get(candidateId, query);
  }
}
