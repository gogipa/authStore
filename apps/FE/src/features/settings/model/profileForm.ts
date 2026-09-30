import type { components } from '@/shared/api/schema';

export type PurchaseAgencyProfile = components['schemas']['PurchaseAgencyProfile'];
export type PurchaseAgencyProfileInput = components['schemas']['PurchaseAgencyProfileInput'];
export type PurchaseAgencyProfileSaveResult =
  components['schemas']['PurchaseAgencyProfileSaveResult'];
export type PurchaseAgencyProfileAddressWarning =
  components['schemas']['PurchaseAgencyProfileAddressWarning'];
export type DispatchDeliveryCompany = components['schemas']['DispatchDeliveryCompany'];

/** PUT 본문의 12개 키(05-2 PurchaseAgencyProfileInput required 순서). 배송비는 없다(0 고정) */
export const PROFILE_INPUT_KEYS = [
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
] as const satisfies readonly (keyof PurchaseAgencyProfileInput)[];

/**
 * 고시 고정 문구 두 칸 ↔ `noticeFixedTexts` 키(Proposed P1-09, 화면시안_명세 §6 SCR-10).
 * - '품질보증기준' 칸 = `warrantyPolicy`(SHOES 고시 '품질보증기준', PRD F-CT-22 '소비자분쟁해결기준에 따름')
 * - '나머지 항목' 칸 = 반품·보증 관련 공통 5개 키에 같은 문구('상품상세 참조')
 * 비워 두면 키를 보내지 않는다(⑥-3이 기본 문구를 쓴다).
 */
export const NOTICE_WARRANTY_KEY = 'warrantyPolicy';
export const NOTICE_REFER_TO_DETAIL_KEYS = [
  'returnCostReason',
  'noRefundReason',
  'qualityAssuranceStandard',
  'compensationProcedure',
  'troubleShootingContents',
] as const;

/** 고시 칸 자리표시자(보드 값 — 저장된 값이 아니라 안내 글) */
export const NOTICE_WARRANTY_PLACEHOLDER = '소비자분쟁해결기준에 따름';
export const NOTICE_REFER_TO_DETAIL_PLACEHOLDER = '상품상세 참조';

/** 폼 값(모든 칸이 글자). 고르기 칸은 id·코드 글자, 비우면 '' */
export interface ProfileFormValues {
  overseasShippingCommerceAddressbookId: string;
  returnCommerceAddressbookId: string;
  dispatchDeliveryCompanyCode: string;
  commerceReturnDeliveryCompanyId: string;
  returnFeeKrw: string;
  exchangeFeeKrw: string;
  maxPurchaseQuantityPerOrder: string;
  businessName: string;
  afterServicePhone: string;
  afterServiceGuide: string;
  importer: string;
  noticeWarranty: string;
  noticeReferToDetail: string;
  /** 두 칸에 없는 고시 키(파일·이전 저장값). 고치지 않고 그대로 보낸다 */
  noticeOtherTexts: Record<string, string>;
}

export type ProfileFormField = Exclude<keyof ProfileFormValues, 'noticeOtherTexts'>;
export type ProfileFormErrors = Partial<Record<ProfileFormField, string>>;

const idText = (value: number | null): string => (value === null ? '' : String(value));

/** API 값 → 폼 값 */
export function toProfileFormValues(profile: PurchaseAgencyProfile): ProfileFormValues {
  const texts = { ...profile.noticeFixedTexts };
  const warranty = texts[NOTICE_WARRANTY_KEY] ?? '';
  delete texts[NOTICE_WARRANTY_KEY];
  let referToDetail = '';
  for (const key of NOTICE_REFER_TO_DETAIL_KEYS) {
    const value = texts[key];
    if (referToDetail === '' && value) referToDetail = value;
    delete texts[key];
  }
  return {
    overseasShippingCommerceAddressbookId: idText(profile.overseasShippingCommerceAddressbookId),
    returnCommerceAddressbookId: idText(profile.returnCommerceAddressbookId),
    dispatchDeliveryCompanyCode: profile.dispatchDeliveryCompanyCode ?? '',
    commerceReturnDeliveryCompanyId: idText(profile.commerceReturnDeliveryCompanyId),
    returnFeeKrw: idText(profile.returnFeeKrw),
    exchangeFeeKrw: idText(profile.exchangeFeeKrw),
    maxPurchaseQuantityPerOrder: String(profile.maxPurchaseQuantityPerOrder),
    businessName: profile.businessName ?? '',
    afterServicePhone: profile.afterServicePhone ?? '',
    afterServiceGuide: profile.afterServiceGuide ?? '',
    importer: profile.importer ?? '',
    noticeWarranty: warranty,
    noticeReferToDetail: referToDetail,
    noticeOtherTexts: texts,
  };
}

/** 빈칸 → null, 앞뒤 공백 제거 */
function textOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function idOrNull(value: string): number | null {
  return value === '' ? null : Number(value);
}

/** 숫자 칸: 쉼표·공백을 빼고 0 이상 정수만. 빈칸은 null(허용 여부는 부르는 쪽이 정한다) */
function parseWholeNumber(value: string): number | null | 'invalid' {
  const text = value.replace(/[,\s]/g, '');
  if (text === '') return null;
  if (!/^\d+$/.test(text)) return 'invalid';
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : 'invalid';
}

export const FEE_ERROR = '0 이상 정수로 넣어 주세요.';
export const QUANTITY_ERROR = '1 이상 정수로 넣어 주세요.';

/**
 * 폼 값 → PUT 본문. 12개 키를 모두 채운다(빈칸은 null, 배송비는 넣지 않는다). 숫자 칸이 정수가 아니면 보내지 않고
 * 칸별 오류를 돌려준다(서버 422를 기다리지 않게).
 */
export function toProfileInput(
  values: ProfileFormValues,
): { input: PurchaseAgencyProfileInput; errors?: undefined } | { errors: ProfileFormErrors } {
  const errors: ProfileFormErrors = {};
  const returnFee = parseWholeNumber(values.returnFeeKrw);
  const exchangeFee = parseWholeNumber(values.exchangeFeeKrw);
  const quantity = parseWholeNumber(values.maxPurchaseQuantityPerOrder);
  if (returnFee === 'invalid') errors.returnFeeKrw = FEE_ERROR;
  if (exchangeFee === 'invalid') errors.exchangeFeeKrw = FEE_ERROR;
  if (quantity === 'invalid' || quantity === null || quantity < 1) {
    errors.maxPurchaseQuantityPerOrder = QUANTITY_ERROR;
  }
  if (Object.keys(errors).length > 0) return { errors };

  const noticeFixedTexts: Record<string, string> = { ...values.noticeOtherTexts };
  const warranty = textOrNull(values.noticeWarranty);
  if (warranty !== null) noticeFixedTexts[NOTICE_WARRANTY_KEY] = warranty;
  const referToDetail = textOrNull(values.noticeReferToDetail);
  if (referToDetail !== null) {
    for (const key of NOTICE_REFER_TO_DETAIL_KEYS) noticeFixedTexts[key] = referToDetail;
  }

  return {
    input: {
      overseasShippingCommerceAddressbookId: idOrNull(values.overseasShippingCommerceAddressbookId),
      returnCommerceAddressbookId: idOrNull(values.returnCommerceAddressbookId),
      dispatchDeliveryCompanyCode: textOrNull(values.dispatchDeliveryCompanyCode),
      commerceReturnDeliveryCompanyId: idOrNull(values.commerceReturnDeliveryCompanyId),
      returnFeeKrw: returnFee as number | null,
      exchangeFeeKrw: exchangeFee as number | null,
      businessName: textOrNull(values.businessName),
      afterServicePhone: textOrNull(values.afterServicePhone),
      afterServiceGuide: textOrNull(values.afterServiceGuide),
      importer: textOrNull(values.importer),
      noticeFixedTexts,
      maxPurchaseQuantityPerOrder: quantity as number,
    },
  };
}

/** 서버 fieldErrors의 field(API 키) → 폼 칸. 고시 문구 오류는 '품질보증기준' 칸에 보인다 */
export function formFieldOf(apiField: string): ProfileFormField | null {
  if (apiField === 'noticeFixedTexts' || apiField.startsWith('noticeFixedTexts.')) {
    return 'noticeWarranty';
  }
  const known: readonly string[] = PROFILE_INPUT_KEYS;
  return known.includes(apiField) ? (apiField as ProfileFormField) : null;
}

/** 서버 fieldErrors → 칸별 오류(칸마다 첫 문구) */
export function formErrorsOf(
  fieldErrors: readonly { field: string; message: string }[] | undefined,
): ProfileFormErrors {
  const out: ProfileFormErrors = {};
  for (const error of fieldErrors ?? []) {
    const field = formFieldOf(error.field);
    if (field && out[field] === undefined) out[field] = error.message;
  }
  return out;
}

/** 저장 뒤 재실행 필요 안내(Proposed — 보드에 문구가 없다) */
export function saveResultText(result: PurchaseAgencyProfileSaveResult): string {
  return result.rerunRequiredStepCount > 0
    ? `저장했습니다. 이 값을 쓰는 후보 단계 ${result.rerunRequiredStepCount}개(⑥-3·⑧·⑨)가 '재실행 필요'가 되었습니다. 후보 화면에서 다시 실행해 주세요.`
    : '저장했습니다.';
}
