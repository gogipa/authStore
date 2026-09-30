import { COMMERCE_META_PATHS } from '../commerce-meta.constants.js';
import type { MetaDocument } from '../mappers/meta-document.js';
import { mapProvidedNotice } from '../mappers/provided-notice.mapper.js';
import { upsertMetaDocument } from './cache-writes.js';
import type { MetaTargetSyncer } from './meta-target-syncer.js';

/** PROVIDED_NOTICE: `GET /v1/products-for-provided-notice/SHOES` → 문서(scope 'SHOES'). 건수는 문서 1개 */
export const providedNoticeSyncer: MetaTargetSyncer<MetaDocument> = {
  target: 'PROVIDED_NOTICE',
  async fetch({ api }) {
    return mapProvidedNotice(await api.get(COMMERCE_META_PATHS.PROVIDED_NOTICE));
  },
  async apply(tx, doc, now) {
    await upsertMetaDocument(tx, doc, now);
    return 1;
  },
};
