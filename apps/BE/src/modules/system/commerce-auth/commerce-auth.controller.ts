import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CommerceAuthStatusDto } from './commerce-auth-status.dto.js';
import { CommerceAuthStatusService } from './commerce-auth-status.service.js';

@ApiTags('system')
@Controller()
export class CommerceAuthController {
  constructor(private readonly status: CommerceAuthStatusService) {}

  @Get('auth-status')
  @ApiOperation({ operationId: 'getAuthStatus', summary: '커머스API 토큰·인증 상태 조회' })
  @ApiOkResponse({ type: CommerceAuthStatusDto, description: '커머스API 인증 상태' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  getAuthStatus(): Promise<CommerceAuthStatusDto> {
    return this.status.getStatus();
  }

  @Post('auth-checks')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'createAuthCheck',
    summary: '커머스API 토큰 다시 받기(인증 점검)',
  })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({
    type: CommerceAuthStatusDto,
    description: '토큰을 새로 받았다 — 갱신된 인증 상태',
  })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiConflictResponse({ description: 'SECRET_NOT_CONFIGURED — 커머스 키 없음' })
  @ApiBadGatewayResponse({
    description: 'COMMERCE_AUTH_FAILED(details.causeCategory) · EXTERNAL_API_ERROR',
  })
  @ApiServiceUnavailableResponse({ description: 'KEYCHAIN_UNAVAILABLE — 키체인을 열 수 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  createAuthCheck(): Promise<CommerceAuthStatusDto> {
    return this.status.check();
  }
}
