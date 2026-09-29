import { Controller, Get, Post, Res } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { SettingsReloadResultDto } from './dto/settings-reload-result.dto.js';
import { SettingsViewDto } from './dto/settings-view.dto.js';
import { SettingsService } from './settings.service.js';

/** 201 Location: 현재 설정 조회 경로(05-2 createSettingsSnapshot, 앞머리 API_PREFIX 'api/v1' 포함) */
export const SETTINGS_LOCATION = '/api/v1/settings';

@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('settings')
  @ApiOperation({
    operationId: 'getSettings',
    summary: '현재 설정과 설정 파일 검사 결과 조회',
  })
  @ApiOkResponse({ type: SettingsViewDto, description: '현재 설정' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiServiceUnavailableResponse({
    description:
      'SETTINGS_INVALID — 시작 검증 실패로 로드된 설정 스냅샷이 없음(fieldErrors에 검사 오류)',
  })
  getSettings(): Promise<SettingsViewDto> {
    return this.settings.getView();
  }

  @Post('settings-snapshots')
  @ApiOperation({
    operationId: 'createSettingsSnapshot',
    summary: '설정 파일 다시 읽기·검사',
  })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: SettingsReloadResultDto, description: '같은 파일 — 기존 스냅샷' })
  @ApiCreatedResponse({
    type: SettingsReloadResultDto,
    description: '새 스냅샷을 만들었다(Location: /api/v1/settings)',
  })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiUnprocessableEntityResponse({
    description:
      'SETTINGS_SCHEMA_INVALID(fieldErrors에 JSON 경로) · SAFETY_SETTING_RELAXATION_REJECTED',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async createSettingsSnapshot(
    @Res({ passthrough: true }) res: Response,
  ): Promise<SettingsReloadResultDto> {
    const { created, result } = await this.settings.reload();
    if (created) {
      res.status(201).setHeader('Location', SETTINGS_LOCATION);
    } else {
      res.status(200);
    }
    return result;
  }
}
