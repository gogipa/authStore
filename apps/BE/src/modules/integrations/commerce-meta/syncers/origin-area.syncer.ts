import { COMMERCE_META_PATHS, ORIGIN_SUB_EMPTY_STATUSES } from '../commerce-meta.constants.js';
import { MetaMappingError, uniqueBy } from '../mappers/mapper-utils.js';
import { mapOriginAreas, type OriginAreaRow } from '../mappers/origin-area.mapper.js';
import { syncKeyedRows } from './cache-writes.js';
import type { MetaTargetSyncer } from './meta-target-syncer.js';

/**
 * ORIGIN_AREA: `GET /v1/product-origin-areas`(맨 위 코드) + 코드마다 `…/sub-origin-areas?code=`(하위 한 단계,
 * Proposed — 계층 깊이는 M0 S3 전 추정) → commerce_origin_area(자연키 origin_area_code, parent_code = 상위 코드).
 * 하위 목록이 400·404면 '하위 없음'으로 본다. 맨 위 목록이 비면 오류(캐시를 지우지 않게).
 */
export const originAreaSyncer: MetaTargetSyncer<OriginAreaRow[]> = {
  target: 'ORIGIN_AREA',
  async fetch({ api }) {
    const top = mapOriginAreas(await api.get(COMMERCE_META_PATHS.ORIGIN_AREAS), null);
    if (top.length === 0) throw new MetaMappingError('원산지 코드 응답이 비어 있습니다.');
    const rows: OriginAreaRow[] = [...top];
    for (const parent of top) {
      const sub = await api.get(
        COMMERCE_META_PATHS.ORIGIN_SUB_AREAS,
        { code: parent.originAreaCode },
        { emptyStatuses: ORIGIN_SUB_EMPTY_STATUSES },
      );
      if (sub === null) continue;
      rows.push(...mapOriginAreas(sub, parent.originAreaCode));
    }
    return uniqueBy(rows, (r) => r.originAreaCode);
  },
  async apply(tx, rows, now) {
    await syncKeyedRows(tx.commerceOriginArea, 'originAreaCode', ['name', 'parentCode'], rows, now);
    return rows.length;
  },
};
