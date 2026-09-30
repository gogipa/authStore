import { validProfileInput } from '../../../../test/fixtures/settings/purchase-agency-profile/profile-fixtures.js';
import { PROFILE_FIXED_VALUES } from './profile-fixed-values.js';
import {
  addressBookNoToNumber,
  buildProfileFragment,
  ProfileFragmentError,
} from './profile-registration-fragment.js';
import { emptyProfileValues } from './profile-values.js';

const shipping = { id: 1, addressBookNo: '100000001' };
const returnAddress = { id: 2, addressBookNo: '100000002' };
const returnCompany = { id: 1, code: 'CJGLS' };

describe('buildProfileFragment(규칙 8, ⑨ 요청 조각)', () => {
  it('고정값: 관부가세 포함·개인통관·미성년 구매 가능·DELIVERY·무료배송', () => {
    const fragment = buildProfileFragment(
      validProfileInput(),
      { shipping, return: returnAddress },
      returnCompany,
    );
    expect(fragment.customsTaxType).toBe('INCLUDED');
    expect(fragment.deliveryInfo.businessCustomsClearanceSaleYn).toBe(false);
    expect(fragment.minorPurchasable).toBe(true);
    expect(fragment.deliveryInfo.deliveryType).toBe('DELIVERY');
    expect(fragment.deliveryInfo.deliveryFee.deliveryFeeType).toBe('FREE');
    expect(PROFILE_FIXED_VALUES).toEqual({
      customsTaxType: 'INCLUDED',
      businessCustomsClearanceSaleYn: false,
      minorPurchasable: true,
      deliveryFeeType: 'FREE',
    });
  });

  it('shippingAddressId·returnAddressId는 로컬 id가 아니라 네이버 주소록 번호(숫자)다', () => {
    const fragment = buildProfileFragment(
      validProfileInput(),
      { shipping, return: returnAddress },
      returnCompany,
    );
    expect(fragment.deliveryInfo.claimDeliveryInfo.shippingAddressId).toBe(100000001);
    expect(fragment.deliveryInfo.claimDeliveryInfo.returnAddressId).toBe(100000002);
    expect(typeof fragment.deliveryInfo.claimDeliveryInfo.shippingAddressId).toBe('number');
  });

  it('택배사·반품비·교환비·A/S가 프로필 값으로 들어가고, 확인 안 된 필드는 따로 둔다(M0 S3)', () => {
    const fragment = buildProfileFragment(
      validProfileInput(),
      { shipping, return: returnAddress },
      returnCompany,
    );
    expect(fragment.deliveryInfo.deliveryCompany).toBe('FAKE_DISPATCH_A');
    expect(fragment.deliveryInfo.claimDeliveryInfo).toMatchObject({
      returnDeliveryFee: 30000,
      exchangeDeliveryFee: 60000,
    });
    expect(fragment.afterServiceInfo).toEqual({
      afterServiceTelephoneNumber: '[A/S 연락처]',
      afterServiceGuideContent: '[A/S 안내]',
    });
    expect(fragment.unconfirmedFields).toEqual({
      maxPurchaseQuantityPerOrder: 1,
      returnDeliveryCompanyCode: 'CJGLS',
    });
  });

  it('빈 프로필 → 고정값은 그대로, 빈칸은 null(빈칸 검사는 G4 사전 검증)', () => {
    const fragment = buildProfileFragment(
      emptyProfileValues(),
      { shipping: null, return: null },
      null,
    );
    expect(fragment.deliveryInfo.claimDeliveryInfo.shippingAddressId).toBeNull();
    expect(fragment.deliveryInfo.deliveryCompany).toBeNull();
    expect(fragment.customsTaxType).toBe('INCLUDED');
    expect(fragment.unconfirmedFields.returnDeliveryCompanyCode).toBeNull();
  });

  it('프로필이 가리키지 않는 행을 넘기면 던진다(엉뚱한 출고지 방지)', () => {
    expect(() =>
      buildProfileFragment(
        validProfileInput(),
        { shipping: { id: 9, addressBookNo: '100000009' }, return: returnAddress },
        returnCompany,
      ),
    ).toThrow(ProfileFragmentError);
    expect(() =>
      buildProfileFragment(
        validProfileInput(),
        { shipping, return: returnAddress },
        { id: 2, code: 'HANJIN' },
      ),
    ).toThrow(ProfileFragmentError);
  });

  it('주소록 번호: 숫자 글자만, 안전한 정수 범위 안만', () => {
    expect(addressBookNoToNumber('100000001')).toBe(100000001);
    expect(() => addressBookNoToNumber('10a')).toThrow(ProfileFragmentError);
    expect(() => addressBookNoToNumber('9007199254740993')).toThrow(ProfileFragmentError);
  });
});
