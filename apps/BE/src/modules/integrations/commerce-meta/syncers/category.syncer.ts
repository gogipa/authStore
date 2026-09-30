import { COMMERCE_META_PATHS } from '../commerce-meta.constants.js';
import { type CategoryRow, mapCategories } from '../mappers/category.mapper.js';
import { syncKeyedRows } from './cache-writes.js';
import type { MetaTargetSyncer } from './meta-target-syncer.js';

/** CATEGORY: `GET /v1/categories?last=true` → commerce_category(리프 전체, 자연키 category_id) */
export const categorySyncer: MetaTargetSyncer<CategoryRow[]> = {
  target: 'CATEGORY',
  async fetch({ api }) {
    return mapCategories(await api.get(COMMERCE_META_PATHS.CATEGORIES, { last: true }));
  },
  async apply(tx, rows, now) {
    await syncKeyedRows(
      tx.commerceCategory,
      'categoryId',
      ['name', 'wholeCategoryName'],
      rows,
      now,
    );
    return rows.length;
  },
};
