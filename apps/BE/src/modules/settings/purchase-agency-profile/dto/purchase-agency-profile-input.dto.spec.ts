import { validProfileInput } from '../../../../../test/fixtures/settings/purchase-agency-profile/profile-fixtures.js';
import { ApiException } from '../../../../common/errors/api.exception.js';
import { AppValidationPipe } from '../../../../common/errors/app-validation.pipe.js';
import {
  MISSING_KEY_MESSAGE,
  PurchaseAgencyProfileInputDto,
} from './purchase-agency-profile-input.dto.js';

const pipe = new AppValidationPipe();
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: PurchaseAgencyProfileInputDto });

async function fieldErrorsOf(body: unknown): Promise<{ field: string; message: string }[]> {
  const error = await validate(body).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ApiException);
  expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
  return (error as ApiException).fieldErrors ?? [];
}

describe('PurchaseAgencyProfileInputDto(규칙 3·4)', () => {
  it('12개 키가 모두 있으면 통과(값은 null 허용)', async () => {
    await expect(validate(validProfileInput())).resolves.toBeInstanceOf(
      PurchaseAgencyProfileInputDto,
    );
    const allNull = {
      ...Object.fromEntries(Object.keys(validProfileInput()).map((k) => [k, null])),
      noticeFixedTexts: {},
      maxPurchaseQuantityPerOrder: 1,
    };
    await expect(validate(allNull)).resolves.toBeDefined();
  });

  it('키가 빠지면 422(빠진 키 문구)', async () => {
    const body: Record<string, unknown> = { ...validProfileInput() };
    delete body.importer;
    expect(await fieldErrorsOf(body)).toEqual([
      expect.objectContaining({ field: 'importer', message: MISSING_KEY_MESSAGE }),
    ]);
  });

  it('배송비(deliveryFeeKrw)는 정의 밖 필드라 0이어도 422', async () => {
    const errors = await fieldErrorsOf({ ...validProfileInput(), deliveryFeeKrw: 0 });
    expect(errors.map((e) => e.field)).toEqual(['deliveryFeeKrw']);
  });

  it.each([
    ['returnFeeKrw', -1],
    ['exchangeFeeKrw', 1.5],
    ['returnFeeKrw', '3000'],
    ['maxPurchaseQuantityPerOrder', 0],
    ['maxPurchaseQuantityPerOrder', null],
    ['overseasShippingCommerceAddressbookId', 0],
    ['businessName', 'x'.repeat(101)],
    ['afterServicePhone', 'x'.repeat(41)],
    ['afterServiceGuide', 'x'.repeat(1001)],
    ['importer', 'x'.repeat(101)],
    ['dispatchDeliveryCompanyCode', 'x'.repeat(41)],
    ['importer', 3],
    ['noticeFixedTexts', null],
    ['noticeFixedTexts', ['상품상세 참조']],
    ['noticeFixedTexts', { warrantyPolicy: 1 }],
    ['noticeFixedTexts', { 'bad key': '문구' }],
  ])('%s = %j → 422', async (field, value) => {
    const errors = await fieldErrorsOf({ ...validProfileInput(), [field]: value });
    expect(errors.map((e) => e.field)).toEqual([field]);
  });

  it('길이 끝값은 통과한다(상호 100·A/S 연락처 40·A/S 안내 1000·수입자 100·발송 코드 40)', async () => {
    await expect(
      validate({
        ...validProfileInput(),
        businessName: 'x'.repeat(100),
        afterServicePhone: 'x'.repeat(40),
        afterServiceGuide: 'x'.repeat(1000),
        importer: 'x'.repeat(100),
        dispatchDeliveryCompanyCode: 'x'.repeat(40),
        returnFeeKrw: 0,
      }),
    ).resolves.toBeDefined();
  });
});
