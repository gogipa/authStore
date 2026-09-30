import { COMMERCE_META_PATHS } from '../commerce-meta.constants.js';
import { MetaMappingError } from '../mappers/mapper-utils.js';
import {
  mapReturnDeliveryCompanies,
  type ReturnDeliveryCompanyRow,
} from '../mappers/return-delivery-company.mapper.js';
import { syncKeyedRows } from './cache-writes.js';
import type { MetaTargetSyncer } from './meta-target-syncer.js';

/**
 * RETURN_DELIVERY_COMPANY: `GET /v2/product-delivery-info/return-delivery-companies`
 * → commerce_return_delivery_company(자연키 code). 목록이 비면 오류(프로필이 가리키는 행을 모두 '사라짐'으로 만들지 않게).
 */
export const returnDeliveryCompanySyncer: MetaTargetSyncer<ReturnDeliveryCompanyRow[]> = {
  target: 'RETURN_DELIVERY_COMPANY',
  async fetch({ api }) {
    const rows = mapReturnDeliveryCompanies(
      await api.get(COMMERCE_META_PATHS.RETURN_DELIVERY_COMPANIES),
    );
    if (rows.length === 0) throw new MetaMappingError('반품 택배사 응답이 비어 있습니다.');
    return rows;
  },
  async apply(tx, rows, now) {
    await syncKeyedRows(tx.commerceReturnDeliveryCompany, 'code', ['name'], rows, now);
    return rows.length;
  },
};
