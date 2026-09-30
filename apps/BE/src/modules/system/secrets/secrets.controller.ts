import { Body, Controller, Get, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { SecretStatusListDto, SecretValueRequestDto } from './secret.dto.js';
import { SecretsService } from './secrets.service.js';

@ApiTags('system')
@Controller('secrets')
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Get()
  @ApiOperation({ operationId: 'listSecrets', summary: '비밀정보 저장 여부 목록 조회' })
  @ApiOkResponse({ type: SecretStatusListDto, description: '키별 저장 여부' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiServiceUnavailableResponse({ description: 'KEYCHAIN_UNAVAILABLE — 키체인을 열 수 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(): Promise<SecretStatusListDto> {
    return this.secrets.list();
  }

  @Put(':secretKey')
  @HttpCode(204)
  @ApiOperation({ operationId: 'saveSecret', summary: '비밀정보 입력·교체' })
  @ApiParam({
    name: 'secretKey',
    description: '비밀 키 이름. 허용 목록(SecretKey) 밖이면 404 SECRET_KEY_UNKNOWN',
    schema: { type: 'string', pattern: '^[A-Z][A-Z0-9_]*$', maxLength: 64 },
  })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiNoContentResponse({ description: '저장했다(값을 돌려주지 않는다)' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'SECRET_KEY_UNKNOWN' })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED — 빈 값·길이 초과(rejectedValue를 담지 않는다)',
  })
  @ApiServiceUnavailableResponse({ description: 'KEYCHAIN_UNAVAILABLE — 키체인에 쓸 수 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async save(
    @Param('secretKey') secretKey: string,
    @Body() body: SecretValueRequestDto,
  ): Promise<void> {
    await this.secrets.save(secretKey, body.value);
  }
}
