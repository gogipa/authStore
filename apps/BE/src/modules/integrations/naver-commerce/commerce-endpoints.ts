/**
 * 네이버 커머스API 주소·토큰 규격 상수(PRD §8.7 RG-01, R04 A4~A7·A13).
 * 운영 호스트는 하나뿐이고 샌드박스가 없다. 허용 목록(external-targets.ts COMMERCE_API)과 같은 호스트다.
 */
export const COMMERCE_API_BASE_URL = 'https://api.commerce.naver.com/external';

/** 토큰 발급 경로(`POST {base}/v1/oauth2/token`, form) */
export const COMMERCE_TOKEN_PATH = '/v1/oauth2/token';

/** 내 스토어 애플리케이션 토큰 종류. `account_id`는 넣지 않는다(SELLER 전용) */
export const COMMERCE_TOKEN_TYPE = 'SELF';

/** 토큰 유효시간 기본값(`expires_in`이 없을 때, 3시간) */
export const COMMERCE_TOKEN_DEFAULT_TTL_SECONDS = 10_800;

/** 남은 시간이 이 값 이하면 쓰기 전에 새로 받는다(만료 30분 전, F-BS-47) */
export const COMMERCE_TOKEN_REFRESH_BEFORE_MS = 30 * 60 * 1000;

/** 401 `GW.AUTHN` 뒤 토큰을 다시 받아 원 요청을 다시 보내는 횟수(문서에 없음 → Proposed 1회) */
export const COMMERCE_AUTHN_RETRY_LIMIT = 1;

/** 응답 추적 헤더(call_log.trace_id) */
export const COMMERCE_TRACE_HEADER = 'GNCP-GW-Trace-ID';

/** 토큰이 무효·만료됐다는 게이트웨이 코드(401) */
export const COMMERCE_AUTHN_ERROR_CODE = 'GW.AUTHN';
/** 등록하지 않은 IP에서 호출(403, R04 A8) */
export const COMMERCE_IP_NOT_ALLOWED_CODE = 'GW.IP_NOT_ALLOWED';
