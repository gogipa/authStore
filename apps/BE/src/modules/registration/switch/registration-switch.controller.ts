import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  RegistrationSwitchChangedDto,
  RegistrationSwitchStateDto,
  RegistrationSwitchUpdateRequestDto,
} from '../dto/registration.dto.js';
import { RegistrationSwitchService } from './registration-switch.service.js';

/** 등록 API 차단 스위치(05-2 `getRegistrationSwitch`·`putRegistrationSwitch`, P4-03 규칙 12) */
@ApiTags('registration')
@Controller('registration-switch')
export class RegistrationSwitchController {
  constructor(private readonly switches: RegistrationSwitchService) {}

  @Get()
  @ApiOperation({ operationId: 'getRegistrationSwitch', summary: '등록 API 차단 스위치 상태' })
  @ApiOkResponse({ type: RegistrationSwitchStateDto })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(): Promise<RegistrationSwitchStateDto> {
    return this.switches.get();
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({ operationId: 'putRegistrationSwitch', summary: '등록 API 차단 스위치 켜기/끄기' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: RegistrationSwitchChangedDto })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_FAILED' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  put(@Body() body: RegistrationSwitchUpdateRequestDto): Promise<RegistrationSwitchChangedDto> {
    return this.switches.put(body.apiBlocked);
  }
}
