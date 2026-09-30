import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import { validateExternalRequest } from '../http/external-http.gateway.js';
import { maskUrl } from '../http/url-mask.js';
import {
  buildRakutenApiUrl,
  buildRakutenSearchParams,
  canonicalParams,
  paramsWithoutSecrets,
  rakutenSearchQueryHash,
  toSearchItem,
} from './rakuten-search.request.js';

const sourcing = DEFAULT_SETTINGS.sourcing;
const keys = { applicationId: 'app-id-fixture-0001', accessKey: 'access-key-fixture-0001' };

describe('Item Search 요청 조립(F-BS-34, P2-02 규칙 1)', () => {
  it('② 소싱 검색: 규칙 1의 파라미터가 정확히 들어간다(키는 없다)', () => {
    const params = buildRakutenSearchParams(
      { keyword: ' アシックス 1201A019 ', page: 1 },
      sourcing,
    );
    expect(params).toEqual({
      keyword: 'アシックス 1201A019',
      page: '1',
      hits: '30',
      formatVersion: '2',
      sort: '+itemPrice',
      availability: '1',
      imageFlag: '1',
      field: '1',
      purchaseType: '0',
      carrier: '0',
      genreId: '558885',
      minPrice: String(sourcing.minPriceYen),
      NGKeyword: '中古 インソール 靴紐 シューレース 箱のみ キッズ ジュニア ベビー',
    });
    expect(params).not.toHaveProperty('applicationId');
    expect(params).not.toHaveProperty('accessKey');
  });

  it('보완 조회(itemCode·샵 코드)는 소싱 필터를 붙이지 않는다', () => {
    expect(
      buildRakutenSearchParams({ itemCode: 'shop-a:10000123', sourcingFilters: false }, sourcing),
    ).toEqual({ itemCode: 'shop-a:10000123', page: '1', hits: '30', formatVersion: '2' });
    expect(
      buildRakutenSearchParams(
        { shopCode: 'shop-e', keyword: '1201A019-108', sourcingFilters: false },
        sourcing,
      ),
    ).toEqual({
      keyword: '1201A019-108',
      shopCode: 'shop-e',
      page: '1',
      hits: '30',
      formatVersion: '2',
    });
  });

  it('호스트는 openapi.rakuten.co.jp(구 도메인 없음)이고 관문 허용 검사를 지난다', () => {
    const params = buildRakutenSearchParams({ keyword: 'asics' }, sourcing);
    const url = buildRakutenApiUrl(sourcing.rakutenApi.itemSearchUrl, keys, params);
    const parsed = new URL(url);
    expect(parsed.host).toBe('openapi.rakuten.co.jp');
    expect(parsed.pathname).toBe('/ichibams/api/IchibaItem/Search/20260701');
    expect(url).not.toContain('app.rakuten.co.jp');
    expect(() => validateExternalRequest('RAKUTEN_API', { url })).not.toThrow();
    expect(parsed.searchParams.get('applicationId')).toBe(keys.applicationId);
    expect(parsed.searchParams.get('accessKey')).toBe(keys.accessKey);
  });

  it('call_log.url_masked에는 accessKey·applicationId 원문이 없다(***)', () => {
    const url = buildRakutenApiUrl(
      sourcing.rakutenApi.itemSearchUrl,
      keys,
      buildRakutenSearchParams({ keyword: 'asics' }, sourcing),
    );
    const masked = maskUrl(url);
    expect(masked).toContain('accessKey=***');
    expect(masked).not.toContain(keys.accessKey);
    expect(masked).not.toContain(keys.applicationId);
  });

  it('캐시 사본(request_params)·해시에는 키가 없다(ck_rsc_no_secret)', () => {
    const params = {
      ...buildRakutenSearchParams({ keyword: 'asics' }, sourcing),
      applicationId: keys.applicationId,
      accessKey: keys.accessKey,
    };
    const copy = paramsWithoutSecrets(params);
    expect(copy).not.toHaveProperty('applicationId');
    expect(copy).not.toHaveProperty('accessKey');
    expect(canonicalParams(params)).not.toContain(keys.accessKey);
    // 키가 섞여도 같은 쿼리면 같은 해시
    expect(rakutenSearchQueryHash(params)).toBe(
      rakutenSearchQueryHash(buildRakutenSearchParams({ keyword: 'asics' }, sourcing)),
    );
  });

  it('캐시 키: 키 정렬 JSON의 SHA-256. 파라미터 순서는 상관없고 page만 달라도 다르다', () => {
    const p1 = buildRakutenSearchParams({ keyword: 'asics', page: 1 }, sourcing);
    const reordered = Object.fromEntries(Object.entries(p1).reverse());
    expect(rakutenSearchQueryHash(reordered)).toBe(rakutenSearchQueryHash(p1));
    expect(rakutenSearchQueryHash(p1)).toMatch(/^[0-9a-f]{64}$/);
    const p2 = buildRakutenSearchParams({ keyword: 'asics', page: 2 }, sourcing);
    expect(rakutenSearchQueryHash(p2)).not.toBe(rakutenSearchQueryHash(p1));
  });

  it('응답 Items 한 건을 꺼낸다(formatVersion=2 평탄형·1의 Item 감싸기)', () => {
    const raw = {
      itemCode: 'shop-a:10000123',
      itemName: 'アシックス',
      itemUrl: 'https://item.rakuten.co.jp/shop-a/asics/',
      itemPrice: 12000,
      itemPriceMin3: 11800,
      pointRate: 10,
      postageFlag: 0,
      genreId: '208025',
      shopName: 'ショップA',
    };
    expect(toSearchItem(raw)).toMatchObject({
      itemCode: 'shop-a:10000123',
      shopCode: 'shop-a',
      itemPrice: 12000,
      itemPriceMin3: 11800,
      pointRate: 10,
      postageFlag: 0,
      genreId: 208025,
    });
    expect(toSearchItem({ Item: raw })?.itemCode).toBe('shop-a:10000123');
    expect(toSearchItem({ itemName: '코드 없음' })).toBeNull();
  });
});
