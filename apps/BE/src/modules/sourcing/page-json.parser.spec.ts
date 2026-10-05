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

  /**
   * 실제 라쿠텐 상품 페이지(2026-10-05 실측)의 모양: 구매 정보(`purchaseInfo`)가 `itemInfoSku` 안에 있고, 설명은
   * `pcFields.productDescription`, 관리 번호는 `manageNumber`, 무제한 재고는 `unlimitedInventoryFlag`다. 이 경로를 못 읽으면
   * 재고가 전부 비어 후보가 '재고 부족'으로 제외됐다(합성 fixture는 가정 경로를 써서 걸러지지 않았다). JSON은 ASCII(\u 이스케이프)로 쓴다.
   */
  it('실제 페이지 모양: itemInfoSku 안의 purchaseInfo에서 SKU별 재고를 읽는다(quantity가 null이 아니다)', () => {
    const colorLabel = 'カラー';
    const sizeLabel = 'サイズ';
    const black = 'ブラック';
    const info = {
      title: 'loafer',
      manageNumber: '38s12600034',
      itemId: 10004029,
      unlimitedInventoryFlag: false,
      pcFields: { productDescription: 'desc<br>text', images: [] },
      media: { images: [{ type: 'CABINET', location: '/a/1.jpg' }] },
      variantSelectors: [
        { key: 'Key0', label: colorLabel, values: [{ value: black, label: black }] },
        {
          key: 'Key1',
          label: sizeLabel,
          values: ['22cm', '23cm', '24cm'].map((v) => ({ value: v, label: v })),
        },
      ],
      identicalVariants: { standardPrice: { identical: true }, backOrderFlag: { identical: true } },
      sku: ['22cm', '23cm', '24cm'].map((size, i) => ({
        variantId: `r-sku0000000${i + 1}`,
        selectorValues: [black, size],
        hidden: false,
        taxIncludedPrice: 3000,
      })),
      purchaseInfo: {
        variantMappedInventories: [
          { sku: 'r-sku00000001', quantity: 333 },
          { sku: 'r-sku00000002', quantity: 0 },
          { sku: 'r-sku00000003', quantity: 5 },
        ],
        sku: [],
      },
    };
    const data = { newApi: { itemInfoSku: info }, api: { data: { itemInfoSku: info } } };
    // 페이지는 EUC-JP로 풀리므로 일본어 글자는 \u 이스케이프로 두어 ASCII만 담는다
    const json = JSON.stringify(data).replace(
      /[\u0080-\uffff]/g,
      (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
    );
    const html = `<html><body><script type="application/json" id="item-page-app-data">${json}</script></body></html>`;
    const result = parseItemPage(Buffer.from(html, 'utf8'));
    if (result.kind !== 'PARSED') throw new Error(`파싱 실패: ${result.kind}`);
    const page = result.page;
    expect(page.skus.map((s) => [s.sizeMm, s.quantity])).toEqual([
      [220, 333],
      [230, 0],
      [240, 5],
    ]);
    expect(page.missingKeys).not.toContain('purchaseInfo.variantMappedInventories');
    expect(page.itemManageNumber).toBe('38s12600034');
    expect(page.descriptionHtml).toBe('desc<br>text');
    expect(page.unlimitedInventory).toBe(false);
  });
});
