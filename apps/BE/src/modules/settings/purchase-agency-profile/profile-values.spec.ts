import { validProfileInput } from '../../../../test/fixtures/settings/purchase-agency-profile/profile-fixtures.js';
import {
  changedProfileFields,
  emptyProfileValues,
  missingFieldsOf,
  normalizeProfileValues,
  NOTICE_HTML_REQUIRED_PROFILE_FIELDS,
  PROFILE_FIELDS,
  PROFILE_REQUIRED_FIELDS,
  profileValuesFromRow,
  type PurchaseAgencyProfileValues,
} from './profile-values.js';

const filled = (): PurchaseAgencyProfileValues => validProfileInput();

describe('프로필 값(P1-09)', () => {
  it('입력 키는 05-2 PurchaseAgencyProfileInput의 12개이고 배송비는 없다(규칙 3·4)', () => {
    expect(PROFILE_FIELDS).toHaveLength(12);
    expect(PROFILE_FIELDS).not.toContain('deliveryFeeKrw');
    expect(Object.keys(validProfileInput()).sort()).toEqual([...PROFILE_FIELDS].sort());
  });

  it('빈 기본값: 개인 값 없음, 수량 1, 고시 {}(규칙 1·2)', () => {
    expect(emptyProfileValues()).toEqual({
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

  describe('computeMissingFields(규칙 9)', () => {
    it('빈 기본값 → 05-2 예시 4개(businessName·afterServicePhone·importer·해외 출고지)를 포함한다', () => {
      const missing = missingFieldsOf(emptyProfileValues());
      expect(missing).toEqual(
        expect.arrayContaining([
          'businessName',
          'afterServicePhone',
          'importer',
          'overseasShippingCommerceAddressbookId',
        ]),
      );
      expect(missing).toEqual([...PROFILE_REQUIRED_FIELDS]);
    });

    it('모두 채움 → []', () => {
      expect(missingFieldsOf(filled())).toEqual([]);
    });

    it('빈 문자열·공백만은 비어 있는 것으로 본다(Proposed)', () => {
      expect(missingFieldsOf({ ...filled(), importer: '  ' })).toEqual(['importer']);
      expect(missingFieldsOf(normalizeProfileValues({ ...filled(), businessName: '' }))).toEqual([
        'businessName',
      ]);
    });

    it('⑥-3용 좁은 목록(상호·A/S·수입자)', () => {
      const values = { ...filled(), importer: null, overseasShippingCommerceAddressbookId: null };
      expect(missingFieldsOf(values, NOTICE_HTML_REQUIRED_PROFILE_FIELDS)).toEqual(['importer']);
    });
  });

  describe('정리(Proposed: 빈 문자열 → null)', () => {
    it('글 칸은 앞뒤 공백을 지우고 비면 null, 고시 문구의 빈 값은 뺀다', () => {
      const normalized = normalizeProfileValues({
        ...filled(),
        businessName: '  [내 상호] ',
        dispatchDeliveryCompanyCode: '',
        afterServiceGuide: '   ',
        noticeFixedTexts: { warrantyPolicy: ' 소비자분쟁해결기준에 따름 ', returnCostReason: ' ' },
      });
      expect(normalized.businessName).toBe('[내 상호]');
      expect(normalized.dispatchDeliveryCompanyCode).toBeNull();
      expect(normalized.afterServiceGuide).toBeNull();
      expect(normalized.noticeFixedTexts).toEqual({ warrantyPolicy: '소비자분쟁해결기준에 따름' });
    });
  });

  describe('바뀐 키 계산(규칙 11)', () => {
    it('같은 입력 → []', () => {
      expect(changedProfileFields(filled(), filled())).toEqual([]);
    });

    it('importer만 바뀜 → ["importer"]', () => {
      expect(changedProfileFields(filled(), { ...filled(), importer: '[다른 수입자]' })).toEqual([
        'importer',
      ]);
    });

    it('고시 문구는 키 순서와 상관없이 비교한다', () => {
      const a = filled();
      const reversed = Object.fromEntries(Object.entries(a.noticeFixedTexts).reverse());
      expect(changedProfileFields(a, { ...a, noticeFixedTexts: reversed })).toEqual([]);
      expect(
        changedProfileFields(a, {
          ...a,
          noticeFixedTexts: { ...a.noticeFixedTexts, warrantyPolicy: '[바뀐 문구]' },
        }),
      ).toEqual(['noticeFixedTexts']);
    });

    it('빈 기본값 → 채운 값: 채운 키가 모두 바뀐 키다(수량 1은 그대로)', () => {
      expect(changedProfileFields(emptyProfileValues(), filled())).toEqual(
        PROFILE_FIELDS.filter((f) => f !== 'maxPurchaseQuantityPerOrder'),
      );
    });
  });

  it('DB 행 → 값: jsonb 고시 문구는 문자열 값만 남긴다', () => {
    const values = profileValuesFromRow({
      ...filled(),
      noticeFixedTexts: { warrantyPolicy: '소비자분쟁해결기준에 따름', broken: 3 },
    });
    expect(values.noticeFixedTexts).toEqual({ warrantyPolicy: '소비자분쟁해결기준에 따름' });
    expect(profileValuesFromRow({ ...filled(), noticeFixedTexts: null }).noticeFixedTexts).toEqual(
      {},
    );
  });
});
