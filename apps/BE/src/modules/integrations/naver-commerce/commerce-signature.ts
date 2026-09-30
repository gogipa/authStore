import bcrypt from 'bcryptjs';
import { COMMERCE_TOKEN_TYPE } from './commerce-endpoints.js';

/**
 * 커머스API 전자서명(PRD §8.7 RG-01, R04 A5).
 * `client_secret_sign = Base64(bcrypt(client_id + "_" + timestamp, salt = client_secret))`.
 * `client_secret` 자체가 bcrypt salt다(`$2a$04$…`). rounds 숫자를 넘겨 새 salt를 만들면 서명이 틀린다.
 * `timestamp`는 서명하는 순간의 현재 시각(13자리 ms)이고 5분만 유효하므로 부를 때마다 새로 만든다.
 */
export function signClientSecret(
  clientId: string,
  clientSecret: string,
  timestampMs: number,
): string {
  const password = `${clientId}_${timestampMs}`;
  const hashed = bcrypt.hashSync(password, clientSecret);
  return Buffer.from(hashed, 'utf8').toString('base64');
}

/** `client_secret`이 bcrypt salt 모양인지(`$2a$`·`$2b$`·`$2y$` + 두 자리 rounds + `$` + 22자) */
export function isBcryptSalt(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{22}/.test(value);
}

/** 토큰 요청 폼 필드 이름(정확히 이 다섯 개, 이 순서). `account_id`는 없다 */
export const COMMERCE_TOKEN_FORM_FIELDS = [
  'client_id',
  'timestamp',
  'grant_type',
  'client_secret_sign',
  'type',
] as const;

/**
 * 토큰 요청 본문(`application/x-www-form-urlencoded`). JSON으로 보내거나 `account_id`를 넣으면
 * 내 스토어 앱 호출이 시간당 1회로 제한된다(R04 검증 M2). 단위 테스트로 고정한다.
 */
export function buildTokenRequestForm(input: {
  clientId: string;
  timestampMs: number;
  clientSecretSign: string;
}): string {
  const params = new URLSearchParams();
  params.append('client_id', input.clientId);
  params.append('timestamp', String(input.timestampMs));
  params.append('grant_type', 'client_credentials');
  params.append('client_secret_sign', input.clientSecretSign);
  params.append('type', COMMERCE_TOKEN_TYPE);
  return params.toString();
}
