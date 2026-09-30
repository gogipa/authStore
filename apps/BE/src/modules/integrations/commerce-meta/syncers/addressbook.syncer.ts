import { MetaFetchError } from '../commerce-meta-api.js';
import {
  ADDRESSBOOK_MAX_PAGES,
  ADDRESSBOOK_PAGE_SIZE,
  COMMERCE_META_PATHS,
} from '../commerce-meta.constants.js';
import { type AddressbookRow, mapAddressbookPage } from '../mappers/addressbook.mapper.js';
import { MetaMappingError, uniqueBy } from '../mappers/mapper-utils.js';
import { syncKeyedRows } from './cache-writes.js';
import type { MetaTargetSyncer } from './meta-target-syncer.js';

/** 주소록 403 안내(R04 A3: '판매자정보' API 그룹 권한이 있어야 읽을 수 있다) */
export function addressbookForbiddenMessage(error: MetaFetchError): string {
  const code = error.errorCode ? ` · ${error.errorCode}` : '';
  return (
    `주소록을 읽을 권한이 없습니다(HTTP 403${code}). ` +
    "커머스API센터에서 애플리케이션에 '판매자정보' API 그룹을 추가한 뒤 다시 동기화해 주세요."
  );
}

/**
 * ADDRESSBOOK: `GET /v1/seller/addressbooks-for-page?page=&size=`를 마지막 페이지까지(page는 1부터, Proposed)
 * → commerce_addressbook(자연키 address_book_no, is_overseas ← overseasAddress). 빈 주소록은 정상(0건).
 */
export const addressbookSyncer: MetaTargetSyncer<AddressbookRow[]> = {
  target: 'ADDRESSBOOK',
  async fetch({ api }) {
    const rows: AddressbookRow[] = [];
    for (let page = 1; ; page++) {
      let data: unknown;
      try {
        data = await api.get(COMMERCE_META_PATHS.ADDRESSBOOKS, {
          page,
          size: ADDRESSBOOK_PAGE_SIZE,
        });
      } catch (e) {
        if (e instanceof MetaFetchError && e.httpStatus === 403) {
          throw new MetaFetchError(addressbookForbiddenMessage(e), 403, e.errorCode, e.path);
        }
        throw e;
      }
      const mapped = mapAddressbookPage(data);
      rows.push(...mapped.rows);
      // 마지막 페이지: 응답이 알려 주면(last·totalPages) 그것을, 모르면 한 페이지가 덜 찼을 때
      const done =
        mapped.rows.length === 0 ||
        mapped.last === true ||
        (mapped.totalPages !== null
          ? page >= mapped.totalPages
          : mapped.last === null && mapped.rows.length < ADDRESSBOOK_PAGE_SIZE);
      if (done) break;
      if (page >= ADDRESSBOOK_MAX_PAGES) {
        throw new MetaMappingError(`주소록이 ${ADDRESSBOOK_MAX_PAGES}페이지를 넘습니다.`);
      }
    }
    return uniqueBy(rows, (r) => r.addressBookNo);
  },
  async apply(tx, rows, now) {
    await syncKeyedRows(
      tx.commerceAddressbook,
      'addressBookNo',
      ['name', 'addressType', 'isOverseas', 'addressSummary', 'raw'],
      rows,
      now,
    );
    return rows.length;
  },
};
