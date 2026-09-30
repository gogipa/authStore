import { naverShoppingLinksOf, naverShoppingUrl } from './naver-shopping-links.service.js';
import { sellerlifeCouponAmount } from './pricing-step.runner.js';
import { couponYenOf, judgeSizesOf } from './pricing-sources.js';
import type { SourcingSelectionView } from '../step-engine/ports/sourcing-selection.port.js';

describe('네이버쇼핑 검색 링크(규칙 14, F-PJ-12)', () => {
  it('출처 키워드 → 型番 순서, 값이 있는 것만. URL은 search/all?query= + 인코딩(Proposed)', () => {
    expect(naverShoppingUrl('아식스 젤카야노14')).toBe(
      'https://search.shopping.naver.com/search/all?query=%EC%95%84%EC%8B%9D%EC%8A%A4+%EC%A0%A4%EC%B9%B4%EC%95%BC%EB%85%B814',
    );
    expect(
      naverShoppingLinksOf({ sourceKeyword: '뉴발란스 530', anchorModelCode: 'MR530SG' }).map(
        (l) => [l.kind, l.query],
      ),
    ).toEqual([
      ['SOURCE_KEYWORD', '뉴발란스 530'],
      ['MODEL_CODE', 'MR530SG'],
    ]);
    expect(naverShoppingLinksOf({ sourceKeyword: null, anchorModelCode: ' ' })).toEqual([]);
    expect(naverShoppingLinksOf({ sourceKeyword: null, anchorModelCode: '1201A019-108' })).toEqual([
      {
        kind: 'MODEL_CODE',
        query: '1201A019-108',
        url: 'https://search.shopping.naver.com/search/all?query=1201A019-108',
      },
    ]);
  });
});

describe('셀러라이프 배대지 쿠폰 월 한도(F-ST-05, Proposed)', () => {
  const on = { enabled: true, amountKrw: 2000, monthlyLimit: 2 };
  it('켜져 있고 이번 달 다른 후보 사용이 한도보다 적으면 1장 금액', () => {
    expect(sellerlifeCouponAmount(on, 0)).toBe(2000);
    expect(sellerlifeCouponAmount(on, 1)).toBe(2000);
    expect(sellerlifeCouponAmount(on, 2)).toBe(0);
  });
  it('꺼짐·월 한도 0(기본)·금액 0이면 적용하지 않는다', () => {
    expect(sellerlifeCouponAmount({ ...on, enabled: false }, 0)).toBe(0);
    expect(sellerlifeCouponAmount({ ...on, monthlyLimit: 0 }, 0)).toBe(0);
    expect(sellerlifeCouponAmount({ ...on, amountKrw: 0 }, 0)).toBe(0);
  });
});

describe('③ 입력 원천(규칙 1·2)', () => {
  const selection = (patch: Partial<SourcingSelectionView>): SourcingSelectionView => ({
    sourcingStepRunId: 1,
    sourcingComparisonId: 1,
    action: 'SEARCH_COMPARE',
    comparisonPerformed: true,
    rakutenItemId: 1,
    itemCode: 'shop-a:1',
    itemName: 'x',
    itemUrl: 'https://item.rakuten.co.jp/shop-a/1/',
    collectedAt: new Date(0),
    representativeRakutenSkuId: null,
    shippingYen: 0,
    shippingSource: 'FREE',
    couponYen: 300,
    anchorColorLabel: null,
    anchorColorCode: null,
    adultProductConfirmedAt: null,
    ...patch,
  });

  it('쿠폰: 비교를 한 버전은 ② 고른 행 값, URL 후보는 쿠폰 입력 최신 행(없으면 0)', () => {
    expect(couponYenOf({ selection: selection({}), couponInput: { id: 9, couponYen: 1000 } })).toBe(
      300,
    );
    expect(
      couponYenOf({
        selection: selection({ comparisonPerformed: false, couponYen: 0 }),
        couponInput: { id: 9, couponYen: 1000 },
      }),
    ).toBe(1000);
    expect(
      couponYenOf({ selection: selection({ comparisonPerformed: false }), couponInput: null }),
    ).toBe(0);
  });

  it('판정 대상은 재고 있는 목표 사이즈(가격을 아는 SKU)만', () => {
    expect(
      judgeSizesOf({
        sourcingStepRunId: 1,
        rakutenItemId: 1,
        gender: 'MALE',
        inStockSizeCount: 2,
        pointsTotalPt: null,
        sizes: [
          { sizeMm: 250, status: 'IN_STOCK', rakutenSkuId: 1, taxIncludedPriceYen: 12000 },
          { sizeMm: 255, status: 'SOLD_OUT', rakutenSkuId: 2, taxIncludedPriceYen: 12000 },
          { sizeMm: 260, status: 'BACK_ORDER', rakutenSkuId: 3, taxIncludedPriceYen: 12000 },
          { sizeMm: 265, status: 'IN_STOCK', rakutenSkuId: 4, taxIncludedPriceYen: null },
          { sizeMm: 270, status: 'NONE', rakutenSkuId: null, taxIncludedPriceYen: null },
        ],
      }),
    ).toEqual([{ sizeMm: 250, rakutenSkuId: 1, skuPriceYen: 12000 }]);
  });
});
