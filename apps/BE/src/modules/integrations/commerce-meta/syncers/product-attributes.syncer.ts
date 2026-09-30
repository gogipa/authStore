import { COMMERCE_META_PATHS } from '../commerce-meta.constants.js';
import type { MetaDocument } from '../mappers/meta-document.js';
import { mapProductAttributes } from '../mappers/product-attributes.mapper.js';
import { upsertMetaDocument } from './cache-writes.js';
import { type MetaTargetSyncer, requireShoeLeaves } from './meta-target-syncer.js';

/**
 * PRODUCT_ATTRIBUTES: 성별 신발 리프마다 `…/attributes?categoryId=`와 `…/attribute-values?categoryId=`(R04 C5)를 받아
 * 한 문서(scope = categoryId, payload `{ attributes, attributeValues }`)로 둔다.
 */
export const productAttributesSyncer: MetaTargetSyncer<MetaDocument[]> = {
  target: 'PRODUCT_ATTRIBUTES',
  async fetch(ctx) {
    const docs: MetaDocument[] = [];
    for (const categoryId of await requireShoeLeaves(ctx)) {
      const attributes = await ctx.api.get(COMMERCE_META_PATHS.PRODUCT_ATTRIBUTES, { categoryId });
      const values = await ctx.api.get(COMMERCE_META_PATHS.PRODUCT_ATTRIBUTE_VALUES, {
        categoryId,
      });
      docs.push(mapProductAttributes(categoryId, attributes, values));
    }
    return docs;
  },
  async apply(tx, docs, now) {
    for (const doc of docs) await upsertMetaDocument(tx, doc, now);
    return docs.length;
  },
};
