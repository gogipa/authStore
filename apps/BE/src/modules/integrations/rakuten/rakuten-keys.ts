import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { secretKeysLabel, type SecretKey } from '../../../common/secrets/secret-keys.js';
import { registerKnownSecret } from '../../../common/secrets/secret-mask.js';
import type { SecretStore } from '../../../common/secrets/secret-store.port.js';

/** 라쿠텐 API 키 두 개(키체인에만 둔다, PRD §8.2 RK-01 'applicationId + accessKey 둘 다 필수') */
export const RAKUTEN_SECRET_KEYS = [
  'RAKUTEN_APPLICATION_ID',
  'RAKUTEN_ACCESS_KEY',
] as const satisfies readonly SecretKey[];

export interface RakutenKeys {
  applicationId: string;
  accessKey: string;
}

/** 빠진 키 목록(값은 읽지만 돌려주지 않는다) */
export async function missingRakutenKeys(store: SecretStore): Promise<SecretKey[]> {
  const values = await Promise.all(RAKUTEN_SECRET_KEYS.map((key) => store.get(key)));
  return RAKUTEN_SECRET_KEYS.filter((_, i) => !values[i]);
}

/** 키가 없을 때 409 SECRET_NOT_CONFIGURED(details.secretKeys) */
export function rakutenKeysMissingException(missing: readonly SecretKey[]): ApiException {
  return new ApiException('SECRET_NOT_CONFIGURED', {
    message: formatErrorMessage('SECRET_NOT_CONFIGURED', { '키 이름': secretKeysLabel(missing) }),
    details: { secretKeys: [...missing] },
  });
}

/**
 * 키 두 개를 읽는다. 하나라도 없으면 409 SECRET_NOT_CONFIGURED. 읽은 값은 로그·오류·call_log에서 지우도록 알린다
 * (registerKnownSecret, P1-07). 키체인을 열 수 없으면 저장소가 503 KEYCHAIN_UNAVAILABLE을 던진다.
 */
export async function readRakutenKeys(store: SecretStore): Promise<RakutenKeys> {
  const [applicationId, accessKey] = await Promise.all(
    RAKUTEN_SECRET_KEYS.map((key) => store.get(key)),
  );
  const missing = RAKUTEN_SECRET_KEYS.filter((_, i) => ![applicationId, accessKey][i]);
  if (missing.length > 0) throw rakutenKeysMissingException(missing);
  registerKnownSecret(applicationId);
  registerKnownSecret(accessKey);
  return { applicationId: applicationId!, accessKey: accessKey! };
}
