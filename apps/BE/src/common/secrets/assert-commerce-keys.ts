import { ApiException } from '../errors/api.exception.js';
import { formatErrorMessage } from '../errors/error-codes.js';
import { COMMERCE_SECRET_KEYS, secretKeysLabel, type CommerceSecretKey } from './secret-keys.js';
import type { SecretStore } from './secret-store.port.js';

/**
 * 커머스API 키(client_id·client_secret)가 키체인에 있는지(값은 쓰지 않는다). 없으면 409 SECRET_NOT_CONFIGURED
 * (`details.secretKeys`). P3-05 ⑦ 시작 전·태그 편집 받기 전에 처음 썼고(Proposed: 실행 실패가 아니라 409로 막는다), P4-01 ⑧ 업로드
 * 시작 전(05-1 표 A UPLOAD 행)도 같은 검사를 쓰도록 common으로 옮겼다(tags는 다시 내보낸다). 키체인 오류는 저장소가 503
 * KEYCHAIN_UNAVAILABLE로 던진다.
 */
export async function assertCommerceKeys(secrets: SecretStore): Promise<void> {
  const values = await Promise.all(COMMERCE_SECRET_KEYS.map((key) => secrets.get(key)));
  const missing: CommerceSecretKey[] = COMMERCE_SECRET_KEYS.filter((_, i) => !values[i]);
  if (missing.length === 0) return;
  throw new ApiException('SECRET_NOT_CONFIGURED', {
    message: formatErrorMessage('SECRET_NOT_CONFIGURED', { '키 이름': secretKeysLabel(missing) }),
    details: { secretKeys: missing },
  });
}
