import { rakutenSearchFixture } from '../../../../test/support/rakuten-fixture.adapters.js';
import { mapRakutenApiError, RAKUTEN_API_ERROR_MESSAGES } from './rakuten-api-error.mapper.js';

describe('라쿠텐 오류 한국어 안내(F-SO-03, P2-02 규칙 3)', () => {
  it.each([
    [
      400,
      'err-400-missing-key.json',
      'RAKUTEN_KEY_MISSING',
      '키(applicationId·accessKey)가 빠졌습니다',
    ],
    [
      403,
      'err-403-invalid-access-key.json',
      'RAKUTEN_INVALID_ACCESS_KEY',
      'accessKey가 맞지 않습니다',
    ],
    [403, 'err-403-client-ip.json', 'CLIENT_IP_NOT_ALLOWED', '허용 IP가 아닙니다'],
    [429, 'status-429.json', 'RAKUTEN_RATE_LIMITED', '호출 한도를 넘었습니다'],
    [503, 'status-503.json', 'RAKUTEN_UNAVAILABLE', '점검 중'],
  ])('%s %s → %s', (status, file, code, phrase) => {
    const info = mapRakutenApiError(status, rakutenSearchFixture(file));
    expect(info.errorCode).toBe(code);
    expect(info.httpStatus).toBe(status);
    expect(info.message).toContain(phrase);
    // 한국어 문구(원문 영어·키 값 없음)
    expect(info.message).toMatch(/[가-힣]/);
    expect(info.message).not.toContain('must be present');
  });

  it('원인을 모르는 오류는 RAKUTEN_HTTP_<상태> + 일반 문구', () => {
    expect(mapRakutenApiError(500, 'oops')).toMatchObject({
      errorCode: 'RAKUTEN_HTTP_500',
      httpStatus: 500,
    });
    // 400이어도 'must be present'가 없으면 키 누락이 아니다
    expect(
      mapRakutenApiError(400, '{"errors":{"errorMessage":"keyword is not valid"}}').errorCode,
    ).toBe('RAKUTEN_HTTP_400');
  });

  it('문구 표에 네 경우(+응답 해석 실패)가 모두 있다', () => {
    expect(Object.keys(RAKUTEN_API_ERROR_MESSAGES)).toEqual([
      'RAKUTEN_KEY_MISSING',
      'RAKUTEN_INVALID_ACCESS_KEY',
      'CLIENT_IP_NOT_ALLOWED',
      'RAKUTEN_RATE_LIMITED',
      'RAKUTEN_UNAVAILABLE',
      'RAKUTEN_INVALID_RESPONSE',
    ]);
  });
});
