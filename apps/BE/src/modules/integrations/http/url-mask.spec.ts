import { CALL_LOG_SECRET_RE, maskUrl, URL_MASKED_MAX } from './url-mask.js';

/** ck_call_log_no_secret과 같은 식(대소문자 무시) */
const CHECK_RE = /(accesskey|applicationid|client_secret|authkey|servicekey)=[^*&]/i;

describe('maskUrl', () => {
  it('라쿠텐 검색 URL의 applicationId·accessKey를 가리고 나머지는 그대로 둔다', () => {
    const masked = maskUrl(
      'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?applicationId=abc&accessKey=xyz&keyword=a',
    );
    expect(masked).toBe(
      'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?applicationId=***&accessKey=***&keyword=a',
    );
    expect(masked).not.toMatch(CHECK_RE);
  });

  it.each([
    'https://h.example/a?authkey=K1&searchdate=20260927&data=AP01',
    'https://h.example/a?serviceKey=S%2B1&aplyBgnDt=20260927',
    'https://h.example/a?client_secret=zz&client_secret_sign=yy&x=1',
    'https://h.example/a?AccessKey=A&APPLICATIONID=B',
    'https://h.example/a?x=1&accessKey=&y=2',
    'https://h.example/p/accesskey=inpath/q?x=1',
  ])('%s → CHECK 식에 걸리지 않는다', (url) => {
    expect(maskUrl(url)).not.toMatch(CHECK_RE);
    expect(CALL_LOG_SECRET_RE.test(maskUrl(url))).toBe(false);
  });

  it('비밀이 아닌 값은 인코딩까지 그대로 둔다', () => {
    const url = 'https://item.rakuten.co.jp/shop/item-1/?s-id=top_normal%20x&l2-id=a+b';
    expect(maskUrl(url)).toBe(url);
  });

  it('URL 속 사용자 정보와 fragment는 뺀다', () => {
    expect(maskUrl('https://user:pass@h.example/a?b=1#frag')).toBe('https://h.example/a?b=1');
  });

  it('token·password가 들어간 이름도 가린다', () => {
    expect(maskUrl('https://h.example/a?access_token=t&pageToken=p&password=x')).toBe(
      'https://h.example/a?access_token=***&pageToken=***&password=***',
    );
  });

  it(`${URL_MASKED_MAX}자를 넘으면 자른다(varchar(2048))`, () => {
    const url = `https://h.example/?q=${'a'.repeat(3000)}`;
    expect(maskUrl(url)).toHaveLength(URL_MASKED_MAX);
  });
});
