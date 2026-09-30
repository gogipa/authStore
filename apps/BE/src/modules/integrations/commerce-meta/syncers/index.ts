import type { MetaSyncTarget } from '../commerce-meta.constants.js';
import { addressbookSyncer } from './addressbook.syncer.js';
import { categoryDetailSyncer } from './category-detail.syncer.js';
import { categorySyncer } from './category.syncer.js';
import type { MetaTargetSyncer } from './meta-target-syncer.js';
import { originAreaSyncer } from './origin-area.syncer.js';
import { productAttributesSyncer } from './product-attributes.syncer.js';
import { providedNoticeSyncer } from './provided-notice.syncer.js';
import { returnDeliveryCompanySyncer } from './return-delivery-company.syncer.js';
import { standardOptionsSyncer } from './standard-options.syncer.js';

/** 대상 → 동기화기(8개). 서비스가 META_SYNC_TARGETS 순서로 부른다 */
export const META_TARGET_SYNCERS: Readonly<Record<MetaSyncTarget, MetaTargetSyncer<unknown>>> = {
  CATEGORY: categorySyncer,
  CATEGORY_DETAIL: categoryDetailSyncer,
  STANDARD_OPTIONS: standardOptionsSyncer,
  PRODUCT_ATTRIBUTES: productAttributesSyncer,
  ORIGIN_AREA: originAreaSyncer,
  ADDRESSBOOK: addressbookSyncer,
  PROVIDED_NOTICE: providedNoticeSyncer,
  RETURN_DELIVERY_COMPANY: returnDeliveryCompanySyncer,
};

export type { MetaFetchContext, MetaLeafSource, MetaTargetSyncer } from './meta-target-syncer.js';
