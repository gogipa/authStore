import {
  clip,
  isObject,
  listOf,
  MetaMappingError,
  requiredText,
  uniqueBy,
} from './mapper-utils.js';

/** commerce_return_delivery_company 한 줄 */
export interface ReturnDeliveryCompanyRow {
  /** 택배사 코드(varchar(40)) */
  code: string;
  name: string;
}

const LIST_KEYS = ['returnDeliveryCompanies', 'deliveryCompanies', 'contents', 'content'] as const;

/**
 * 반품 택배사 목록(`GET /v2/product-delivery-info/return-delivery-companies`) → 행.
 * 응답은 `[{ deliveryCompanyCode, deliveryCompanyName }]`(또는 `code`·`name`)로 본다(M0 S3 전 추정).
 */
export function mapReturnDeliveryCompanies(data: unknown): ReturnDeliveryCompanyRow[] {
  const items = listOf(data, LIST_KEYS, '반품 택배사');
  const rows = items.map((item): ReturnDeliveryCompanyRow => {
    if (!isObject(item)) throw new MetaMappingError('반품 택배사 항목이 객체가 아닙니다.');
    return {
      code: requiredText(item, ['code', 'deliveryCompanyCode', 'id'], '반품 택배사 항목', 40),
      name: clip(
        requiredText(item, ['name', 'deliveryCompanyName'], '반품 택배사 항목', 10_000),
        100,
      ),
    };
  });
  return uniqueBy(rows, (r) => r.code);
}
