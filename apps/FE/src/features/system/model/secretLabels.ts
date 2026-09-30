import type { components } from '@/shared/api/schema';

export type SecretKey = components['schemas']['SecretKey'];
export type SecretStatus = components['schemas']['SecretStatus'];
export type SecretStatusList = components['schemas']['SecretStatusList'];

/** 키 입력 행 순서(05-2 SecretKey 순서 = System 보드 순서 + 6번째 관세청 키) */
export const SECRET_KEYS = [
  'COMMERCE_CLIENT_ID',
  'COMMERCE_CLIENT_SECRET',
  'RAKUTEN_APPLICATION_ID',
  'RAKUTEN_ACCESS_KEY',
  'KOREAEXIM_API_KEY',
  'CUSTOMS_SERVICE_KEY',
] as const satisfies readonly SecretKey[];

export interface SecretLabel {
  /** 앞 글자(보드: '커머스API', '라쿠텐', '환율 API 키') */
  service: string;
  /** mono 글자(보드: `client_id` …). 없으면 service만 */
  name?: string;
}

/**
 * 키 → 보드 문구(System.dc.html '키 입력'). `CUSTOMS_SERVICE_KEY` 행은 보드에 없어
 * '관세청 과세환율 키'로 정했다(Proposed, 화면시안_명세 §6 SCR-11).
 */
export const SECRET_LABEL: Readonly<Record<SecretKey, SecretLabel>> = {
  COMMERCE_CLIENT_ID: { service: '커머스API', name: 'client_id' },
  COMMERCE_CLIENT_SECRET: { service: '커머스API', name: 'client_secret' },
  RAKUTEN_APPLICATION_ID: { service: '라쿠텐', name: 'applicationId' },
  RAKUTEN_ACCESS_KEY: { service: '라쿠텐', name: 'accessKey' },
  KOREAEXIM_API_KEY: { service: '환율 API 키' },
  CUSTOMS_SERVICE_KEY: { service: '관세청 과세환율 키' },
};

/** 한 줄 글자('커머스API client_id'). 버튼 이름('… 다시 넣기')·입력칸 라벨에 쓴다 */
export function secretLabelText(key: SecretKey): string {
  const { service, name } = SECRET_LABEL[key];
  return name ? `${service} ${name}` : service;
}

export function isSecretKey(value: unknown): value is SecretKey {
  return typeof value === 'string' && (SECRET_KEYS as readonly string[]).includes(value);
}

/** 키 입력 행의 id(주소 조각 `#secret-<키>`로 바로 연다) */
export function secretRowId(key: SecretKey): string {
  return `secret-${key}`;
}

/** 시스템 상태 화면의 '키 입력' 패널로 가는 주소(키를 주면 그 행 입력칸을 연다) */
export function systemSecretPath(key?: SecretKey): string {
  return key ? `/system#${secretRowId(key)}` : '/system#keys';
}

/** 주소 조각(`#secret-COMMERCE_CLIENT_SECRET`) → 키. 아니면 null */
export function secretKeyFromHash(hash: string): SecretKey | null {
  const m = /^#secret-([A-Z_]+)$/.exec(hash);
  return m && isSecretKey(m[1]) ? m[1] : null;
}
