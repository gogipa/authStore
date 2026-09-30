import { Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CandidateIdPipe } from '../candidates/candidates.controller.js';
import { NoComparisonService, type NoComparisonConfirmationDto } from './no-comparison.service.js';

/** 05-2 CandidateNoComparisonConfirmation */
export class CandidateNoComparisonConfirmationDto implements NoComparisonConfirmationDto {
  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ format: 'date-time' })
  noComparisonConfirmedAt!: string;
}

/**
 * '비교 없이 확정' 체크·해제(05-2 confirmCandidateNoComparison·revokeCandidateNoComparison, 태그 step-engine, P2-05 규칙 15).
 * 웹 화면 전용 기록(로컬 보안 가드 + X-AutoStore-Client).
 */
@ApiTags('step-engine')
@Controller('candidates/:candidateId/no-comparison-confirmation')
export class NoComparisonController {
  constructor(private readonly service: NoComparisonService) {}

  @Put()
  @HttpCode(200)
  @ApiOperation({ operationId: 'confirmCandidateNoComparison', summary: "'비교 없이 확정' 체크" })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: CandidateNoComparisonConfirmationDto, description: '체크했다' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'CONFIRMATION_NOT_APPLICABLE · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  confirm(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
  ): Promise<CandidateNoComparisonConfirmationDto> {
    return this.service.confirm(candidateId);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({
    operationId: 'revokeCandidateNoComparison',
    summary: "'비교 없이 확정' 체크 해제",
  })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiNoContentResponse({ description: '체크를 풀었다' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'GATE_ALREADY_PASSED · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async revoke(@Param('candidateId', CandidateIdPipe) candidateId: number): Promise<void> {
    await this.service.revoke(candidateId);
  }
}
