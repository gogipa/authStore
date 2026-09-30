import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { COMMERCE_IP_NOT_ALLOWED_CODE } from './commerce-endpoints.js';

/** 커머스API 인증 실패 원인(05-2 `CommerceAuthCauseCategory`, F-SY-02, US-27 AC2) */
export const COMMERCE_AUTH_CAUSE_CATEGORIES = [
  'DORMANT_AUTH',
  'SECRET_CHANGED',
  'STORE_SUSPENDED',
  'IP_NOT_ALLOWED',
  'UNKNOWN',
] as const;
export type CommerceAuthCauseCategory = (typeof COMMERCE_AUTH_CAUSE_CATEGORIES)[number];

/** 오류 문구 `{원인}` 자리(SCR-11 인증 상태 패널의 원인 이름과 같다) */
export const COMMERCE_AUTH_CAUSE_LABEL: Readonly<Record<CommerceAuthCauseCategory, string>> = {
  DORMANT_AUTH: '통합매니저 인증 휴면',
  SECRET_CHANGED: '시크릿 변경',
  STORE_SUSPENDED: '스토어 이용정지',
  IP_NOT_ALLOWED: '호출 IP 불일치',
  UNKNOWN: '원인 확인 필요',
};

/** 앱이 스스로 붙이는 오류 코드(커머스API가 준 코드가 아님, call_log에 없는 실패) */
export const CLIENT_SECRET_FORMAT_INVALID = 'CLIENT_SECRET_FORMAT_INVALID';

/**
 * 원인 분류표(Proposed, P1-07 — 05-3 `COMMERCE_AUTH_FAILED` 행에 적음). 분류 근거는 call_log.error_code다.
 * 확인된 것은 403 `GW.IP_NOT_ALLOWED`(R04 A8) 하나뿐이다. 나머지 코드 이름은 공식 문서에 없어
 * M0 S3(실제 앱 등록) 전 추정이다. 위에서부터 처음 맞는 줄을 쓰고, 맞는 줄이 없으면 UNKNOWN.
 */
export const COMMERCE_AUTH_CAUSE_RULES: readonly {
  category: Exclude<CommerceAuthCauseCategory, 'UNKNOWN'>;
  /** 이 HTTP 상태일 때만(없으면 상태 무관) */
  statuses?: readonly number[];
  /** 코드가 정확히 이 중 하나 */
  codes?: readonly string[];
  /** 코드에 이 말이 들어 있음(대소문자 무시) */
  includes?: readonly string[];
  basis: string;
}[] = [
  {
    category: 'IP_NOT_ALLOWED',
    codes: [COMMERCE_IP_NOT_ALLOWED_CODE, 'CLIENT_IP_NOT_ALLOWED'],
    basis: 'R04 A8 공식(GW.IP_NOT_ALLOWED) · 05-2 getAuthStatus 예시(CLIENT_IP_NOT_ALLOWED)',
  },
  {
    category: 'DORMANT_AUTH',
    includes: ['DORMANT', 'INACTIVE'],
    basis: '추정: 연 2회 통합매니저 인증을 놓친 휴면 앱(R04 A10). 코드 이름은 M0 S3에서 확인',
  },
  {
    category: 'STORE_SUSPENDED',
    includes: ['SUSPEND', 'BLOCKED_SELLER', 'SELLER_BLOCKED'],
    basis: '추정: 이용정지 스토어는 토큰 발급 거부(R04 검증 M6). 코드 이름은 M0 S3에서 확인',
  },
  {
    category: 'SECRET_CHANGED',
    codes: [CLIENT_SECRET_FORMAT_INVALID],
    basis: '앱 판단: 저장한 client_secret이 bcrypt salt 모양이 아님(서명을 만들 수 없음)',
  },
  {
    category: 'SECRET_CHANGED',
    statuses: [400, 401],
    codes: ['GW.AUTHN'],
    includes: ['INVALID_CLIENT', 'SECRET', 'SIGN'],
    basis:
      '추정: 발급 요청의 서명이 거절됨 = 휴면 해제 뒤 바뀐 시크릿(R04 A10). 401 GW.AUTHN 재발급 뒤에도 401',
  },
];

function matches(
  rule: (typeof COMMERCE_AUTH_CAUSE_RULES)[number],
  status: number | null,
  code: string,
): boolean {
  if (rule.statuses && (status === null || !rule.statuses.includes(status))) return false;
  const upper = code.toUpperCase();
  if (rule.codes?.some((c) => c.toUpperCase() === upper)) return true;
  return rule.includes?.some((part) => upper.includes(part)) ?? false;
}

/** (HTTP 상태, 오류 코드) → 원인. 모르면 UNKNOWN */
export function classifyCommerceAuthCause(
  httpStatus: number | null | undefined,
  errorCode: string | null | undefined,
): CommerceAuthCauseCategory {
  if (!errorCode) return 'UNKNOWN';
  const status = httpStatus ?? null;
  for (const rule of COMMERCE_AUTH_CAUSE_RULES) {
    if (matches(rule, status, errorCode)) return rule.category;
  }
  return 'UNKNOWN';
}

/** 502 `COMMERCE_AUTH_FAILED`(details.causeCategory·errorCode·httpStatus·traceId). 비밀값은 넣지 않는다 */
export function commerceAuthFailed(input: {
  causeCategory: CommerceAuthCauseCategory;
  errorCode: string;
  httpStatus: number | null;
  traceId: string | null;
}): ApiException {
  return new ApiException('COMMERCE_AUTH_FAILED', {
    message: formatErrorMessage('COMMERCE_AUTH_FAILED', {
      원인: COMMERCE_AUTH_CAUSE_LABEL[input.causeCategory],
    }),
    details: {
      target: 'COMMERCE_API',
      causeCategory: input.causeCategory,
      errorCode: input.errorCode,
      httpStatus: input.httpStatus,
      traceId: input.traceId,
    },
  });
}
