import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadGatewayResponse,
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
import type { Response } from 'express';
import { CandidateIdPipe } from '../step-engine/candidates/candidates.controller.js';
import { ApproveService } from './approval/approve.service.js';
import { IDEMPOTENCY_KEY_HEADER } from './approval/idempotency.js';
import {
  RegistrationAcceptedDto,
  RegistrationCreateRequestDto,
  RegistrationDetailDto,
  RegistrationResultCheckDto,
  RegistrationSummaryPageDto,
} from './dto/registration.dto.js';
import { RegistrationQueryService } from './registration-query.service.js';
import {
  parseRegistrationId,
  ResultCheckService,
  type RegistrationResultCheckView,
} from './result-check/result-check.service.js';

/** 경로 registrationId: 1 이상 int4 정수가 아니면 404 REGISTRATION_NOT_FOUND */
export class RegistrationIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    return parseRegistrationId(value);
  }
}

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;

/** 202 Location: 등록 기록 조회 경로(API_PREFIX 'api/v1' 포함) */
export function registrationLocation(registrationId: number): string {
  return `/api/v1/registrations/${registrationId}`;
}

/**
 * ⑨ 등록(05-2 태그 registration, P4-03): G4 최종 승인·등록(`createCandidateRegistration` — ⑨로 가는 유일한 길), 등록 기록 이력·상세,
 * 결과확인필요 조회(`checkRegistrationResult`). 차단 스위치는 `RegistrationSwitchController`.
 */
@ApiTags('registration')
@Controller()
export class RegistrationController {
  constructor(
    private readonly approvals: ApproveService,
    private readonly queries: RegistrationQueryService,
    private readonly checks: ResultCheckService,
  ) {}

  @Post('candidates/:candidateId/registrations')
  @HttpCode(202)
  @ApiOperation({ operationId: 'createCandidateRegistration', summary: 'G4 최종 승인·등록' })
  @ApiHeader(CLIENT_HEADER)
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '같은 요청을 다시 보내도 한 번만 처리한다(UUID)',
  })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiBody({ type: RegistrationCreateRequestDto })
  @ApiAcceptedResponse({ type: RegistrationAcceptedDto, description: '승인을 받았다(Location)' })
  @ApiBadRequestResponse({ description: 'IDEMPOTENCY_KEY_REQUIRED, MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'REGISTRATION_IN_PROGRESS, CANDIDATE_STATUS_INVALID, VERSION_NOT_CURRENT, GATE_NOT_PASSED, JUDGEMENT_EXPIRED, DUPLICATE_REGISTRATION',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'PRE_VALIDATION_FAILED(details.checks[]), IDEMPOTENCY_KEY_REUSED, VALIDATION_FAILED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async create(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Headers(IDEMPOTENCY_KEY_HEADER) key: unknown,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RegistrationAcceptedDto> {
    const accepted = await this.approvals.approve(candidateId, key, body);
    res.setHeader('Location', registrationLocation(accepted.registrationId));
    return accepted;
  }

  @Get('candidates/:candidateId/registrations')
  @ApiOperation({ operationId: 'listCandidateRegistrations', summary: '후보의 등록 기록 이력' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({ name: 'page', required: false, type: 'integer' })
  @ApiQuery({ name: 'size', required: false, type: 'integer' })
  @ApiQuery({ name: 'sort', required: false, type: [String] })
  @ApiOkResponse({ type: RegistrationSummaryPageDto })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<RegistrationSummaryPageDto> {
    return this.queries.list(candidateId, query);
  }

  @Get('registrations/:registrationId')
  @ApiOperation({ operationId: 'getRegistration', summary: '등록 기록 상세' })
  @ApiParam({ name: 'registrationId', type: 'integer', required: true })
  @ApiOkResponse({ type: RegistrationDetailDto })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'REGISTRATION_NOT_FOUND' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('registrationId', RegistrationIdPipe) registrationId: number,
  ): Promise<RegistrationDetailDto> {
    return this.queries.get(registrationId);
  }

  @Post('registrations/:registrationId/result-checks')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'checkRegistrationResult',
    summary: '결과확인필요 등록을 판매자관리코드로 조회',
  })
  @ApiHeader(CLIENT_HEADER)
  @ApiParam({ name: 'registrationId', type: 'integer', required: true })
  @ApiOkResponse({ type: RegistrationResultCheckDto })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'REGISTRATION_NOT_FOUND' })
  @ApiConflictResponse({ description: 'REGISTRATION_STATUS_INVALID, SECRET_NOT_CONFIGURED' })
  @ApiBadGatewayResponse({ description: 'EXTERNAL_API_ERROR, COMMERCE_AUTH_FAILED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  check(
    @Param('registrationId', RegistrationIdPipe) registrationId: number,
  ): Promise<RegistrationResultCheckView> {
    return this.checks.check(registrationId);
  }
}
