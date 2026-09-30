import { ApiException } from '../../common/errors/api.exception.js';
import {
  parseAnchorRequest,
  parseManualRowRequest,
  parseRowPatch,
  parseSelectionRequest,
} from './sourcing-requests.js';

/** 422 VALIDATION_FAILED의 fieldErrors 칸 이름 */
function failedFields(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiException);
    const e = error as ApiException;
    expect(e.code).toBe('VALIDATION_FAILED');
    return (e.fieldErrors ?? []).map((f) => f.field);
  }
  throw new Error('422가 나지 않았습니다');
}

describe('P2-03 요청 본문 검사(sourcing-requests)', () => {
  describe('parseRowPatch(PATCH 행, 규칙 11)', () => {
    it("ownerMatchDecision: 'MATCH'·'NO_MATCH'는 그대로, null은 판단 지우기(칸이 있는 null)", () => {
      expect(parseRowPatch({ ownerMatchDecision: 'MATCH' })).toEqual({
        ownerMatchDecision: 'MATCH',
      });
      expect(parseRowPatch({ ownerMatchDecision: 'NO_MATCH' })).toEqual({
        ownerMatchDecision: 'NO_MATCH',
      });
      const cleared = parseRowPatch({ ownerMatchDecision: null });
      expect(cleared).toEqual({ ownerMatchDecision: null });
      // 서비스는 `!== undefined`로 '보낸 칸'을 가린다 — null도 보낸 칸이다
      expect('ownerMatchDecision' in cleared).toBe(true);
      expect(parseRowPatch({ couponYen: 0 })).not.toHaveProperty('ownerMatchDecision');
    });

    it('ownerMatchDecision의 다른 값(소문자·빈 글·불리언)은 422', () => {
      for (const value of ['match', '', true, 'NEEDS_REVIEW']) {
        expect(failedFields(() => parseRowPatch({ ownerMatchDecision: value }))).toEqual([
          'ownerMatchDecision',
        ]);
      }
    });

    it('쿠폰·배율·오너 판단을 함께 받는다. 빈 본문·음수·소수 쿠폰·다섯째 자리 배율·M2 칸·모르는 칸은 422', () => {
      expect(
        parseRowPatch({ couponYen: 500, shopEventMultiplier: 1.5, ownerMatchDecision: null }),
      ).toEqual({ couponYen: 500, shopEventMultiplier: 1.5, ownerMatchDecision: null });
      expect(failedFields(() => parseRowPatch({}))).toEqual(['']);
      expect(failedFields(() => parseRowPatch({ couponYen: -1 }))).toEqual(['couponYen']);
      expect(failedFields(() => parseRowPatch({ couponYen: 1.5 }))).toEqual(['couponYen']);
      expect(failedFields(() => parseRowPatch({ shopEventMultiplier: 1.00001 }))).toEqual([
        'shopEventMultiplier',
      ]);
      expect(failedFields(() => parseRowPatch({ shippingYen: 0 }))).toEqual(['shippingYen']);
      expect(failedFields(() => parseRowPatch({ memo: 'x' }))).toEqual(['memo']);
      expect(failedFields(() => parseRowPatch([]))).toEqual(['']);
    });
  });

  describe('parseAnchorRequest(PUT anchor, 규칙 1)', () => {
    it('SEARCH_PICK은 anchorItemCode, CODE_ENTRY는 anchorModelCode 필수(정규화값을 함께 돌려준다)', () => {
      expect(
        parseAnchorRequest({ anchorInputMethod: 'SEARCH_PICK', anchorItemCode: 'shop-a:1' }),
      ).toEqual({
        anchorInputMethod: 'SEARCH_PICK',
        anchorItemCode: 'shop-a:1',
        anchorColorCode: null,
        anchorColorLabel: null,
      });
      expect(
        parseAnchorRequest({
          anchorInputMethod: 'CODE_ENTRY',
          anchorModelCode: '１２０１ａ０１９',
          anchorColorCode: '108',
        }),
      ).toMatchObject({ anchorModelCodeNorm: '1201A019', anchorColorCode: '108' });
      expect(failedFields(() => parseAnchorRequest({ anchorInputMethod: 'SEARCH_PICK' }))).toEqual([
        'anchorItemCode',
      ]);
      expect(
        failedFields(() =>
          parseAnchorRequest({
            anchorInputMethod: 'CODE_ENTRY',
            anchorModelCode: '1201A019',
            anchorItemCode: 'shop-a:1',
          }),
        ),
      ).toEqual(['anchorItemCode']);
      expect(failedFields(() => parseAnchorRequest({ anchorInputMethod: 'URL_ITEM' }))).toEqual([
        'anchorInputMethod',
      ]);
    });
  });

  it('수동 행·선택 본문: 1 이상의 정수 id 하나만', () => {
    expect(parseManualRowRequest({ rakutenItemId: 7 })).toEqual({ rakutenItemId: 7 });
    expect(parseSelectionRequest({ rowId: 3 })).toEqual({ rowId: 3 });
    expect(failedFields(() => parseManualRowRequest({ rakutenItemId: 0 }))).toEqual([
      'rakutenItemId',
    ]);
    expect(failedFields(() => parseSelectionRequest({ rowId: 1, force: true }))).toEqual(['force']);
  });
});
