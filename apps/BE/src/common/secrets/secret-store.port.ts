import type { SecretKey } from './secret-keys.js';

/** 비밀 키 하나의 저장 상태(값·가림값 없음, 05-2 `SecretStatus`) */
export interface SecretEntryStatus {
  configured: boolean;
  /** 저장소 항목의 수정 시각. 얻지 못하면 null(05-2 listSecrets x-decision) */
  updatedAt: Date | null;
}

/**
 * 비밀정보 저장소 포트(F-BS-24, NFR-02). 값은 OS 저장소(M1: macOS 키체인)에만 둔다.
 * OS마다 구현을 바꿔 끼운다(`SECRET_STORE` 토큰). 테스트는 메모리 저장소로 바꾼다.
 * - 저장소를 열 수 없으면 503 `KEYCHAIN_UNAVAILABLE`(ApiException)을 던진다. 원 예외는 값 없이 로그에만.
 * - 읽거나 쓴 값은 `registerKnownSecret`으로 알려 둔다(로그·오류 응답·call_log에서 지우려고, secret-mask.ts).
 * 이 포트는 P1-08·P2-02·P2-04·P4-01·P4-03이 그대로 쓴다. 시그니처를 바꾸지 않는다.
 */
export interface SecretStore {
  /** 값. 없으면 null */
  get(key: SecretKey): Promise<string | null>;
  /** 넣거나 바꾼다. 같은 값 덮어쓰기는 멱등 */
  set(key: SecretKey, value: string): Promise<void>;
  /** 저장 여부와 수정 시각(값은 돌려주지 않는다) */
  status(key: SecretKey): Promise<SecretEntryStatus>;
}

export const SECRET_STORE = Symbol('SECRET_STORE');
