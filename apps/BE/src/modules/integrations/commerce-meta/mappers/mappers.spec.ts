import { metaFixtureBody } from '../../../../../test/support/fake-commerce-meta.js';
import { mapAddressbookPage } from './addressbook.mapper.js';
import { mapCategoryDetail } from './category-detail.mapper.js';
import { mapCategories } from './category.mapper.js';
import { MetaMappingError } from './mapper-utils.js';
import { canonicalMetaJson, payloadSha256, toMetaDocument } from './meta-document.js';
import { mapOriginAreas } from './origin-area.mapper.js';
import { mapProductAttributes } from './product-attributes.mapper.js';
import { mapProvidedNotice } from './provided-notice.mapper.js';
import { mapReturnDeliveryCompanies } from './return-delivery-company.mapper.js';
import { mapStandardOptions } from './standard-options.mapper.js';

describe('메타 응답 → 행 변환(mappers, fixture)', () => {
  it('CATEGORY: 리프 8개, id는 글자, 경로 그대로. last=false는 빼고 같은 id는 하나만', () => {
    const rows = mapCategories(metaFixtureBody('categories-last'));
    expect(rows).toHaveLength(8);
    expect(rows[0]).toEqual({
      categoryId: '50000791',
      name: '러닝화',
      wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
    });
    const mixed = mapCategories([
      { id: 1, name: 'a', wholeCategoryName: 'x>a', last: true },
      { id: 2, name: 'b', wholeCategoryName: 'x>b', last: false },
      { id: 1, name: 'a2', wholeCategoryName: 'x>a2', last: true },
    ]);
    expect(mixed).toEqual([{ categoryId: '1', name: 'a', wholeCategoryName: 'x>a' }]);
  });

  it('CATEGORY: 빈 목록·모양이 다른 응답·20자 넘는 id는 MetaMappingError', () => {
    expect(() => mapCategories([])).toThrow(MetaMappingError);
    expect(() => mapCategories({ foo: 1 })).toThrow(/목록을 찾지 못했습니다/);
    expect(() =>
      mapCategories([{ id: '1'.repeat(21), name: 'a', wholeCategoryName: 'x' }]),
    ).toThrow(/20자/);
    expect(() => mapCategories([{ id: '1', name: 'a' }])).toThrow(/wholeCategoryName/);
  });

  it('CATEGORY_DETAIL: exceptionalCategories 배열(글자·객체 모두), 없으면 빈 배열, 문서 scope = categoryId', () => {
    const kc = mapCategoryDetail('50000791', metaFixtureBody('category-detail-50000791'));
    expect(kc.exceptionalCategories).toEqual(['KC_CERTIFICATION']);
    expect(kc.document).toMatchObject({ kind: 'CATEGORY_DETAIL', scopeKey: '50000791' });
    const child = mapCategoryDetail('50000794', metaFixtureBody('category-detail-50000794'));
    expect(child.exceptionalCategories).toEqual(['CHILD_CERTIFICATION', 'KC_CERTIFICATION']);
    const none = mapCategoryDetail('50000801', metaFixtureBody('category-detail-50000801'));
    expect(none.exceptionalCategories).toEqual([]);
    expect(mapCategoryDetail('1', { id: '1' }).exceptionalCategories).toEqual([]);
    expect(
      mapCategoryDetail('1', {
        exceptionalCategories: [{ code: 'ADULT' }, 'ADULT', ' ', { type: 'FREE_RETURN_INSURANCE' }],
      }).exceptionalCategories,
    ).toEqual(['ADULT', 'FREE_RETURN_INSURANCE']);
    expect(() => mapCategoryDetail('1', [])).toThrow(MetaMappingError);
    expect(() => mapCategoryDetail('1', { exceptionalCategories: 'KC' })).toThrow(
      /목록이 아닙니다/,
    );
  });

  it('STANDARD_OPTIONS·PRODUCT_ATTRIBUTES·PROVIDED_NOTICE: 원문을 문서로(범위 키)', () => {
    const so = mapStandardOptions('50000791', metaFixtureBody('standard-options-50000791'));
    expect(so).toMatchObject({ kind: 'STANDARD_OPTIONS', scopeKey: '50000791' });
    expect((so.payload as { useStandardOption: boolean }).useStandardOption).toBe(true);
    const attrs = mapProductAttributes(
      '50000791',
      metaFixtureBody('product-attributes-50000791'),
      metaFixtureBody('product-attribute-values-50000791'),
    );
    expect(attrs.kind).toBe('PRODUCT_ATTRIBUTES');
    expect(attrs.payload).toEqual({
      attributes: metaFixtureBody('product-attributes-50000791'),
      attributeValues: metaFixtureBody('product-attribute-values-50000791'),
    });
    const notice = mapProvidedNotice(metaFixtureBody('provided-notice-shoes'));
    expect(notice).toMatchObject({ kind: 'PROVIDED_NOTICE', scopeKey: 'SHOES' });
    expect(() => mapStandardOptions('1', 'x')).toThrow(MetaMappingError);
    expect(() => mapProductAttributes('1', null, [])).toThrow(MetaMappingError);
    expect(() => mapProvidedNotice(null)).toThrow(MetaMappingError);
  });

  it('ORIGIN_AREA: 맨 위는 parentCode null, 하위 목록은 parentCode = 상위 코드', () => {
    const top = mapOriginAreas(metaFixtureBody('origin-areas'), null);
    expect(top.map((r) => r.originAreaCode)).toEqual(['00', '02', '03', '04']);
    expect(top.every((r) => r.parentCode === null)).toBe(true);
    const sub = mapOriginAreas(metaFixtureBody('origin-areas-sub-02'), '02');
    expect(sub[0]).toEqual({ originAreaCode: '0200037', name: '아시아>일본', parentCode: '02' });
    expect(sub).toHaveLength(3);
    expect(mapOriginAreas(metaFixtureBody('origin-areas-sub-empty'), '00')).toEqual([]);
    // 최상위 배열·originAreaCode 칸도 받는다
    expect(mapOriginAreas([{ originAreaCode: '05', name: '기타' }], null)).toEqual([
      { originAreaCode: '05', name: '기타', parentCode: null },
    ]);
  });

  it('ADDRESSBOOK: isOverseas ← overseasAddress, addressBookNo 숫자 글자, 요약 한 줄, 페이지 정보', () => {
    const page1 = mapAddressbookPage(metaFixtureBody('addressbooks-page-1'));
    expect(page1.totalPages).toBe(2);
    expect(page1.rows).toHaveLength(2);
    expect(page1.rows[0]).toMatchObject({
      addressBookNo: '100000001',
      name: '[배대지 창고] 해외 출고지',
      addressType: 'RELEASE',
      isOverseas: true,
      addressSummary: '[배대지 창고 주소] [동·호수]',
    });
    expect(page1.rows[0]?.raw).toEqual(
      metaFixtureBody<{ addressBooks: unknown[] }>('addressbooks-page-1').addressBooks[0],
    );
    expect(page1.rows[1]).toMatchObject({ addressBookNo: '100000002', isOverseas: false });
    const page2 = mapAddressbookPage(metaFixtureBody('addressbooks-page-2'));
    expect(page2.rows[0]).toMatchObject({
      isOverseas: true,
      addressSummary: '[배대지 창고 2 주소]',
    });
    expect(page2.rows.every((r) => /^[0-9]+$/.test(r.addressBookNo))).toBe(true);
    expect(() =>
      mapAddressbookPage({ addressBooks: [{ addressBookNo: 'A-1', name: 'x' }] }),
    ).toThrow(/숫자가 아닙니다/);
    expect(mapAddressbookPage({ addressBooks: [] })).toEqual({
      rows: [],
      last: null,
      totalPages: null,
    });
  });

  it('RETURN_DELIVERY_COMPANY: deliveryCompanyCode·Name(또는 code·name) → 행', () => {
    const rows = mapReturnDeliveryCompanies(metaFixtureBody('return-delivery-companies'));
    expect(rows).toEqual([
      { code: 'CJGLS', name: 'CJ대한통운' },
      { code: 'HANJIN', name: '한진택배' },
      { code: 'EPOST', name: '우체국택배' },
    ]);
    expect(mapReturnDeliveryCompanies({ contents: [{ code: 'X', name: 'Y' }] })).toEqual([
      { code: 'X', name: 'Y' },
    ]);
  });

  it('문서 해시: 정규화 JSON(키 순서 무관)의 SHA-256 소문자 hex 64자', () => {
    const a = payloadSha256({ b: 1, a: [2, { d: 1, c: 2 }] });
    const b = payloadSha256({ a: [2, { c: 2, d: 1 }], b: 1 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(payloadSha256({ a: [2, 1] })).not.toBe(payloadSha256({ a: [1, 2] }));
    expect(canonicalMetaJson({ b: 1, a: undefined })).toBe('{"b":1}');
    expect(() => toMetaDocument('PROVIDED_NOTICE', '', {})).toThrow();
    expect(() => toMetaDocument('PROVIDED_NOTICE', 'x'.repeat(41), {})).toThrow();
  });
});
