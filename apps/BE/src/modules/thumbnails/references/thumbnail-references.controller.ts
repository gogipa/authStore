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
import {
  ThumbnailReferencesRequestDto,
  ThumbnailReferencesResultDto,
} from '../dto/thumbnail-references.dto.js';
import { ThumbnailReferencesService } from './thumbnail-references.service.js';

/** 레퍼런스 컷 고르기와 '사람·얼굴 없음' 확인(05-2 putThumbnailReferences, 태그 thumbnails, P3-01) */
@ApiTags('thumbnails')
@Controller()
export class ThumbnailReferencesController {
  constructor(private readonly references: ThumbnailReferencesService) {}

  @Put('step-runs/:stepRunId/thumbnail-references')
  @ApiOperation({
    operationId: 'putThumbnailReferences',
    summary: "레퍼런스 컷 고르기와 '사람·얼굴 없음' 확인",
  })
  @ApiParam({ name: 'stepRunId', type: 'integer', required: true })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: ThumbnailReferencesResultDto, description: '저장한 레퍼런스' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'STEP_RUN_NOT_FOUND, IMAGE_ASSET_NOT_FOUND' })
  @ApiConflictResponse({
    description:
      'STEP_RUN_NOT_WAITING_INPUT, ALREADY_IN_PROGRESS(details.job=GENERATION), CANDIDATE_LOCKED, CANDIDATE_EXCLUDED',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'NO_PERSON_CONFIRMATION_REQUIRED, IMAGE_COUNT_INVALID(1~3장), IMAGE_NOT_ALLOWED, INVALID_STEP_CODE, VALIDATION_FAILED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  put(
    @Param('stepRunId', StepRunIdPipe) stepRunId: number,
    @Body() body: ThumbnailReferencesRequestDto,
  ): Promise<ThumbnailReferencesResultDto> {
    return this.references.put(stepRunId, body);
  }
}
