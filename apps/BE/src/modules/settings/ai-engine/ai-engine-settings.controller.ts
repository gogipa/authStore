import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { AiEngineSettingsDto, AiEngineSettingsUpdateRequestDto } from './ai-engine-settings.dto.js';
import { AiEngineSettingsService } from './ai-engine-settings.service.js';

/** AI 엔진 설정(05-2 getAiEngineSettings·updateAiEngineSettings, SCR-13, D-16) */
@ApiTags('settings')
@Controller('settings/ai-engine')
export class AiEngineSettingsController {
  constructor(private readonly service: AiEngineSettingsService) {}

  @Get()
  @ApiOperation({ operationId: 'getAiEngineSettings', summary: 'AI 엔진 설정 조회' })
  @ApiOkResponse({ type: AiEngineSettingsDto, description: 'AI 엔진 설정' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID — 로드된 설정 스냅샷이 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(): Promise<AiEngineSettingsDto> {
    return this.service.get();
  }

  @Put()
  @ApiOperation({ operationId: 'updateAiEngineSettings', summary: 'AI 엔진 선택·모델 저장' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({
    type: AiEngineSettingsDto,
    description: '저장한 뒤의 AI 엔진 설정(같은 값이면 현재 설정)',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiConflictResponse({
    description:
      'AI_ENGINE_NOT_VERIFIED — 선택 엔진·텍스트 모델로 10분 안에 통과한 연결 테스트가 없음(details.engineCode·model)',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'AI_MODEL_INVALID(fieldErrors에 models.{엔진}.text|vision) · VALIDATION_FAILED · SETTINGS_SCHEMA_INVALID(설정 파일이 JSON이 아님, Proposed)',
  })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID — 로드된 설정 스냅샷이 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  update(@Body() body: AiEngineSettingsUpdateRequestDto): Promise<AiEngineSettingsDto> {
    return this.service.update({ selectedEngine: body.selectedEngine, models: body.models });
  }
}
