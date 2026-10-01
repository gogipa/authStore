import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CandidateIdPipe } from '../../step-engine/candidates/candidates.controller.js';
import {
  ApprovalPreviewDto,
  PreValidationRequestDto,
  PreValidationResultDto,
} from '../dto/approval.dto.js';
import { PreValidationService } from '../pre-validation/pre-validation.service.js';
import { ApprovalService } from './approval.service.js';

/** G4 승인 미리보기·사전 검증(05-2 `getCandidateApproval`·`runCandidatePreValidation`, 태그 registration, P4-02) */
@ApiTags('registration')
@Controller()
export class ApprovalController {
  constructor(
    private readonly approval: ApprovalService,
    private readonly preValidation: PreValidationService,
  ) {}

  @Get('candidates/:candidateId/approval')
  @ApiOperation({ operationId: 'getCandidateApproval', summary: 'G4 승인 미리보기' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'optionType',
    enum: ['COMBINATION', 'STANDARD'],
    required: false,
    description: '사이즈 옵션 방식 미리보기. 없으면 COMBINATION(조합형)',
  })
  @ApiOkResponse({ type: ApprovalPreviewDto, description: '승인 미리보기' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND, STEP_OUTPUT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'CANDIDATE_STATUS_INVALID(승인대기 아님, details.allowed)' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  preview(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<ApprovalPreviewDto> {
    return this.approval.preview(candidateId, query);
  }

  @Post('candidates/:candidateId/pre-validations')
  @HttpCode(200)
  @ApiOperation({ operationId: 'runCandidatePreValidation', summary: 'G4 사전 검증 실행' })
  @ApiBody({ type: PreValidationRequestDto, required: false })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(1)' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiOkResponse({ type: PreValidationResultDto, description: '항목별 검증 결과' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({ description: 'CANDIDATE_STATUS_INVALID(승인대기 아님)' })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async runPreValidation(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Body() body: PreValidationRequestDto,
  ): Promise<PreValidationResultDto> {
    return this.preValidation.run(candidateId, body?.optionType ?? 'COMBINATION');
  }
}
