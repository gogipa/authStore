/**
 * 키체인에 두는 비밀 키 이름(허용 목록, 05-2 `SecretKey` · x-decision §7.5-44). 순서는 05-2 enum 그대로다.
 * `GET /secrets`는 이 순서로 6개를 모두 준다. 목록 밖 이름은 404 `SECRET_KEY_UNKNOWN`.
 */
export const SECRET_KEYS = [
  'COMMERCE_CLIENT_ID',
  'COMMERCE_CLIENT_SECRET',
  'RAKUTEN_APPLICATION_ID',
  'RAKUTEN_ACCESS_KEY',
  'KOREAEXIM_API_KEY',
  'CUSTOMS_SERVICE_KEY',
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

/** 커머스API 토큰 발급에 필요한 키 둘. 둘 중 하나라도 바꾸면 토큰 캐시를 비운다(05-2 saveSecret) */
export const COMMERCE_SECRET_KEYS = [
  'COMMERCE_CLIENT_ID',
  'COMMERCE_CLIENT_SECRET',
] as const satisfies readonly SecretKey[];
export type CommerceSecretKey = (typeof COMMERCE_SECRET_KEYS)[number];

export function isSecretKey(value: unknown): value is SecretKey {
  return typeof value === 'string' && (SECRET_KEYS as readonly string[]).includes(value);
}

export function isCommerceSecretKey(value: unknown): value is CommerceSecretKey {
  return typeof value === 'string' && (COMMERCE_SECRET_KEYS as readonly string[]).includes(value);
}

/**
 * 오류 문구 `{키 이름}` 자리에 넣는 이름(Proposed, P1-07). 화면(SCR-11 키 입력 행)과 같은 말을 쓴다.
 * 끝을 '키'로 맞춰 조사('이/가')가 자연스럽게 붙게 했다(예: '커머스API client_secret 키가 아직 없습니다').
 */
export const SECRET_KEY_LABEL: Readonly<Record<SecretKey, string>> = {
  COMMERCE_CLIENT_ID: '커머스API client_id 키',
  COMMERCE_CLIENT_SECRET: '커머스API client_secret 키',
  RAKUTEN_APPLICATION_ID: '라쿠텐 applicationId 키',
  RAKUTEN_ACCESS_KEY: '라쿠텐 accessKey 키',
  KOREAEXIM_API_KEY: '환율 API 키',
  CUSTOMS_SERVICE_KEY: '관세청 과세환율 키',
};

/** 여러 키가 빠졌을 때의 `{키 이름}`: '커머스API client_id·client_secret 키'처럼 묶는다 */
export function secretKeysLabel(keys: readonly SecretKey[]): string {
  if (keys.length === 1) return SECRET_KEY_LABEL[keys[0]!];
  if (keys.length === 2 && keys.every(isCommerceSecretKey)) {
    return '커머스API client_id·client_secret 키';
  }
  return keys.map((k) => SECRET_KEY_LABEL[k]).join(', ');
}
