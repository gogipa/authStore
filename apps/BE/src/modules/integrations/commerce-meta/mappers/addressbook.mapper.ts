import { clip, isObject, listOf, MetaMappingError, requiredText, textOf } from './mapper-utils.js';

/** commerce_addressbook 한 줄 */
export interface AddressbookRow {
  /** 주소록 번호(숫자 문자열, ck_addressbook_no) */
  addressBookNo: string;
  name: string;
  /** 주소 유형 원문(RELEASE·REFUND_OR_EXCHANGE 등 외부 값, CHECK 없음) */
  addressType: string | null;
  /** 응답의 overseasAddress(해외 출고지만 true) */
  isOverseas: boolean;
  /** 화면 표시용 한 줄 주소 */
  addressSummary: string | null;
  /** 항목 원문(API 응답에는 내보내지 않는다) */
  raw: Record<string, unknown>;
}

export interface AddressbookPage {
  rows: AddressbookRow[];
  /** 응답이 마지막 페이지라고 알려 주면 true, 모르면 null */
  last: boolean | null;
  /** 전체 페이지 수(모르면 null) */
  totalPages: number | null;
}

const LIST_KEYS = ['addressBooks', 'addressbooks', 'contents', 'content'] as const;
const ADDRESS_NO = /^[0-9]+$/;

/**
 * 주소록 한 페이지(`GET /v1/seller/addressbooks-for-page`, R04 A3·O3) → 행.
 * 응답은 `{ addressBooks | contents: [...], page, size, totalPages, last }`로 본다(M0 S3 전 추정).
 * 항목: `addressBookNo`(숫자) · `name` · `addressType` · `overseasAddress`(boolean) · `baseAddress`·`detailAddress`.
 */
export function mapAddressbookPage(data: unknown): AddressbookPage {
  const items = listOf(data, LIST_KEYS, '주소록');
  const rows = items.map((item): AddressbookRow => {
    if (!isObject(item)) throw new MetaMappingError('주소록 항목이 객체가 아닙니다.');
    const no = requiredText(item, ['addressBookNo', 'addressbookNo', 'id'], '주소록 항목', 20);
    if (!ADDRESS_NO.test(no)) {
      throw new MetaMappingError('주소록 항목의 addressBookNo가 숫자가 아닙니다.');
    }
    const summary = [
      textOf(item, ['baseAddress', 'address1', 'address']),
      textOf(item, ['detailAddress', 'address2']),
    ]
      .filter((v): v is string => v !== null)
      .join(' ');
    const addressType = textOf(item, ['addressType']);
    return {
      addressBookNo: no,
      name: clip(requiredText(item, ['name', 'addressBookName'], '주소록 항목', 10_000), 100),
      addressType: addressType === null ? null : clip(addressType, 40),
      isOverseas: item.overseasAddress === true,
      addressSummary: summary === '' ? null : clip(summary, 500),
      raw: item,
    };
  });
  const meta = isObject(data) ? data : {};
  const totalPages =
    typeof meta.totalPages === 'number'
      ? meta.totalPages
      : typeof meta.totalPage === 'number'
        ? meta.totalPage
        : null;
  return { rows, last: typeof meta.last === 'boolean' ? meta.last : null, totalPages };
}
