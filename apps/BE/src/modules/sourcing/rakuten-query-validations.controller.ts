import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RakutenQueryValidationDto, RakutenQueryValidationRequestDto } from './dto/rakuten.dto.js';
import { RakutenItemsService } from './rakuten-items.service.js';

/** 라쿠텐 검색어 형식 검사(05-2 validateRakutenQuery, F-SO-01·02). 저장 없는 계산 — 규칙 위반도 200 valid=false */
@ApiTags('sourcing')
@Controller('rakuten-query-validations')
export class RakutenQueryValidationsController {
  constructor(private readonly items: RakutenItemsService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({ operationId: 'validateRakutenQuery', summary: '라쿠텐 검색어 형식 검사' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: RakutenQueryValidationDto, description: '검사 결과' })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_FAILED — rakutenQuery 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiResponse({ status: 503, description: 'SETTINGS_INVALID — 설정 스냅샷 없음' })
  validate(@Body() body: RakutenQueryValidationRequestDto): RakutenQueryValidationDto {
    return this.items.validateQuery(body.rakutenQuery);
  }
}
