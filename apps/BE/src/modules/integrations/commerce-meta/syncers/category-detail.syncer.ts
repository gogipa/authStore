import { COMMERCE_META_PATHS } from '../commerce-meta.constants.js';
import { type CategoryDetail, mapCategoryDetail } from '../mappers/category-detail.mapper.js';
import { upsertMetaDocument } from './cache-writes.js';
import { type MetaTargetSyncer, requireShoeLeaves } from './meta-target-syncer.js';

/**
 * CATEGORY_DETAIL: 성별 신발 리프마다 `GET /v1/categories/{id}` → commerce_meta_document(kind CATEGORY_DETAIL,
 * scope = categoryId) + commerce_category.exceptional_categories·detail_synced_at.
 */
export const categoryDetailSyncer: MetaTargetSyncer<CategoryDetail[]> = {
  target: 'CATEGORY_DETAIL',
  async fetch(ctx) {
    const details: CategoryDetail[] = [];
    for (const categoryId of await requireShoeLeaves(ctx)) {
      const data = await ctx.api.get(COMMERCE_META_PATHS.categoryDetail(categoryId));
      details.push(mapCategoryDetail(categoryId, data));
    }
    return details;
  },
  async apply(tx, details, now) {
    for (const detail of details) {
      await upsertMetaDocument(tx, detail.document, now);
      await tx.commerceCategory.updateMany({
        where: { categoryId: detail.categoryId },
        data: { exceptionalCategories: detail.exceptionalCategories, detailSyncedAt: now },
      });
    }
    return details.length;
  },
};
