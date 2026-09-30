import { ApiProperty } from '@nestjs/swagger';
import { registerDecorator, type ValidationArguments } from 'class-validator';

/** 빠진 키 문구(PUT은 전체 교체라 12개 키가 모두 있어야 한다. 값은 null 허용) */
export const MISSING_KEY_MESSAGE = '빠진 키입니다. 비워 두려면 null을 보내 주세요.';

/** int4 열(주소록·택배사 id)의 위 끝 */
export const MAX_INT4 = 2_147_483_647;
/** 반품비·교환비 위 끝(원, Proposed — 설정 파일 금액 칸과 같다) */
export const MAX_FEE_KRW = 100_000_000;
/** 주문당 최대 구매수량 위 끝(smallint 열, Proposed) */
export const MAX_PURCHASE_QUANTITY = 32_767;
/** 고시 고정 문구: 키 수·키 모양·문구 길이(Proposed P1-09, 05-2 PurchaseAgencyProfileInput.noticeFixedTexts) */
export const NOTICE_FIXED_TEXTS_MAX_KEYS = 20;
export const NOTICE_FIXED_TEXT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
export const NOTICE_FIXED_TEXT_MAX_LENGTH = 1000;

type Check = (value: unknown) => string | null;

/**
 * 키는 꼭 있어야 하고(undefined면 오류) 값 검사는 `check`가 한다. class-validator `@IsDefined()`는 null도 막아
 * '키는 필수·값은 null 허용'(05-2 required + type [x, 'null'])을 나타낼 수 없어 이렇게 둔다.
 */
function RequiredKey(check: Check): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'requiredKey',
      target: object.constructor,
      propertyName: propertyName as string,
      validator: {
        validate: (value: unknown) => value !== undefined && check(value) === null,
        defaultMessage: (args?: ValidationArguments) =>
          args?.value === undefined
            ? MISSING_KEY_MESSAGE
            : (check(args.value) ?? '형식이 맞지 않습니다.'),
      },
    });
  };
}

function intCheck(min: number, max: number, nullable: boolean): Check {
  return (value) => {
    if (value === null) return nullable ? null : '비워 둘 수 없습니다.';
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      return `${min.toLocaleString('ko-KR')} 이상 ${max.toLocaleString('ko-KR')} 이하 정수여야 합니다.`;
    }
    return null;
  };
}

function textCheck(maxLength: number): Check {
  return (value) => {
    if (value === null) return null;
    if (typeof value !== 'string') return '글자여야 합니다.';
    if (value.length > maxLength) return `${maxLength}자 이하여야 합니다.`;
    return null;
  };
}

function noticeFixedTextsCheck(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return '고시 항목 키별 문구(객체)여야 합니다. 없으면 {}를 보내 주세요.';
  }
  const entries = Object.entries(value);
  if (entries.length > NOTICE_FIXED_TEXTS_MAX_KEYS) {
    return `항목은 ${NOTICE_FIXED_TEXTS_MAX_KEYS}개까지입니다.`;
  }
  for (const [key, text] of entries) {
    if (!NOTICE_FIXED_TEXT_KEY_PATTERN.test(key)) {
      return '고시 항목 키는 영문으로 시작하는 영문·숫자 64자까지입니다(예: warrantyPolicy).';
    }
    if (typeof text !== 'string') return `'${key}' 문구는 글자여야 합니다.`;
    if (text.length > NOTICE_FIXED_TEXT_MAX_LENGTH) {
      return `'${key}' 문구는 ${NOTICE_FIXED_TEXT_MAX_LENGTH}자 이하여야 합니다.`;
    }
  }
  return null;
}

/**
 * PUT /purchase-agency-profile 본문(05-2 PurchaseAgencyProfileInput, 전체 교체). 12개 키가 모두 있어야 하고
 * (값은 null 허용 — maxPurchaseQuantityPerOrder·noticeFixedTexts 제외), 정의 밖 필드(배송비 `deliveryFeeKrw` 포함)는
 * 전역 ValidationPipe(forbidNonWhitelisted)가 422 VALIDATION_FAILED로 막는다. 문자열 숫자는 받지 않는다.
 * 글 칸의 앞뒤 공백·빈 문자열은 저장할 때 정리한다(빈 문자열 = null, Proposed).
 */
export class PurchaseAgencyProfileInputDto {
  @ApiProperty({ type: 'integer', nullable: true, minimum: 1, maximum: MAX_INT4 })
  @RequiredKey(intCheck(1, MAX_INT4, true))
  overseasShippingCommerceAddressbookId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 1, maximum: MAX_INT4 })
  @RequiredKey(intCheck(1, MAX_INT4, true))
  returnCommerceAddressbookId!: number | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 40 })
  @RequiredKey(textCheck(40))
  dispatchDeliveryCompanyCode!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 1, maximum: MAX_INT4 })
  @RequiredKey(intCheck(1, MAX_INT4, true))
  commerceReturnDeliveryCompanyId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0, maximum: MAX_FEE_KRW })
  @RequiredKey(intCheck(0, MAX_FEE_KRW, true))
  returnFeeKrw!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0, maximum: MAX_FEE_KRW })
  @RequiredKey(intCheck(0, MAX_FEE_KRW, true))
  exchangeFeeKrw!: number | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  @RequiredKey(textCheck(100))
  businessName!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 40 })
  @RequiredKey(textCheck(40))
  afterServicePhone!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 1000 })
  @RequiredKey(textCheck(1000))
  afterServiceGuide!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  @RequiredKey(textCheck(100))
  importer!: string | null;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string', maxLength: NOTICE_FIXED_TEXT_MAX_LENGTH },
    maxProperties: NOTICE_FIXED_TEXTS_MAX_KEYS,
    description: '고시 항목 키별 고정 문구',
  })
  @RequiredKey(noticeFixedTextsCheck)
  noticeFixedTexts!: Record<string, string>;

  @ApiProperty({ type: 'integer', minimum: 1, maximum: MAX_PURCHASE_QUANTITY })
  @RequiredKey(intCheck(1, MAX_PURCHASE_QUANTITY, false))
  maxPurchaseQuantityPerOrder!: number;
}
