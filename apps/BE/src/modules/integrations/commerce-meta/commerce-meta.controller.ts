import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CommerceMetaQueryService } from './commerce-meta-query.service.js';
import {
  CommerceAddressbookEntryPageDto,
  CommerceCategoryEntryPageDto,
  CommerceOriginAreaEntryPageDto,
  CommerceReturnDeliveryCompanyEntryPageDto,
  ListCommerceAddressbooksQueryDto,
  ListCommerceCategoriesQueryDto,
  ListCommerceOriginAreasQueryDto,
  ListCommerceReturnDeliveryCompaniesQueryDto,
} from './dto/commerce-meta-cache.dto.js';

const FORBIDDEN = { description: '로컬 보안 검사 실패(Host)' } as const;
const INTERNAL = { status: 500, description: 'INTERNAL_ERROR' } as const;

/** 커머스API 메타 캐시 목록(05-2 태그 integrations, P1-08 규칙 11~14). 읽기만 한다 */
@ApiTags('integrations')
@Controller()
export class CommerceMetaController {
  constructor(private readonly query: CommerceMetaQueryService) {}

  @Get('commerce-categories')
  @ApiOperation({
    operationId: 'listCommerceCategories',
    summary: '성별 경로 신발 리프 카테고리 목록 조회',
  })
  @ApiOkResponse({ type: CommerceCategoryEntryPageDto, description: '카테고리 한 페이지' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiConflictResponse({
    description: 'COMMERCE_META_NOT_SYNCED(details.target=CATEGORY) — 캐시가 비어 있음',
  })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_QUERY_PARAMETER — gender 없음·허용 밖 값',
  })
  @ApiResponse(INTERNAL)
  listCommerceCategories(
    @Query() query: ListCommerceCategoriesQueryDto,
  ): Promise<CommerceCategoryEntryPageDto> {
    return this.query.listCategories(query);
  }

  @Get('commerce-origin-areas')
  @ApiOperation({ operationId: 'listCommerceOriginAreas', summary: '원산지 코드 목록 조회' })
  @ApiOkResponse({ type: CommerceOriginAreaEntryPageDto, description: '원산지 코드 한 페이지' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiConflictResponse({
    description: 'COMMERCE_META_NOT_SYNCED(details.target=ORIGIN_AREA) — 캐시가 비어 있음',
  })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse(INTERNAL)
  listCommerceOriginAreas(
    @Query() query: ListCommerceOriginAreasQueryDto,
  ): Promise<CommerceOriginAreaEntryPageDto> {
    return this.query.listOriginAreas(query);
  }

  @Get('commerce-addressbooks')
  @ApiOperation({ operationId: 'listCommerceAddressbooks', summary: '스토어 주소록 캐시 조회' })
  @ApiOkResponse({ type: CommerceAddressbookEntryPageDto, description: '주소록 한 페이지' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse(INTERNAL)
  listCommerceAddressbooks(
    @Query() query: ListCommerceAddressbooksQueryDto,
  ): Promise<CommerceAddressbookEntryPageDto> {
    return this.query.listAddressbooks(query);
  }

  @Get('commerce-return-delivery-companies')
  @ApiOperation({
    operationId: 'listCommerceReturnDeliveryCompanies',
    summary: '반품 택배사 목록 캐시 조회',
  })
  @ApiOkResponse({
    type: CommerceReturnDeliveryCompanyEntryPageDto,
    description: '반품 택배사 한 페이지',
  })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse(INTERNAL)
  listCommerceReturnDeliveryCompanies(
    @Query() query: ListCommerceReturnDeliveryCompaniesQueryDto,
  ): Promise<CommerceReturnDeliveryCompanyEntryPageDto> {
    return this.query.listReturnDeliveryCompanies(query);
  }
}
