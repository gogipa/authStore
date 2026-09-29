import { ApiException } from '../../../common/errors/api.exception.js';
import { APP_USER_AGENT, validateExternalRequest } from './external-http.gateway.js';
import { DATALAB_REFERER } from './external-targets.js';

function rejectReason(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiException) {
      expect(e.code).toBe('EXTERNAL_REQUEST_NOT_ALLOWED');
      return (e.details as { reason: string }).reason;
    }
    throw e;
  }
  return null;
}

describe('validateExternalRequest(관문 허용 검사)', () => {
  it('앱 UA는 앱 고유 문자열이고 브라우저로 위장하지 않는다', () => {
    expect(APP_USER_AGENT).toMatch(/^autoStore\/\d+\.\d+\.\d+ \(local single-seller tool\)$/);
    expect(APP_USER_AGENT.startsWith('Mozilla/')).toBe(false);
    const { headers } = validateExternalRequest('RAKUTEN_PAGE', {
      url: 'https://item.rakuten.co.jp/shop/item/',
    });
    expect(headers['User-Agent']).toBe(APP_USER_AGENT);
  });

  it.each([
    ['https://example.com/x', 'HOST_NOT_ALLOWED'],
    ['https://app.rakuten.co.jp/services/api/IchibaItem/Search/20220601', 'HOST_NOT_ALLOWED'],
    ['https://openapi.rakuten.co.jp.evil.example/x', 'HOST_NOT_ALLOWED'],
    ['http://openapi.rakuten.co.jp/x', 'PROTOCOL_NOT_ALLOWED'],
    ['https://openapi.rakuten.co.jp:8443/x', 'PORT_NOT_ALLOWED'],
    ['https://u:p@openapi.rakuten.co.jp/x', 'CREDENTIALS_IN_URL'],
    ['not a url', 'INVALID_URL'],
  ])('RAKUTEN_API %s → %s', (url, reason) => {
    expect(rejectReason(() => validateExternalRequest('RAKUTEN_API', { url }))).toBe(reason);
  });

  it('대상의 호스트가 아니면 다른 대상의 허용 호스트여도 거부한다', () => {
    expect(
      rejectReason(() =>
        validateExternalRequest('RAKUTEN_API', { url: 'https://item.rakuten.co.jp/a/' }),
      ),
    ).toBe('HOST_NOT_ALLOWED');
  });

  it('호스트 대소문자는 가리지 않는다', () => {
    expect(() =>
      validateExternalRequest('COMMERCE_API', {
        url: 'https://API.Commerce.Naver.com/external/v1',
      }),
    ).not.toThrow();
  });

  it.each(['User-Agent', 'origin', 'Cookie', 'Host', 'X-Forwarded-For', 'Forwarded', 'X-Real-IP'])(
    '호출자가 %s 헤더를 넣으면 거부한다',
    (header) => {
      expect(
        rejectReason(() =>
          validateExternalRequest('COMMERCE_API', {
            url: 'https://api.commerce.naver.com/external/v1/x',
            headers: { [header]: 'x' },
          }),
        ),
      ).toBe('HEADER_NOT_ALLOWED');
    },
  );

  it('Referer는 DATALAB만, PRD §8.1 값만 통과한다', () => {
    expect(() =>
      validateExternalRequest('DATALAB', {
        url: 'https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver',
        headers: { Referer: DATALAB_REFERER },
      }),
    ).not.toThrow();
    expect(
      rejectReason(() =>
        validateExternalRequest('DATALAB', {
          url: 'https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver',
          headers: { Referer: 'https://datalab.naver.com/' },
        }),
      ),
    ).toBe('HEADER_NOT_ALLOWED');
    expect(
      rejectReason(() =>
        validateExternalRequest('RAKUTEN_PAGE', {
          url: 'https://item.rakuten.co.jp/a/',
          headers: { referer: DATALAB_REFERER },
        }),
      ),
    ).toBe('HEADER_NOT_ALLOWED');
  });

  it('거부 details에 URL 원문(비밀 쿼리값)을 넣지 않는다', () => {
    try {
      validateExternalRequest('RAKUTEN_API', {
        url: 'https://example.com/x?accessKey=value-should-not-leak',
      });
    } catch (e) {
      expect(JSON.stringify((e as ApiException).details)).not.toContain('value-should-not-leak');
    }
  });
});
