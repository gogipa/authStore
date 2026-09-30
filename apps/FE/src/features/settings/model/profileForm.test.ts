import { describe, expect, it } from 'vitest';
import { emptyProfile, filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import {
  FEE_ERROR,
  formErrorsOf,
  PROFILE_INPUT_KEYS,
  QUANTITY_ERROR,
  saveResultText,
  toProfileFormValues,
  toProfileInput,
} from './profileForm';

function inputOf(values: ReturnType<typeof toProfileFormValues>) {
  const out = toProfileInput(values);
  if (out.errors) throw new Error(JSON.stringify(out.errors));
  return out.input;
}

describe('프로필 폼 변환(P1-09)', () => {
  it('빈 기본값 → 빈 칸(수량 1) → 12개 키 모두, 빈칸은 null, 배송비 없음', () => {
    const values = toProfileFormValues(emptyProfile());
    expect(values.maxPurchaseQuantityPerOrder).toBe('1');
    expect(values.importer).toBe('');
    const input = inputOf(values);
    expect(Object.keys(input).sort()).toEqual([...PROFILE_INPUT_KEYS].sort());
    expect(input).not.toHaveProperty('deliveryFeeKrw');
    expect(input).toEqual({
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
      maxPurchaseQuantityPerOrder: 1,
    });
  });

  it('채운 프로필은 그대로 되돌아온다(숫자 칸 글자 ↔ 정수, 고시 두 칸 ↔ 6개 키)', () => {
    const profile = filledProfile();
    const values = toProfileFormValues(profile);
    expect(values.returnFeeKrw).toBe('30000');
    expect(values.noticeWarranty).toBe('소비자분쟁해결기준에 따름');
    expect(values.noticeReferToDetail).toBe('상품상세 참조');
    const input = inputOf(values);
    const expected = Object.fromEntries(PROFILE_INPUT_KEYS.map((key) => [key, profile[key]]));
    expect(input).toEqual(expected);
  });

  it('숫자 칸: 쉼표·공백은 빼고, 정수가 아니면 보내지 않고 칸 오류', () => {
    const values = { ...toProfileFormValues(filledProfile()), returnFeeKrw: '30,000 ' };
    expect(inputOf(values).returnFeeKrw).toBe(30000);
    expect(toProfileInput({ ...values, exchangeFeeKrw: '-1' }).errors).toEqual({
      exchangeFeeKrw: FEE_ERROR,
    });
    expect(toProfileInput({ ...values, maxPurchaseQuantityPerOrder: '0' }).errors).toEqual({
      maxPurchaseQuantityPerOrder: QUANTITY_ERROR,
    });
    expect(toProfileInput({ ...values, maxPurchaseQuantityPerOrder: '' }).errors).toEqual({
      maxPurchaseQuantityPerOrder: QUANTITY_ERROR,
    });
  });

  it('고시 두 칸을 비우면 그 키를 보내지 않고, 다른 고시 키는 그대로 둔다', () => {
    const profile = filledProfile({
      noticeFixedTexts: { warrantyPolicy: 'A', returnCostReason: 'B', caution: '다른 키' },
    });
    const values = {
      ...toProfileFormValues(profile),
      noticeWarranty: ' ',
      noticeReferToDetail: '',
    };
    expect(inputOf(values).noticeFixedTexts).toEqual({ caution: '다른 키' });
  });

  it('서버 fieldErrors → 칸별 오류(고시 문구는 품질보증기준 칸)', () => {
    expect(
      formErrorsOf([
        { field: 'importer', message: '100자 이하여야 합니다.' },
        { field: 'noticeFixedTexts', message: "'warrantyPolicy' 문구는 글자여야 합니다." },
        { field: 'unknownField', message: 'x' },
      ]),
    ).toEqual({
      importer: '100자 이하여야 합니다.',
      noticeWarranty: "'warrantyPolicy' 문구는 글자여야 합니다.",
    });
  });

  it('저장 결과 안내: 재실행 필요가 생기면 수를 알린다(Proposed 문구)', () => {
    expect(saveResultText({ profile: filledProfile(), rerunRequiredStepCount: 0 })).toBe(
      '저장했습니다.',
    );
    expect(saveResultText({ profile: filledProfile(), rerunRequiredStepCount: 2 })).toContain(
      "후보 단계 2개(⑥-3·⑧·⑨)가 '재실행 필요'가 되었습니다",
    );
  });
});
