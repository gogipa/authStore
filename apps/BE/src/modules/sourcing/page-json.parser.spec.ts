import { rakutenPageBytes } from '../../../test/support/rakuten-fixture.adapters.js';
import {
  colorCodeOf,
  extractPageJson,
  htmlToText,
  normalizeModelCode,
  type ParsedItemPage,
  parseItemPage,
} from './page-json.parser.js';
import { sizeLabelToMm } from './size-label.js';

function parsed(name: Parameters<typeof rakutenPageBytes>[0]): ParsedItemPage {
  const result = parseItemPage(rakutenPageBytes(name));
  if (result.kind !== 'PARSED') throw new Error(`파싱 실패: ${result.kind}`);
  return result.page;
}

describe('상품 페이지 JSON 읽기(F-SO-13·14, P2-02 규칙 9·10)', () => {
  it('EUC-JP 바이트를 풀어 상품명이 깨지지 않는다(UTF-8로 풀면 깨진다)', () => {
    const bytes = rakutenPageBytes('normal');
    const page = parsed('normal');
    const title = 'アシックス ゲルカヤノ 14 1201A019-108 クリーム×ブラック メンズ スニーカー';
    expect(page.itemName).toBe(title);
    expect(bytes.toString('utf8')).not.toContain('アシックス');
    expect(page.shopName).toBe('ショップA');
  });

  it('itemCode는 페이지 JSON의 샵 코드:관리번호(URL 조각이 아님)', () => {
    const page = parsed('normal');
    expect(page).toMatchObject({
      shopCode: 'shop-a',
      itemManageNumber: '10000123',
      itemCode: 'shop-a:10000123',
      genreId: 208025,
      modelCode: '1201A019-108',
      modelCodeNorm: '1201A019108',
    });
  });

  it('SKU를 variantId로 재고와 조인하고 짝 없는 고아 재고 행은 버린다', () => {
    const page = parsed('normal');
    expect(page.skus.map((s) => s.variantId)).toEqual([
      'v250',
      'v255',
      'v260',
      'v265',
      'v270',
      'v275',
      'v280',
      'v285',
      'vL',
    ]);
    expect(page.skus.find((s) => s.variantId === 'v-orphan')).toBeUndefined();
    expect(page.skus.find((s) => s.variantId === 'v250')).toMatchObject({
      quantity: 3,
      taxIncludedPriceYen: 12000,
      articleNumber: '4550456000250',
      postageIncluded: true,
      singleItemShipping: false,
      colorLabel: 'クリーム×ブラック(108)',
      colorCode: '108',
      widthLabel: '2E (標準)',
    });
  });

  it("'24.5cm'류 → mm(25.0cm → 250), 'L' → null + 수동 확인", () => {
    const page = parsed('normal');
    expect(page.skus.map((s) => s.sizeMm)).toEqual([250, 255, 260, 265, 270, 275, 280, 285, null]);
    expect(page.skus.find((s) => s.variantId === 'vL')?.sizeLabel).toBe('L');
    expect(page.manualCheckRequired).toBe(true);
    expect(page.manualCheckNote).toContain('cm가 아닌 사이즈 라벨: L');
    expect(sizeLabelToMm('24.5cm')).toBe(245);
    expect(sizeLabelToMm('２４．５ｃｍ')).toBe(245);
    expect(sizeLabelToMm('S')).toBeNull();
    expect(sizeLabelToMm('US 9')).toBeNull();
    expect(sizeLabelToMm('26')).toBe(260);
  });

  it('hidden·取り寄せ·품절 조건 값을 그대로 둔다', () => {
    const page = parsed('normal');
    const byId = Object.fromEntries(page.skus.map((s) => [s.variantId, s]));
    expect(byId.v285).toMatchObject({ hidden: true, quantity: 2 });
    expect(byId.v280).toMatchObject({ backOrder: true, quantity: 0 });
    expect(byId.v250).toMatchObject({ backOrder: false, hidden: false });
    expect(byId.v270).toMatchObject({ quantity: 0, stockCondition: 'sold-out' });
    expect(byId.v265?.stockCondition).toBe('almost-out');
    expect(page).toMatchObject({
      backOrderFlag: false,
      unlimitedInventory: false,
      allSkuSamePrice: true,
    });
  });

  it('이미지 전체·설명(HTML → 글자)·세일 기간·속성', () => {
    const page = parsed('normal');
    expect(page.imageUrls).toHaveLength(3);
    expect(page.imageUrls[0]).toBe('https://tshop.r10s.jp/shop-a/cabinet/item/shop-a_1.jpg');
    expect(page.descriptionHtml).toContain('<p>');
    expect(page.descriptionText).toContain('原産国:ベトナム');
    expect(page.saleStartsAt?.toISOString()).toBe('2026-09-24T15:00:00.000Z');
    expect(page.saleEndsAt?.toISOString()).toBe('2026-10-01T14:59:59.000Z');
    expect(Array.isArray(page.attributes)).toBe(true);
    expect(page.missingKeys).toEqual([]);
  });

  it('`fallback-root`(api.data.itemInfoSku만)도 같은 결과', () => {
    expect(parsed('fallback-root')).toEqual(parsed('normal'));
  });

  it('`missing-keys` → 멈추지 않고 읽은 것만 + manual_check_required와 빠진 키 이름', () => {
    const page = parsed('missing-keys');
    expect(page.itemCode).toBe('shop-m:10000555');
    expect(page.missingKeys).toEqual([
      'itemInfoSku.media.images',
      'itemInfoSku.productDescription',
      'purchaseInfo.variantMappedInventories',
    ]);
    expect(page.manualCheckRequired).toBe(true);
    expect(page.manualCheckNote).toContain('purchaseInfo.variantMappedInventories');
    expect(page.imageUrls).toEqual([]);
    expect(page.descriptionHtml).toBeNull();
    // 재고 행이 없으면 재고 정보 없음(null)
    expect(page.skus.every((s) => s.quantity === null)).toBe(true);
    expect(page.skus).toHaveLength(2);
  });

  it('점검 페이지(200 + ページが表示できません) → MAINTENANCE', () => {
    expect(parseItemPage(rakutenPageBytes('maintenance'))).toEqual({ kind: 'MAINTENANCE' });
  });

  it('스크립트·JSON·루트·상품명이 없으면 PARSE_FAILED(행을 만들지 않는다)', () => {
    const enc = (html: string) => Buffer.from(html, 'utf8');
    expect(parseItemPage(enc('<html><body>no json</body></html>'))).toEqual({
      kind: 'PARSE_FAILED',
      reason: 'SCRIPT_NOT_FOUND',
    });
    expect(
      parseItemPage(enc('<script type="application/json" id="item-page-app-data">{oops</script>')),
    ).toEqual({ kind: 'PARSE_FAILED', reason: 'JSON_INVALID' });
    expect(
      parseItemPage(
        enc('<script type="application/json" id="item-page-app-data">{"x":1}</script>'),
      ),
    ).toEqual({ kind: 'PARSE_FAILED', reason: 'ROOT_NOT_FOUND' });
    expect(
      parseItemPage(
        enc(
          '<script id="item-page-app-data" type="application/json">{"newApi":{"itemInfoSku":{}}}</script>',
        ),
      ),
    ).toEqual({ kind: 'PARSE_FAILED', reason: 'TITLE_NOT_FOUND' });
  });

  it('장르가 없는 페이지는 genreId null + 빠진 키로 남는다', () => {
    const page = parsed('no-genre');
    expect(page.genreId).toBeNull();
    expect(page.missingKeys).toContain('itemInfoSku.genreId');
  });

  it('관리번호가 없으면 itemCode null(F-BS-37 보완 조회로 넘긴다)', () => {
    const page = parsed('no-item-code');
    expect(page.itemCode).toBeNull();
    expect(page.shopCode).toBe('shop-e');
  });

  it('작은 함수: 스크립트 추출·型番 정규화·색상 코드·HTML 글자', () => {
    expect(
      extractPageJson(
        '<script id="x">1</script><script id="item-page-app-data" type="application/json"> {"a":1} </script>',
      ),
    ).toBe('{"a":1}');
    expect(normalizeModelCode(' 1201a019－108 ')).toBe('1201A019108');
    expect(colorCodeOf('クリーム×ブラック(108)', null)).toBe('108');
    expect(colorCodeOf('クリーム', [{ name: 'カラーコード', value: '１０８' }])).toBe('108');
    expect(colorCodeOf('クリーム', null)).toBeNull();
    expect(htmlToText('<p>a&amp;b</p><br><div>c</div>')).toBe('a&b\nc');
  });
});
