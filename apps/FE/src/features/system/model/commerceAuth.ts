import type { components } from '@/shared/api/schema';
import type { ChipTone, IconName } from '@/shared/ui';
import type { SecretKey } from './secretLabels';

export type CommerceAuthStatus = components['schemas']['CommerceAuthStatus'];
export type CommerceAuthCauseCategory = components['schemas']['CommerceAuthCauseCategory'];

/** 토큰을 만료 몇 분 전에 새로 받는지(BE F-BS-47 규칙과 같은 값, 화면 표시용) */
export const TOKEN_REFRESH_BEFORE_MS = 30 * 60 * 1000;

export interface CauseGuide {
  category: Exclude<CommerceAuthCauseCategory, 'UNKNOWN'>;
  /** dt(보드 문구 그대로) */
  term: string;
  /** dd 글(링크면 linkTo 키 행으로) */
  detail: string;
  /** 이 안내가 키 입력 행으로 이어지면 그 키(보드: 'client_secret 다시 넣기') */
  reenterKey?: SecretKey;
}

/** 원인 네 가지 안내(System.dc.html '다시 받기도 실패하면 원인별로 이렇게 안내합니다', F-SY-02) */
export const CAUSE_GUIDES: readonly CauseGuide[] = [
  { category: 'DORMANT_AUTH', term: '통합매니저 인증 휴면', detail: '커머스API센터에서 다시 인증' },
  {
    category: 'SECRET_CHANGED',
    term: '시크릿 변경',
    detail: 'client_secret 다시 넣기',
    reenterKey: 'COMMERCE_CLIENT_SECRET',
  },
  { category: 'STORE_SUSPENDED', term: '스토어 이용정지', detail: '스마트스토어센터에서 확인' },
  { category: 'IP_NOT_ALLOWED', term: '호출 IP 불일치', detail: '등록 IP 확인 · 공인 IP 칸' },
];

export type TokenState = 'ok' | 'no-keys' | 'failed' | 'not-issued';

/**
 * 토큰 칩 상태: 토큰이 살아 있으면 '정상', 커머스 키가 없으면 '키 없음', 마지막 발급이 실패했으면 '실패',
 * 그 밖은 '받기 전'(처음 부를 때 받는다). 보드는 '정상'만 그렸다(나머지 글자·색은 Proposed).
 */
export function tokenState(status: CommerceAuthStatus): TokenState {
  if (status.tokenValid) return 'ok';
  if (!status.secretsConfigured) return 'no-keys';
  if (status.lastSucceeded === false) return 'failed';
  return 'not-issued';
}

export const TOKEN_STATE_CHIP: Readonly<
  Record<TokenState, { tone: ChipTone; icon: IconName; label: string }>
> = {
  ok: { tone: 'done', icon: 'check', label: '정상' },
  'no-keys': { tone: 'waiting', icon: 'alert', label: '키 없음' },
  failed: { tone: 'failed', icon: 'alert', label: '실패' },
  'not-issued': { tone: 'idle', icon: 'circle', label: '받기 전' },
};

/** 발급 시각(마지막 발급 호출이 성공이면 그 시각)과 새로 받을 시각(만료 30분 전). 없으면 null */
export function tokenTimes(status: CommerceAuthStatus): {
  issuedAt: string | null;
  refreshAt: string | null;
} {
  if (!status.tokenValid || !status.tokenExpiresAt) return { issuedAt: null, refreshAt: null };
  const expires = new Date(status.tokenExpiresAt).getTime();
  return {
    issuedAt: status.lastSucceeded === true ? status.lastCheckedAt : null,
    refreshAt: Number.isNaN(expires)
      ? null
      : new Date(expires - TOKEN_REFRESH_BEFORE_MS).toISOString(),
  };
}

/**
 * 다른 화면의 커머스API 인증 실패 안내를 시스템 상태 화면 키 입력으로 잇는 오류 코드(규칙 14).
 * 단계 실행 실패(step_run.error_code)·API 오류 봉투 code에 쓴다.
 */
export const COMMERCE_KEY_ERROR_CODES = ['COMMERCE_AUTH_FAILED', 'SECRET_NOT_CONFIGURED'] as const;

export function isCommerceKeyErrorCode(code: string | null | undefined): boolean {
  return (COMMERCE_KEY_ERROR_CODES as readonly string[]).includes(code ?? '');
}
