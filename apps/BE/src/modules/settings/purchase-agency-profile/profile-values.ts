/**
 * 구매대행 프로필 값(purchase_agency_profile, 설치본당 1행, F-ST-07~10). 05-2 `PurchaseAgencyProfileInput`의 12개 키다.
 * 배송비(`deliveryFeeKrw`)는 0 고정이라 여기 없다(F-ST-10, ck_pap_free_delivery).
 */
export interface PurchaseAgencyProfileValues {
  /** 해외 출고지(commerce_addressbook.id, isOverseas만). ⑨ claimDeliveryInfo.shippingAddressId의 출처 */
  overseasShippingCommerceAddressbookId: number | null;
  /** 반품·교환지(commerce_addressbook.id). ⑨ returnAddressId의 출처 */
  returnCommerceAddressbookId: number | null;
  /** 발송 택배사 코드(설정 파일 delivery.dispatchCompanies) */
  dispatchDeliveryCompanyCode: string | null;
  /** 반품 택배사(commerce_return_delivery_company.id) */
  commerceReturnDeliveryCompanyId: number | null;
  returnFeeKrw: number | null;
  exchangeFeeKrw: number | null;
  businessName: string | null;
  afterServicePhone: string | null;
  afterServiceGuide: string | null;
  /** 수입자 표기. 기본은 비어 있다(F-AP-11, 법률 확인 E-3 전이라 상호를 복사하지 않는다) */
  importer: string | null;
  /** 고시 항목 키별 고정 문구(jsonb) */
  noticeFixedTexts: Record<string, string>;
  maxPurchaseQuantityPerOrder: number;
}

export type ProfileField = keyof PurchaseAgencyProfileValues;

/** 12개 입력 키(05-2 PurchaseAgencyProfileInput `required` 순서). PUT은 이 키가 모두 있어야 한다 */
export const PROFILE_FIELDS = [
  'overseasShippingCommerceAddressbookId',
  'returnCommerceAddressbookId',
  'dispatchDeliveryCompanyCode',
  'commerceReturnDeliveryCompanyId',
  'returnFeeKrw',
  'exchangeFeeKrw',
  'businessName',
  'afterServicePhone',
  'afterServiceGuide',
  'importer',
  'noticeFixedTexts',
  'maxPurchaseQuantityPerOrder',
] as const satisfies readonly ProfileField[];

/** 글 칸(앞뒤 공백을 지우고, 비면 null로 저장한다 — Proposed) */
export const PROFILE_TEXT_FIELDS = [
  'dispatchDeliveryCompanyCode',
  'businessName',
  'afterServicePhone',
  'afterServiceGuide',
  'importer',
] as const satisfies readonly ProfileField[];

/**
 * 비어 있으면 `missingFields`에 드는 필수값(Proposed P1-09, 05-1 §2.12). 등록 요청(⑨)이나 ⑥-3 고지에 꼭 들어가는
 * nullable 칸 10개 전부다. 빈 문자열은 저장할 때 null로 바뀌므로 따로 보지 않는다. 비어 있어도 저장은 된다.
 * `noticeFixedTexts`(비면 ⑥-3 기본 문구)·`maxPurchaseQuantityPerOrder`(늘 1 이상)는 빠지지 않는다.
 */
export const PROFILE_REQUIRED_FIELDS = [
  'overseasShippingCommerceAddressbookId',
  'returnCommerceAddressbookId',
  'dispatchDeliveryCompanyCode',
  'commerceReturnDeliveryCompanyId',
  'returnFeeKrw',
  'exchangeFeeKrw',
  'businessName',
  'afterServicePhone',
  'afterServiceGuide',
  'importer',
] as const satisfies readonly ProfileField[];

/**
 * ⑥-3이 시작 전에 보는 칸(F-CT-24: importer·상호·A/S 정보, Proposed). 비어 있으면 P3-04가 409 `PROFILE_INCOMPLETE`
 * (`details.missingFields`)로 막는다. `missingFieldsOf(values, NOTICE_HTML_REQUIRED_PROFILE_FIELDS)`로 쓴다.
 */
export const NOTICE_HTML_REQUIRED_PROFILE_FIELDS = [
  'businessName',
  'afterServicePhone',
  'afterServiceGuide',
  'importer',
] as const satisfies readonly ProfileField[];

/** 주문당 최대 구매수량 기본값(F-ST-10, ERD 기본 1) */
export const DEFAULT_MAX_PURCHASE_QUANTITY_PER_ORDER = 1;

/** 행이 없을 때의 빈 기본값(05-2 getPurchaseAgencyProfile). 개인 값은 넣지 않는다(F-BS-03) */
export function emptyProfileValues(): PurchaseAgencyProfileValues {
  return {
    overseasShippingCommerceAddressbookId: null,
    returnCommerceAddressbookId: null,
    dispatchDeliveryCompanyCode: null,
    commerceReturnDeliveryCompanyId: null,
    returnFeeKrw: null,
    exchangeFeeKrw: null,
    businessName: null,
    afterServicePhone: null,
    afterServiceGuide: null,
    importer: null,
    noticeFixedTexts: {},
    maxPurchaseQuantityPerOrder: DEFAULT_MAX_PURCHASE_QUANTITY_PER_ORDER,
  };
}

function trimToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** noticeFixedTexts: 값의 앞뒤 공백을 지우고, 빈 값의 키는 뺀다. 키 순서는 사전순(비교·저장이 흔들리지 않게) */
export function normalizeNoticeFixedTexts(texts: Readonly<Record<string, string>>) {
  const out: Record<string, string> = {};
  for (const key of Object.keys(texts).sort()) {
    const value = texts[key]?.trim() ?? '';
    if (value !== '') out[key] = value;
  }
  return out;
}

/**
 * 저장 전 정리(Proposed P1-09): 글 칸은 앞뒤 공백을 지우고 비면 null, 고시 문구는 빈 값을 뺀다.
 * 그래서 빈 문자열은 빈칸(null)과 같게 `missingFields`에 들어간다.
 */
export function normalizeProfileValues(
  values: PurchaseAgencyProfileValues,
): PurchaseAgencyProfileValues {
  const out: PurchaseAgencyProfileValues = {
    ...values,
    noticeFixedTexts: normalizeNoticeFixedTexts(values.noticeFixedTexts),
  };
  for (const field of PROFILE_TEXT_FIELDS) out[field] = trimToNull(values[field]);
  return out;
}

/** 키를 정렬한 JSON(값 비교용). step-engine이 이 파일의 이름표를 읽으므로 설정 로더를 끌어오지 않게 따로 둔다 */
function stableJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value)) ?? 'undefined';
}

/** 두 프로필 값에서 바뀐 키(PROFILE_FIELDS 순서). 같으면 빈 배열. 고시 문구는 키 순서와 상관없이 비교한다 */
export function changedProfileFields(
  before: PurchaseAgencyProfileValues,
  after: PurchaseAgencyProfileValues,
): ProfileField[] {
  return PROFILE_FIELDS.filter((field) => stableJson(before[field]) !== stableJson(after[field]));
}

/** 비어 있는(null) 필수값 이름. `fields`를 주지 않으면 PROFILE_REQUIRED_FIELDS 전체 */
export function missingFieldsOf(
  values: PurchaseAgencyProfileValues,
  fields: readonly ProfileField[] = PROFILE_REQUIRED_FIELDS,
): ProfileField[] {
  return fields.filter((field) => {
    const value = values[field];
    return value === null || (typeof value === 'string' && value.trim() === '');
  });
}

/** DB 행(Prisma) → 값. noticeFixedTexts(jsonb)는 문자열 값만 남긴다 */
export function profileValuesFromRow(row: {
  overseasShippingCommerceAddressbookId: number | null;
  returnCommerceAddressbookId: number | null;
  dispatchDeliveryCompanyCode: string | null;
  commerceReturnDeliveryCompanyId: number | null;
  returnFeeKrw: number | null;
  exchangeFeeKrw: number | null;
  businessName: string | null;
  afterServicePhone: string | null;
  afterServiceGuide: string | null;
  importer: string | null;
  noticeFixedTexts: unknown;
  maxPurchaseQuantityPerOrder: number;
}): PurchaseAgencyProfileValues {
  const texts: Record<string, string> = {};
  const raw = row.noticeFixedTexts;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string') texts[key] = value;
    }
  }
  return {
    overseasShippingCommerceAddressbookId: row.overseasShippingCommerceAddressbookId,
    returnCommerceAddressbookId: row.returnCommerceAddressbookId,
    dispatchDeliveryCompanyCode: row.dispatchDeliveryCompanyCode,
    commerceReturnDeliveryCompanyId: row.commerceReturnDeliveryCompanyId,
    returnFeeKrw: row.returnFeeKrw,
    exchangeFeeKrw: row.exchangeFeeKrw,
    businessName: row.businessName,
    afterServicePhone: row.afterServicePhone,
    afterServiceGuide: row.afterServiceGuide,
    importer: row.importer,
    noticeFixedTexts: texts,
    maxPurchaseQuantityPerOrder: row.maxPurchaseQuantityPerOrder,
  };
}
