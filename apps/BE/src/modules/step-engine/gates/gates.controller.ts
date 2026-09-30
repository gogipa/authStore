import { Body, Controller, Get, Param, type PipeTransform, Post, Res } from '@nestjs/common';
import {
  ApiBody,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CandidateIdPipe } from '../candidates/candidates.controller.js';
import type { GateCode } from '../domain/steps.js';
import { CandidateGateListDto, GatePassRequestDto, GatePassResultDto } from '../dto/gate.dto.js';
import { GateService, parseGateCode } from './gate.service.js';

/** 경로 gateCode: G2·G3만. 그 밖(G1·G4 포함)은 422 INVALID_GATE_CODE */
export class GateCodePipe implements PipeTransform<unknown, GateCode> {
  transform(value: unknown): GateCode {
    return parseGateCode(value);
  }
}

/** 게이트 상태 조회 경로(201 Location) */
export function gatesLocation(candidateId: number): string {
  return `/api/v1/candidates/${candidateId}/gates`;
}

const CANDIDATE_ID_PARAM = { name: 'candidateId', type: 'integer', required: true } as const;

/**
 * 게이트 통과·상태(05-2 passCandidateGate·listCandidateGates, P1-06). 통과는 로컬 보안 가드(Host·Origin·
 * X-AutoStore-Client)를 거친 웹 화면 요청으로만 기록한다(규칙 12).
 */
@ApiTags('step-engine')
@Controller('candidates/:candidateId/gates')
export class GatesController {
  constructor(private readonly gates: GateService) {}

  @Post(':gateCode/pass')
  @ApiOperation({ operationId: 'passCandidateGate', summary: 'G2·G3 통과 기록' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiParam({ name: 'gateCode', required: true, enum: ['G2', 'G3'] })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiBody({ type: GatePassRequestDto })
  @ApiCreatedResponse({
    type: GatePassResultDto,
    description: '통과를 기록했다. Location: /api/v1/candidates/{candidateId}/gates',
  })
  @ApiOkResponse({ type: GatePassResultDto, description: '지문이 최신 통과와 같아 기존 기록' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND · (G3) IMAGE_ASSET_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'VERSION_NOT_CURRENT · STEP_NOT_COMPLETED · NOT_SALE_CANDIDATE · NO_COMPARISON_NOT_CONFIRMED · CANDIDATE_LOCKED · CANDIDATE_EXCLUDED · STEP_LOCKED_BY_RUNNING_STEP · (G3) ALREADY_IN_PROGRESS',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'INVALID_GATE_CODE · VALIDATION_FAILED · (G3) CHECKLIST_INCOMPLETE · IMAGE_COUNT_INVALID · IMAGE_NOT_ALLOWED · SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED',
  })
  async pass(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Param('gateCode', GateCodePipe) gate: GateCode,
    @Body() body: GatePassRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<GatePassResultDto> {
    const { created, result } = await this.gates.pass(candidateId, gate, { ...(body ?? {}) });
    if (created) {
      res.status(201).setHeader('Location', gatesLocation(candidateId));
    } else {
      res.status(200);
    }
    return result;
  }

  @Get()
  @ApiOperation({ operationId: 'listCandidateGates', summary: '게이트 상태(G1~G4)' })
  @ApiParam(CANDIDATE_ID_PARAM)
  @ApiOkResponse({ type: CandidateGateListDto })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  list(@Param('candidateId', CandidateIdPipe) candidateId: number): Promise<CandidateGateListDto> {
    return this.gates.list(candidateId);
  }
}
