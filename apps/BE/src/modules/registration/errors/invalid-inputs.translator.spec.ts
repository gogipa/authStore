import {
  fieldLabelOf,
  translateInvalidInput,
  translateRegistrationError,
} from './invalid-inputs.translator.js';

describe('invalidInputs 번역기(P4-03 규칙 13, F-AP-32)', () => {
  it('아는 칸·종류는 한국어로 푼다', () => {
    expect(
      translateInvalidInput({
        name: 'originProduct.name',
        type: 'NotBlank',
        message: 'must not be blank',
      }),
    ).toBe('상품명: 값이 비었습니다');
    expect(
      translateInvalidInput({
        name: 'originProduct.detailAttribute.seoInfo.sellerTags[3].text',
        type: 'Restricted',
        message: null,
      }),
    ).toBe('태그: 쓸 수 없는 값입니다(제한)');
    expect(fieldLabelOf('originProduct.deliveryInfo.claimDeliveryInfo.returnAddressId')).toBe(
      '반품지 주소',
    );
  });

  it('모르는 칸·종류는 원문 필드명·종류·메시지를 함께 보인다', () => {
    expect(
      translateInvalidInput({
        name: 'originProduct.fooBar',
        type: 'WeirdRule',
        message: 'unexpected value',
      }),
    ).toBe('originProduct.fooBar(WeirdRule): unexpected value');
    // 아는 칸 + 모르는 종류 → 칸 이름 옆에 원문
    expect(
      translateInvalidInput({ name: 'originProduct.name', type: 'Odd', message: '이상한 값' }),
    ).toBe('상품명 originProduct.name(Odd): 이상한 값');
  });

  it('4xx 전체 문구: 머리 + 항목 줄, invalidInputs가 없으면 코드 사전 또는 원문', () => {
    const text = translateRegistrationError({
      httpStatus: 400,
      errorCode: 'BadRequest',
      errorMessage: '요청 값이 올바르지 않습니다.',
      invalidInputs: [
        { name: 'originProduct.name', type: 'Size', message: 'size must be between 1 and 100' },
        { name: 'originProduct.unknownField', type: 'X', message: 'raw' },
      ],
    });
    expect(text.split('\n')).toEqual([
      '커머스API가 등록 요청을 거절했습니다(HTTP 400 · BadRequest).',
      '- 상품명: 길이 또는 개수가 허용 범위를 벗어났습니다',
      '- originProduct.unknownField(X): raw',
    ]);
    expect(
      translateRegistrationError({
        httpStatus: 429,
        errorCode: 'HTTP_429',
        errorMessage: null,
        invalidInputs: [],
      }),
    ).toContain('잠시 뒤 다시 승인해 주세요');
    expect(
      translateRegistrationError({
        httpStatus: 409,
        errorCode: 'SomethingNew',
        errorMessage: 'raw message',
        invalidInputs: [],
      }),
    ).toBe('커머스API가 등록 요청을 거절했습니다(HTTP 409 · SomethingNew).\nraw message');
  });
});
