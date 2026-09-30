import type { components } from '@/shared/api/schema';

type SecretKey = components['schemas']['SecretKey'];
type SecretStatusList = components['schemas']['SecretStatusList'];
type CommerceAuthStatus = components['schemas']['CommerceAuthStatus'];

const SECRET_KEYS: SecretKey[] = [
  'COMMERCE_CLIENT_ID',
  'COMMERCE_CLIENT_SECRET',
  'RAKUTEN_APPLICATION_ID',
  'RAKUTEN_ACCESS_KEY',
  'KOREAEXIM_API_KEY',
  'CUSTOMS_SERVICE_KEY',
];

/** GET /secrets 응답. configured에 든 키만 저장됨(수정 시각 2026-09-27 14:00 KST) */
export function secretStatusList(configured: readonly SecretKey[] = SECRET_KEYS): SecretStatusList {
  return {
    items: SECRET_KEYS.map((secretKey) => ({
      secretKey,
      configured: configured.includes(secretKey),
      updatedAt: configured.includes(secretKey) ? '2026-09-27T05:00:00.000Z' : null,
    })),
  };
}

/** GET /auth-status 응답. 기본: 14:00(KST) 발급 → 17:00 만료(보드 '14:00 발급 · 16:30에 새로 받음') */
export function authStatus(overrides: Partial<CommerceAuthStatus> = {}): CommerceAuthStatus {
  return {
    secretsConfigured: true,
    tokenValid: true,
    tokenExpiresAt: '2026-09-27T08:00:00.000Z',
    lastCheckedAt: '2026-09-27T05:00:00.000Z',
    lastSucceeded: true,
    lastHttpStatus: 200,
    lastErrorCode: null,
    causeCategory: null,
    lastTraceId: 'fixture-trace-token-200',
    ...overrides,
  };
}

/** 마지막 발급이 실패한 상태(원인 분류 포함) */
export function failedAuthStatus(
  causeCategory: NonNullable<CommerceAuthStatus['causeCategory']>,
  errorCode = 'GW.AUTHN',
): CommerceAuthStatus {
  return authStatus({
    tokenValid: false,
    tokenExpiresAt: null,
    lastSucceeded: false,
    lastHttpStatus: 401,
    lastErrorCode: errorCode,
    causeCategory,
    lastTraceId: 'fixture-trace-401-authn',
  });
}
