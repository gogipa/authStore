import { Injectable } from '@nestjs/common';
import type {
  CommerceAddressbook,
  CommerceCategory,
  CommerceMetaDocument,
  CommerceOriginArea,
  CommerceReturnDeliveryCompany,
} from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { categoryBlockReason, compareWholeCategoryName } from './category-rules.js';
import {
  type CategoryBlockReason,
  GENDER_PATH_PREFIX,
  type MetaDocumentKind,
  type ShoeGender,
} from './commerce-meta.constants.js';
import type { MetaLeafSource } from './syncers/meta-target-syncer.js';

/** 캐시 카테고리 + 고를 수 없는 이유(없으면 null) */
export type CommerceCategoryView = CommerceCategory & { blockReason: CategoryBlockReason | null };

/** 문서형 캐시 한 행(payload는 응답 원문) */
export type CommerceMetaDocumentView = Pick<
  CommerceMetaDocument,
  'kind' | 'scopeKey' | 'payload' | 'payloadSha256' | 'syncedAt'
>;

function withBlockReason(row: CommerceCategory): CommerceCategoryView {
  return { ...row, blockReason: categoryBlockReason(row) };
}

/**
 * 커머스API 메타 캐시 읽기(P1-08). 다른 모듈(P1-09 프로필, P2-06 ④ 카테고리, P3-04 ⑥-3, P4-02·P4-03 ⑧⑨)은
 * 이 서비스로만 읽고, 캐시 표에 직접 쓰지 않는다(쓰기는 동기화기만). 함수 이름은 바꾸지 않는다.
 * 카테고리·원산지 ID는 코드·설정에 박지 않고 여기서 찾는다(RG-03).
 */
@Injectable()
export class CommerceMetaCacheService implements MetaLeafSource {
  constructor(private readonly prisma: PrismaService) {}

  /** 리프 카테고리 하나(사라진 행도 준다 — `removedAt`으로 판단). 없으면 null */
  async findCategory(categoryId: string): Promise<CommerceCategoryView | null> {
    const row = await this.prisma.commerceCategory.findUnique({ where: { categoryId } });
    return row ? withBlockReason(row) : null;
  }

  /** 여러 리프 카테고리(사라진 행도 준다 — `removedAt`으로 판단). 없는 id는 빠진다. 전체 경로 순(P2-06 ④ 매핑 후보) */
  async findCategories(categoryIds: readonly string[]): Promise<CommerceCategoryView[]> {
    if (categoryIds.length === 0) return [];
    const rows = await this.prisma.commerceCategory.findMany({
      where: { categoryId: { in: [...new Set(categoryIds)] } },
    });
    return rows.map(withBlockReason).sort(compareWholeCategoryName);
  }

  /**
   * 사라지지 않은 카테고리가 하나라도 있는가(P2-06 ④ 시작 조건 — 비었으면 409 COMMERCE_META_NOT_SYNCED(details.target=CATEGORY),
   * `listCommerceCategories`와 같은 기준)
   */
  async hasActiveCategories(): Promise<boolean> {
    const row = await this.prisma.commerceCategory.findFirst({
      where: { removedAt: null },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * 성별 신발 경로(`패션잡화>남성신발>`·`패션잡화>여성신발>`)의 리프(사라진 행 제외), 전체 경로 순.
   * 아동·CON-08 제외 품목도 `blockReason`과 함께 준다. 고를 수 있는 것만 보려면 `blockReason === null`.
   */
  async listShoeLeaves(gender: ShoeGender): Promise<CommerceCategoryView[]> {
    const rows = await this.prisma.commerceCategory.findMany({
      where: { removedAt: null, wholeCategoryName: { startsWith: GENDER_PATH_PREFIX[gender] } },
    });
    return rows.map(withBlockReason).sort(compareWholeCategoryName);
  }

  /** 문서형 캐시(kind, scope_key). 카테고리 종류는 scope = categoryId, 고시는 'SHOES'. 없으면 null */
  async getDocument(
    kind: MetaDocumentKind,
    scopeKey: string,
  ): Promise<CommerceMetaDocumentView | null> {
    return this.prisma.commerceMetaDocument.findUnique({
      where: { kind_scopeKey: { kind, scopeKey } },
      select: { kind: true, scopeKey: true, payload: true, payloadSha256: true, syncedAt: true },
    });
  }

  /** 원산지 코드 하나(사라진 행도 준다). 없으면 null */
  findOriginArea(originAreaCode: string): Promise<CommerceOriginArea | null> {
    return this.prisma.commerceOriginArea.findUnique({ where: { originAreaCode } });
  }

  /** 주소록 한 행(DB id, 프로필 FK). 사라진 행도 준다. 없으면 null */
  findAddressbook(id: number): Promise<CommerceAddressbook | null> {
    return this.prisma.commerceAddressbook.findUnique({ where: { id } });
  }

  /** 반품 택배사 한 행(DB id, 프로필 FK). 사라진 행도 준다. 없으면 null */
  findReturnDeliveryCompany(id: number): Promise<CommerceReturnDeliveryCompany | null> {
    return this.prisma.commerceReturnDeliveryCompany.findUnique({ where: { id } });
  }

  /** 동기화기용: 두 성별 신발 경로의 리프 category_id(사라진 행 제외, 아동·제외 품목 포함) */
  async shoeLeafCategoryIds(): Promise<string[]> {
    const rows = await this.prisma.commerceCategory.findMany({
      where: {
        removedAt: null,
        OR: Object.values(GENDER_PATH_PREFIX).map((prefix) => ({
          wholeCategoryName: { startsWith: prefix },
        })),
      },
      select: { id: true, categoryId: true, wholeCategoryName: true },
    });
    return rows.sort(compareWholeCategoryName).map((row) => row.categoryId);
  }
}
