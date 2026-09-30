import { Body, Controller, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import { StepRunIdPipe } from '../../step-engine/step-runs.controller.js';
import { ContentFieldInputRequestDto, ContentFieldInputResultDto } from '../dto/content.dto.js';
import { ContentFieldsService } from './content-fields.service.js';

/** 열린 ⑥-2 실행에 필드 오너 입력(05-2 putContentFieldInput, 태그 content, P3-03) */
@ApiTags('content')
@Controller()
export class ContentFieldsController {
  constructor(private readonly fields: ContentFieldsService) {}

  @Put('step-runs/:stepRunId/content-fields/:fieldKey')
  @ApiOperation({ operationId: 'putContentFieldInput', summary: '열린 ⑥-2 실행에 필드 오너 입력' })
  @ApiParam({ name: 'stepRunId', type: 'integer', required: true })
  @ApiParam({ name: 'fieldKey', type: 'string', required: true, description: '예 fact.origin' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: ContentFieldInputResultDto, description: '저장한 필드와 단계 상태' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'STEP_RUN_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'STEP_RUN_NOT_WAITING_INPUT, CANDIDATE_LOCKED, CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'FIELD_NOT_EDITABLE, EVIDENCE_URL_REQUIRED, ORIGIN_COUNTRY_UNKNOWN, INVALID_STEP_CODE(⑥-2 실행이 아님), VALIDATION_FAILED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  put(
    @Param('stepRunId', StepRunIdPipe) stepRunId: number,
    @Param('fieldKey') fieldKey: string,
    @Body() body: ContentFieldInputRequestDto,
  ): Promise<ContentFieldInputResultDto> {
    return this.fields.put(stepRunId, fieldKey, body);
  }
}
