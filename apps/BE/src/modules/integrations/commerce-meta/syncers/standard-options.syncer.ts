import { COMMERCE_META_PATHS } from '../commerce-meta.constants.js';
import type { MetaDocument } from '../mappers/meta-document.js';
import { mapStandardOptions } from '../mappers/standard-options.mapper.js';
import { upsertMetaDocument } from './cache-writes.js';
import { type MetaTargetSyncer, requireShoeLeaves } from './meta-target-syncer.js';

/** STANDARD_OPTIONS: 성별 신발 리프마다 `GET /v1/options/standard-options?categoryId=` → 문서(scope = categoryId) */
export const standardOptionsSyncer: MetaTargetSyncer<MetaDocument[]> = {
  target: 'STANDARD_OPTIONS',
  async fetch(ctx) {
    const docs: MetaDocument[] = [];
    for (const categoryId of await requireShoeLeaves(ctx)) {
      const data = await ctx.api.get(COMMERCE_META_PATHS.STANDARD_OPTIONS, { categoryId });
      docs.push(mapStandardOptions(categoryId, data));
    }
    return docs;
  },
  async apply(tx, docs, now) {
    for (const doc of docs) await upsertMetaDocument(tx, doc, now);
    return docs.length;
  },
};
