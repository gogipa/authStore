import {
  PAGE_URLS,
  RakutenFixtureServer,
  rakutenPageBytes,
} from '../../../test/support/rakuten-fixture.adapters.js';
import { ItemCodeResolver, keywordFromItemName } from './item-code.resolver.js';
import { type ParsedItemPage, parseItemPage } from './page-json.parser.js';
import { parseRakutenItemUrl, requireRakutenItemUrl, sameItemUrl } from './rakuten-url.js';

function page(name: Parameters<typeof rakutenPageBytes>[0]): ParsedItemPage {
  const r = parseItemPage(rakutenPageBytes(name));
  if (r.kind !== 'PARSED') throw new Error(r.kind);
  return r.page;
}

const clock = { now: () => new Date('2026-09-28T00:00:00Z') };

describe('itemCode 정리(F-SO-32·F-BS-37, P2-02 규칙 11)', () => {
  it('페이지 JSON에 있으면 그대로(`샵코드:관리번호`) — Item Search를 부르지 않는다', async () => {
    const server = new RakutenFixtureServer(clock);
    const resolver = new ItemCodeResolver(server.searchPort);
    const url = parseRakutenItemUrl(PAGE_URLS.normal)!;
    expect(url.itemSlug).toBe('asics-1201a019-108');
    await expect(resolver.resolve(page('normal'), url)).resolves.toEqual({
      itemCode: 'shop-a:10000123',
      shopCode: 'shop-a',
      source: 'PAGE_JSON',
    });
    expect(server.calls).toHaveLength(0);
  });

  it('없으면 URL의 샵 코드 + 型番으로 Item Search, itemUrl이 같은 항목의 itemCode', async () => {
    const server = new RakutenFixtureServer(clock);
    const resolver = new ItemCodeResolver(server.searchPort);
    const url = parseRakutenItemUrl(PAGE_URLS['no-item-code'])!;
    await expect(resolver.resolve(page('no-item-code'), url)).resolves.toEqual({
      itemCode: 'shop-e:10000999',
      shopCode: 'shop-e',
      source: 'ITEM_SEARCH',
    });
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]!.params).toMatchObject({ shopCode: 'shop-e', keyword: '1201A019-108' });
  });

  it('못 찾으면(型番·상품명 둘 다) 422 RAKUTEN_ITEM_CODE_UNRESOLVED — 후보를 만들지 않는다', async () => {
    const server = new RakutenFixtureServer(clock);
    server.answerSearch(
      { status: 200, file: 'by-itemcode-genre.json' },
      { status: 200, file: 'by-itemcode-genre.json' },
    );
    const resolver = new ItemCodeResolver(server.searchPort);
    const url = parseRakutenItemUrl(PAGE_URLS['no-item-code'])!;
    await expect(resolver.resolve(page('no-item-code'), url)).rejects.toMatchObject({
      code: 'RAKUTEN_ITEM_CODE_UNRESOLVED',
      details: { shopCode: 'shop-e' },
    });
    expect(server.calls).toHaveLength(2);
  });

  it('상품명 → 보완 검색어(괄호 광고 문구 빼고 규칙을 지키는 앞 단어 5개)', () => {
    expect(
      keywordFromItemName('【送料無料】アシックス ゲルカヤノ 14 1201A019-108 クリーム ★セール'),
    ).toBe('アシックス ゲルカヤノ 14 1201A019-108 クリーム');
    expect(keywordFromItemName('【】')).toBeNull();
  });
});

describe('라쿠텐 상품 URL(F-SO-31, Proposed 허용 형식)', () => {
  it.each([
    [
      'https://item.rakuten.co.jp/shop-a/asics-1201a019-108/',
      'https://item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    ],
    [
      'http://item.rakuten.co.jp/Shop-A/asics-1201a019-108',
      'https://item.rakuten.co.jp/shop-a/asics-1201a019-108/',
    ],
    [
      'https://ITEM.rakuten.co.jp/shop-a/10000123/?scid=af&x=1#top',
      'https://item.rakuten.co.jp/shop-a/10000123/',
    ],
  ])('%s → %s', (raw, url) => {
    expect(parseRakutenItemUrl(raw)?.url).toBe(url);
  });

  it.each([
    'https://search.rakuten.co.jp/search/mall/asics/',
    'https://a.r10.to/hxyz',
    'https://item.rakuten.co.jp/shop-a/',
    'https://item.rakuten.co.jp/shop-a/a/b/',
    'https://item.rakuten.co.jp:8443/shop-a/x/',
    'ftp://item.rakuten.co.jp/shop-a/x/',
    'https://item.rakuten.co.jp.evil.example/shop-a/x/',
    'not a url',
  ])('%s → 422 RAKUTEN_URL_INVALID', (raw) => {
    expect(parseRakutenItemUrl(raw)).toBeNull();
    let code: unknown = null;
    try {
      requireRakutenItemUrl(raw);
    } catch (e) {
      code = (e as { code?: unknown }).code;
    }
    expect(code).toBe('RAKUTEN_URL_INVALID');
  });

  it('itemUrl 같음: 대소문자·http·끝 /·쿼리 무시', () => {
    expect(
      sameItemUrl(
        'http://item.rakuten.co.jp/shop-e/kayano14/?x=1',
        'https://item.rakuten.co.jp/shop-e/kayano14',
      ),
    ).toBe(true);
    expect(
      sameItemUrl('https://item.rakuten.co.jp/shop-e/a/', 'https://item.rakuten.co.jp/shop-e/b/'),
    ).toBe(false);
  });
});
