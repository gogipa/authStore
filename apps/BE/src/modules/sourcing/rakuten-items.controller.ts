import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
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
import type { Response } from 'express';
import {
  RakutenItemFetchRequestDto,
  RakutenItemFetchResultDto,
  RakutenItemSnapshotDto,
} from './dto/rakuten.dto.js';
import { RakutenItemsService } from './rakuten-items.service.js';
import { NotFoundIdPipe } from './sourcing-ids.js';

/** 라쿠텐 URL 입구·스냅샷(05-2 fetchRakutenItem·getRakutenItem, F-SO-31·32·33·05·07·14·16) */
@ApiTags('sourcing')
@Controller('rakuten-items')
export class RakutenItemsController {
  constructor(private readonly items: RakutenItemsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'fetchRakutenItem', summary: '라쿠텐 URL 상품 페이지 한 건 읽기' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiCreatedResponse({
    type: RakutenItemFetchResultDto,
    description: '읽은 스냅샷과 입구 검사 결과. Location: /api/v1/rakuten-items/{rakutenItemId}',
  })
  @ApiResponse({ status: 400, description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiConflictResponse({
    description:
      'DAILY_LIMIT_REACHED(Retry-After) · EXTERNAL_CALL_COOLDOWN · SECRET_NOT_CONFIGURED',
  })
  @ApiUnprocessableEntityResponse({
    description: 'RAKUTEN_URL_INVALID · RAKUTEN_ITEM_CODE_UNRESOLVED(Proposed) · VALIDATION_FAILED',
  })
  @ApiBadGatewayResponse({ description: 'EXTERNAL_API_ERROR(details.target=RAKUTEN_PAGE·reason)' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiResponse({
    status: 503,
    description: 'SETTINGS_INVALID — 설정 스냅샷 없음 · KEYCHAIN_UNAVAILABLE',
  })
  async fetch(
    @Body() body: RakutenItemFetchRequestDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RakutenItemFetchResultDto> {
    const result = await this.items.fetchFromUrl(body.sourceUrl);
    res.setHeader('Location', `/api/v1/rakuten-items/${result.rakutenItem.id}`);
    return result;
  }

  @Get(':rakutenItemId')
  @ApiOperation({ operationId: 'getRakutenItem', summary: '라쿠텐 페이지 스냅샷 한 건' })
  @ApiParam({ name: 'rakutenItemId', type: 'integer', required: true })
  @ApiOkResponse({ type: RakutenItemSnapshotDto, description: '스냅샷과 SKU' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'RAKUTEN_ITEM_NOT_FOUND' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(
    @Param('rakutenItemId', new NotFoundIdPipe('RAKUTEN_ITEM_NOT_FOUND')) rakutenItemId: number,
  ): Promise<RakutenItemSnapshotDto> {
    return this.items.get(rakutenItemId);
  }
}
