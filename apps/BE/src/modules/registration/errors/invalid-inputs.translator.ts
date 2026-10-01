/**
 * 커머스API 등록 오류 → 한국어 안내(P4-03 §5 `invalid-inputs.translator.ts`, F-AP-32, US-19 AC2, 규칙 13). 번역 사전은 문서에 없어
 * 정했다(Proposed — 05-1 §7.5 'P4-03 구현 결정'). 결과는 `registration.error_message`에 남고 화면이 그대로 보인다.
 * - `invalidInputs[]`(4xx 입력 오류) 한 줄마다 '{칸 이름}: {설명}'. 칸(`name` — 요청 본문 경로)과 종류(`type` — 검증 규칙)를 사전으로
 *   바꾸고, 사전에 없는 칸·종류는 **원문 필드명·종류·메시지를 그대로** 붙인다(모르는 코드를 숨기지 않는다)
 * - `invalidInputs`가 없으면 오류 코드 사전(게이트웨이 인증·IP·요청 한도 등), 없으면 원문 코드·메시지
 * 사전은 실측(M0 S3) 전 추정 이름이다. 실제 응답을 받으면 이 표와 fixture(`test/fixtures/registration/register`)를 함께 고친다.
 */

export interface InvalidInputLike {
  name: string | null;
  type: string | null;
  message: string | null;
}

export interface RegistrationErrorInput {
  httpStatus: number;
  errorCode: string;
  errorMessage: string | null;
  invalidInputs: readonly InvalidInputLike[];
}

/** 요청 본문 경로(앞에서부터 처음 맞는 줄) → 칸 이름 */
const FIELD_LABELS: readonly (readonly [RegExp, string])[] = [
  [/^originProduct\.name$/, '상품명'],
  [/^originProduct\.detailContent$/, '상세 설명'],
  [/^originProduct\.images\.representativeImage/, '대표이미지'],
  [/^originProduct\.images\.optionalImages/, '추가 이미지'],
  [/^originProduct\.images/, '이미지'],
  [/^originProduct\.salePrice$/, '판매가'],
  [/^originProduct\.stockQuantity$/, '재고 수량'],
  [/^originProduct\.leafCategoryId$/, '카테고리'],
  [/^originProduct\.statusType$/, '판매 상태'],
  [/^originProduct\.deliveryInfo\.deliveryCompany/, '택배사'],
  [/^originProduct\.deliveryInfo\.claimDeliveryInfo\.shippingAddressId/, '출고지 주소'],
  [/^originProduct\.deliveryInfo\.claimDeliveryInfo\.returnAddressId/, '반품지 주소'],
  [/^originProduct\.deliveryInfo\.claimDeliveryInfo/, '반품·교환 정보'],
  [/^originProduct\.deliveryInfo/, '배송 정보'],
  [/detailAttribute\.seoInfo\.sellerTags/, '태그'],
  [/detailAttribute\.optionInfo/, '사이즈 옵션'],
  [/detailAttribute\.productInfoProvidedNotice/, '상품정보제공고시'],
  [/detailAttribute\.originAreaInfo\.importer/, '수입자'],
  [/detailAttribute\.originAreaInfo/, '원산지'],
  [/detailAttribute\.afterServiceInfo/, 'A/S 정보'],
  [/detailAttribute\.sellerCodeInfo/, '판매자관리코드'],
  [/detailAttribute\.certificationTargetExcludeContent/, 'KC 인증 면제'],
  [/detailAttribute\.purchaseQuantityInfo/, '구매수량 제한'],
  [/detailAttribute\.customsTaxType/, '관부가세'],
  [/detailAttribute\.minorPurchasable/, '미성년자 구매'],
  [/^smartstoreChannelProduct\.naverShoppingRegistration/, '네이버쇼핑 노출'],
  [/^smartstoreChannelProduct\.channelProductDisplayStatusType/, '전시 상태'],
  [/^smartstoreChannelProduct/, '스마트스토어 채널 설정'],
];

/** 검증 규칙 종류 → 설명 */
const TYPE_TEXT: Readonly<Record<string, string>> = {
  NotBlank: '값이 비었습니다',
  NotNull: '값이 비었습니다',
  NotEmpty: '값이 비었습니다',
  Required: '값이 비었습니다',
  Size: '길이 또는 개수가 허용 범위를 벗어났습니다',
  Length: '길이가 허용 범위를 벗어났습니다',
  Max: '허용 최댓값보다 큽니다',
  Min: '허용 최솟값보다 작습니다',
  Pattern: '형식이 맞지 않습니다',
  Range: '허용 범위를 벗어났습니다',
  NotValid: '값이 올바르지 않습니다',
  Invalid: '값이 올바르지 않습니다',
  Duplicated: '같은 값이 이미 있습니다',
  Restricted: '쓸 수 없는 값입니다(제한)',
};

/** 오류 코드(본문 `code` 또는 `HTTP_<상태>`) → 안내(invalidInputs가 없을 때) */
const CODE_TEXT: Readonly<Record<string, string>> = {
  'GW.AUTHN':
    '커머스API 인증이 거절되었습니다(토큰 만료·키 변경). 시스템 상태에서 인증을 확인한 뒤 다시 승인해 주세요.',
  'GW.IP_NOT_ALLOWED':
    '커머스API에 등록하지 않은 IP에서 보냈습니다. 커머스API 앱의 허용 IP를 확인한 뒤 다시 승인해 주세요.',
  'GW.RATE_LIMIT': '요청이 너무 많아 커머스API가 받지 않았습니다. 잠시 뒤 다시 승인해 주세요.',
  HTTP_429: '요청이 너무 많아 커머스API가 받지 않았습니다. 잠시 뒤 다시 승인해 주세요.',
  HTTP_401: '커머스API 인증이 거절되었습니다. 시스템 상태에서 인증을 확인한 뒤 다시 승인해 주세요.',
  HTTP_403:
    '커머스API가 이 요청을 허용하지 않았습니다. 시스템 상태에서 권한·허용 IP를 확인해 주세요.',
  HTTP_404: '커머스API가 요청 대상을 찾지 못했습니다.',
};

/** 칸 이름(사전에 없으면 null) */
export function fieldLabelOf(name: string | null): string | null {
  if (!name) return null;
  return FIELD_LABELS.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

/** invalidInputs 한 줄 → 한국어 */
export function translateInvalidInput(input: InvalidInputLike): string {
  const label = fieldLabelOf(input.name);
  const typeText = input.type ? TYPE_TEXT[input.type] : undefined;
  if (label && typeText) return `${label}: ${typeText}`;
  // 사전에 없는 칸·종류: 원문 필드명·종류·메시지를 함께
  const raw = [input.name ?? '(필드 없음)', input.type ? `(${input.type})` : ''].join('');
  const head = label ? `${label} ${raw}` : raw;
  return `${head}: ${input.message ?? typeText ?? '알 수 없는 오류'}`;
}

/**
 * 4xx 등록 오류 → `registration.error_message`(한국어, 줄바꿈으로 항목을 나눈다). 첫 줄은 '커머스API가 등록 요청을 거절했습니다
 * (HTTP {상태} · {코드}).'
 */
export function translateRegistrationError(input: RegistrationErrorInput): string {
  const head = `커머스API가 등록 요청을 거절했습니다(HTTP ${input.httpStatus} · ${input.errorCode}).`;
  if (input.invalidInputs.length > 0) {
    return [head, ...input.invalidInputs.map((item) => `- ${translateInvalidInput(item)}`)].join(
      '\n',
    );
  }
  const known = CODE_TEXT[input.errorCode] ?? CODE_TEXT[`HTTP_${input.httpStatus}`];
  if (known) return `${head}\n${known}`;
  return `${head}\n${input.errorMessage ?? '오류 내용이 응답에 없습니다.'}`;
}
