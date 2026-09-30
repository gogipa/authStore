import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import {
  type PageEnvelope,
  type PageRequest,
  parsePageRequest,
  slicePage,
  toPage,
} from '../../../common/paging/page-request.js';
import type {
  CommerceAddressbook,
  CommerceCategory,
  CommerceOriginArea,
  CommerceReturnDeliveryCompany,
  Prisma,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { compareWholeCategoryName } from './category-rules.js';
import { CommerceMetaCacheService } from './commerce-meta-cache.service.js';
import type {
  CommerceAddressbookEntryDto,
  CommerceCategoryEntryDto,
  CommerceOriginAreaEntryDto,
  CommerceReturnDeliveryCompanyEntryDto,
  ListCommerceAddressbooksQueryDto,
  ListCommerceCategoriesQueryDto,
  ListCommerceOriginAreasQueryDto,
  ListCommerceReturnDeliveryCompaniesQueryDto,
} from './dto/commerce-meta-cache.dto.js';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

function notSynced(target: 'CATEGORY' | 'ORIGIN_AREA'): ApiException {
  return new ApiException('COMMERCE_META_NOT_SYNCED', {
    message: formatErrorMessage('COMMERCE_META_NOT_SYNCED', {
      '카테고리·원산지': target === 'CATEGORY' ? '카테고리' : '원산지',
    }),
    details: { target },
  });
}

/** sort → Prisma orderBy(같은 값이면 id 오름차순으로 순서를 고정한다) */
function orderByOf<F extends string>(page: PageRequest<F>): Record<string, 'asc' | 'desc'>[] {
  return [...page.sort.map((s) => ({ [s.field]: s.direction })), { id: 'asc' as const }];
}

export function toCategoryEntry(row: CommerceCategory): CommerceCategoryEntryDto {
  return {
    id: row.id,
    categoryId: row.categoryId,
    name: row.name,
    wholeCategoryName: row.wholeCategoryName,
    exceptionalCategories: [...row.exceptionalCategories],
    detailSyncedAt: isoOrNull(row.detailSyncedAt),
    syncedAt: iso(row.syncedAt),
  };
}

export function toOriginAreaEntry(row: CommerceOriginArea): CommerceOriginAreaEntryDto {
  return {
    id: row.id,
    originAreaCode: row.originAreaCode,
    name: row.name,
    parentCode: row.parentCode,
    syncedAt: iso(row.syncedAt),
  };
}

/** 주소록 응답 한 줄. 원문(raw)은 넣지 않는다(05-2) */
export function toAddressbookEntry(row: CommerceAddressbook): CommerceAddressbookEntryDto {
  return {
    id: row.id,
    addressBookNo: row.addressBookNo,
    name: row.name,
    addressType: row.addressType,
    isOverseas: row.isOverseas,
    addressSummary: row.addressSummary,
    syncedAt: iso(row.syncedAt),
    removedAt: isoOrNull(row.removedAt),
  };
}

export function toReturnDeliveryCompanyEntry(
  row: CommerceReturnDeliveryCompany,
): CommerceReturnDeliveryCompanyEntryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    syncedAt: iso(row.syncedAt),
    removedAt: isoOrNull(row.removedAt),
  };
}

/**
 * 메타 캐시 목록 API 4개(05-2 태그 integrations, P1-08 규칙 11~14). 읽기만 한다.
 * 페이징·정렬 검사는 `parsePageRequest`(허용 밖·size>100 → 422 INVALID_QUERY_PARAMETER).
 */
@Injectable()
export class CommerceMetaQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CommerceMetaCacheService,
  ) {}

  /**
   * 성별 신발 리프(규칙 11): 사라진 행·CHILD_CERTIFICATION·아동 카테고리·CON-08 제외 품목은 뺀다.
   * 캐시(사라지지 않은 카테고리)가 비면 409 COMMERCE_META_NOT_SYNCED(details.target=CATEGORY).
   */
  async listCategories(
    query: ListCommerceCategoriesQueryDto,
  ): Promise<PageEnvelope<CommerceCategoryEntryDto>> {
    const page = parsePageRequest('/commerce-categories', query);
    if ((await this.prisma.commerceCategory.count({ where: { removedAt: null } })) === 0) {
      throw notSynced('CATEGORY');
    }
    const leaves = (await this.cache.listShoeLeaves(query.gender)).filter(
      (row) => row.blockReason === null,
    );
    const desc = page.sort[0]?.direction === 'desc';
    const sorted = [...leaves].sort((a, b) =>
      desc ? compareWholeCategoryName(b, a) : compareWholeCategoryName(a, b),
    );
    const sliced = slicePage(sorted, page);
    return { content: sliced.content.map(toCategoryEntry), page: sliced.page };
  }

  /** 원산지 코드(규칙 12): q(이름·코드 부분 일치)·parentCode, 사라진 행 제외. 캐시가 비면 409(ORIGIN_AREA) */
  async listOriginAreas(
    query: ListCommerceOriginAreasQueryDto,
  ): Promise<PageEnvelope<CommerceOriginAreaEntryDto>> {
    const page = parsePageRequest('/commerce-origin-areas', query);
    if ((await this.prisma.commerceOriginArea.count({ where: { removedAt: null } })) === 0) {
      throw notSynced('ORIGIN_AREA');
    }
    const where: Prisma.CommerceOriginAreaWhereInput = { removedAt: null };
    if (query.parentCode !== undefined) where.parentCode = query.parentCode;
    if (query.q !== undefined && query.q.trim() !== '') {
      const contains = { contains: query.q.trim(), mode: 'insensitive' as const };
      where.OR = [{ name: contains }, { originAreaCode: contains }];
    }
    const [total, rows] = await Promise.all([
      this.prisma.commerceOriginArea.count({ where }),
      this.prisma.commerceOriginArea.findMany({
        where,
        orderBy: orderByOf(page),
        skip: page.skip,
        take: page.take,
      }),
    ]);
    return toPage(rows.map(toOriginAreaEntry), page, total);
  }

  /** 주소록(규칙 13): overseas 거르기, includeRemoved 기본 false. 빈 캐시는 빈 페이지 */
  async listAddressbooks(
    query: ListCommerceAddressbooksQueryDto,
  ): Promise<PageEnvelope<CommerceAddressbookEntryDto>> {
    const page = parsePageRequest('/commerce-addressbooks', query);
    const where: Prisma.CommerceAddressbookWhereInput = {};
    if (query.overseas !== undefined) where.isOverseas = query.overseas;
    if (query.includeRemoved !== true) where.removedAt = null;
    const [total, rows] = await Promise.all([
      this.prisma.commerceAddressbook.count({ where }),
      this.prisma.commerceAddressbook.findMany({
        where,
        orderBy: orderByOf(page),
        skip: page.skip,
        take: page.take,
      }),
    ]);
    return toPage(rows.map(toAddressbookEntry), page, total);
  }

  /** 반품 택배사(규칙 13): includeRemoved 기본 false. 빈 캐시는 빈 페이지 */
  async listReturnDeliveryCompanies(
    query: ListCommerceReturnDeliveryCompaniesQueryDto,
  ): Promise<PageEnvelope<CommerceReturnDeliveryCompanyEntryDto>> {
    const page = parsePageRequest('/commerce-return-delivery-companies', query);
    const where: Prisma.CommerceReturnDeliveryCompanyWhereInput = {};
    if (query.includeRemoved !== true) where.removedAt = null;
    const [total, rows] = await Promise.all([
      this.prisma.commerceReturnDeliveryCompany.count({ where }),
      this.prisma.commerceReturnDeliveryCompany.findMany({
        where,
        orderBy: orderByOf(page),
        skip: page.skip,
        take: page.take,
      }),
    ]);
    return toPage(rows.map(toReturnDeliveryCompanyEntry), page, total);
  }
}
