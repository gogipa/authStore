/**
 * 라쿠텐 API 오류 한국어 안내(F-SO-03, PRD §8.2 RK-01 '오류 메시지를 한국어 안내로 바꾼다'). 순수 함수.
 * 응답 본문 글자로 원인을 가른다(오류 JSON 모양은 M0 S2에서 확인 — 글자 포함으로 보면 모양이 달라도 맞는다).
 *
 * | 경우 | errorCode(step_run.error_code·call_log.error_code) |
 * |---|---|
 * | 400 'must be present'(키 누락) | RAKUTEN_KEY_MISSING |
 * | 403 'Invalid Access Key'(키 오류) | RAKUTEN_INVALID_ACCESS_KEY |
 * | 403 CLIENT_IP_NOT_ALLOWED(허용 IP 아님) | CLIENT_IP_NOT_ALLOWED(원래 코드 그대로) |
 * | 429(한도 초과) | RAKUTEN_RATE_LIMITED |
 * | 503(점검) | RAKUTEN_UNAVAILABLE |
 * | 그 밖 2xx 아님 | RAKUTEN_HTTP_<상태> |
 * 코드 이름은 Proposed(05-1 §7.3 P2-02 구현 결정). 비동기 ② 실행이면 step_run FAILED(EXTERNAL_API) + 이 코드·문구로 남는다.
 */

export interface RakutenApiErrorInfo {
  errorCode: string;
  /** 한국어 안내(키 값·URL 없음) */
  message: string;
  httpStatus: number;
}

export const RAKUTEN_API_ERROR_MESSAGES = {
  RAKUTEN_KEY_MISSING:
    '라쿠텐 API 키(applicationId·accessKey)가 빠졌습니다. 시스템 상태 화면에서 두 키를 모두 넣어 주세요.',
  RAKUTEN_INVALID_ACCESS_KEY:
    '라쿠텐 accessKey가 맞지 않습니다. 라쿠텐 개발자 사이트에서 키를 확인해 시스템 상태 화면에 다시 넣어 주세요.',
  CLIENT_IP_NOT_ALLOWED:
    '이 PC의 인터넷 주소(IP)가 라쿠텐 앱의 허용 IP가 아닙니다. 라쿠텐 개발자 사이트에서 허용 IP를 등록해 주세요.',
  RAKUTEN_RATE_LIMITED: '라쿠텐 API 호출 한도를 넘었습니다. 잠시 뒤 다시 실행해 주세요.',
  RAKUTEN_UNAVAILABLE:
    '라쿠텐 API가 점검 중이거나 잠시 쓸 수 없습니다. 잠시 뒤 다시 실행해 주세요.',
  RAKUTEN_INVALID_RESPONSE: '라쿠텐 API 응답을 읽지 못했습니다. 잠시 뒤 다시 실행해 주세요.',
} as const;

export function mapRakutenApiError(httpStatus: number, bodyText: string): RakutenApiErrorInfo {
  const text = bodyText.toLowerCase();
  const info = (errorCode: keyof typeof RAKUTEN_API_ERROR_MESSAGES): RakutenApiErrorInfo => ({
    errorCode,
    message: RAKUTEN_API_ERROR_MESSAGES[errorCode],
    httpStatus,
  });
  if (text.includes('client_ip_not_allowed')) return info('CLIENT_IP_NOT_ALLOWED');
  if (httpStatus === 400 && text.includes('must be present')) return info('RAKUTEN_KEY_MISSING');
  if (httpStatus === 403 && text.includes('invalid access key')) {
    return info('RAKUTEN_INVALID_ACCESS_KEY');
  }
  if (httpStatus === 429) return info('RAKUTEN_RATE_LIMITED');
  if (httpStatus === 503) return info('RAKUTEN_UNAVAILABLE');
  return {
    errorCode: `RAKUTEN_HTTP_${httpStatus}`,
    message: `라쿠텐 API가 오류를 돌려주었습니다(HTTP ${httpStatus}). 잠시 뒤 다시 실행해 주세요.`,
    httpStatus,
  };
}

/**
 * 라쿠텐 API가 2xx가 아닌 답을 줬다(다시 보내기 뒤에도). 부르는 쪽(② 실행기)이 FAILED(EXTERNAL_API, errorCode, message)로
 * 바꾼다. 동기 API라면 502 EXTERNAL_API_ERROR(details.target=RAKUTEN_API·reason=errorCode)로 바꾼다.
 */
export class RakutenApiError extends Error {
  readonly errorCode: string;
  readonly userMessage: string;
  readonly httpStatus: number;

  constructor(info: RakutenApiErrorInfo) {
    super(`${info.errorCode}(HTTP ${info.httpStatus})`);
    this.name = 'RakutenApiError';
    this.errorCode = info.errorCode;
    this.userMessage = info.message;
    this.httpStatus = info.httpStatus;
  }
}

export function isRakutenApiError(error: unknown): error is RakutenApiError {
  return error instanceof RakutenApiError;
}
