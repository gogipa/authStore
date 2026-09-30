import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { AsyncEntry } from '@napi-rs/keyring';
import { ApiException } from '../errors/api.exception.js';
import type { SecretKey } from './secret-keys.js';
import { registerKnownSecret, scrubKnownSecrets, SECRET_MASK } from './secret-mask.js';
import type { SecretEntryStatus, SecretStore } from './secret-store.port.js';

/**
 * 키체인 항목의 서비스 이름(Proposed, P1-07). 계정(account) 칸에 키 이름(`COMMERCE_CLIENT_ID` …)이 들어간다.
 * 개발·운영이 같은 항목을 쓴다(한 PC에 한 스토어, 03-2 §5).
 */
export const KEYCHAIN_SERVICE_NAME = 'autoStore';

/** 키체인 항목 하나(@napi-rs/keyring `AsyncEntry`의 쓰는 부분). 테스트는 가짜를 넣는다 */
export interface KeychainEntry {
  getPassword(): Promise<string | null | undefined>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}

export type KeychainEntryFactory = (service: string, account: string) => KeychainEntry;

/** 항목 수정 시각을 읽는 함수. 못 읽으면 null */
export type KeychainModifiedAtReader = (service: string, account: string) => Promise<Date | null>;

export interface KeychainSecretStoreOptions {
  /** 서비스 이름(실제 키체인 테스트는 임시 이름을 쓴다) */
  service?: string;
  entryFactory?: KeychainEntryFactory;
  readModifiedAt?: KeychainModifiedAtReader;
}

const defaultEntryFactory: KeychainEntryFactory = (service, account) =>
  new AsyncEntry(service, account);

const execFileAsync = promisify(execFile);

/**
 * `security find-generic-password -s <서비스> -a <계정>` 출력의 `"mdat"<timedate>=… "YYYYMMDDhhmmssZ\000"`에서
 * 수정 시각(UTC)을 읽는다. 없거나 모양이 다르면 null.
 */
export function parseKeychainModifiedAt(output: string): Date | null {
  const m = /"mdat"<timedate>=[^"\n]*"(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z/.exec(output);
  if (!m) return null;
  const [y = NaN, mo = NaN, d = NaN, h = NaN, mi = NaN, s = NaN] = m.slice(1).map(Number);
  const ms = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * macOS에서 항목 수정 시각을 읽는다(05-2 listSecrets x-decision: 얻지 못하면 null).
 * @napi-rs/keyring은 항목 속성을 주지 않아 `/usr/bin/security`를 셸 없이 부른다. `-g`·`-w`를 주지 않으므로
 * 출력에 비밀값이 없다(속성만). macOS가 아니거나 실패하면 null.
 */
export const readKeychainModifiedAt: KeychainModifiedAtReader = async (service, account) => {
  if (process.platform !== 'darwin') return null;
  try {
    const { stdout } = await execFileAsync(
      '/usr/bin/security',
      ['find-generic-password', '-s', service, '-a', account],
      { timeout: 5_000, maxBuffer: 64 * 1024 },
    );
    return parseKeychainModifiedAt(stdout);
  } catch {
    return null;
  }
};

/**
 * `SecretStore`의 M1 구현: OS 자격 증명 저장소(macOS 키체인)에 `@napi-rs/keyring`으로 읽고 쓴다(F-BS-24).
 * - 모든 저장소 예외를 503 `KEYCHAIN_UNAVAILABLE`로 바꾼다. 원 예외는 값 없이(이름·가린 메시지만) 로그에 남긴다.
 * - 읽거나 쓴 값은 알려진 비밀로 올린다(secret-mask.ts).
 * - 처음 쓸 때 macOS가 키체인 접근을 물을 수 있다. 자동 테스트는 이 클래스를 쓰지 않는다(메모리 저장소로 바꾼다).
 */
export class KeychainSecretStore implements SecretStore {
  private readonly logger = new Logger(KeychainSecretStore.name);
  private readonly service: string;
  private readonly entryFactory: KeychainEntryFactory;
  private readonly readModifiedAt: KeychainModifiedAtReader;

  constructor(options: KeychainSecretStoreOptions = {}) {
    this.service = options.service ?? KEYCHAIN_SERVICE_NAME;
    this.entryFactory = options.entryFactory ?? defaultEntryFactory;
    this.readModifiedAt = options.readModifiedAt ?? readKeychainModifiedAt;
  }

  async get(key: SecretKey): Promise<string | null> {
    const value = await this.guard('read', key, undefined, () =>
      this.entryFactory(this.service, key).getPassword(),
    );
    if (typeof value !== 'string' || value.length === 0) return null;
    registerKnownSecret(value);
    return value;
  }

  async set(key: SecretKey, value: string): Promise<void> {
    registerKnownSecret(value);
    await this.guard('write', key, value, () =>
      this.entryFactory(this.service, key).setPassword(value),
    );
  }

  async status(key: SecretKey): Promise<SecretEntryStatus> {
    const value = await this.get(key);
    if (value === null) return { configured: false, updatedAt: null };
    return { configured: true, updatedAt: await this.readModifiedAt(this.service, key) };
  }

  /** 항목을 지운다(실제 키체인 테스트 정리용. API로는 내지 않는다) */
  async delete(key: SecretKey): Promise<boolean> {
    return this.guard('delete', key, undefined, () =>
      this.entryFactory(this.service, key).deletePassword(),
    );
  }

  private async guard<T>(
    op: 'read' | 'write' | 'delete',
    key: SecretKey,
    value: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.logger.warn(`키체인 ${op} 실패(${key}): ${describeError(e, value)}`);
      throw new ApiException('KEYCHAIN_UNAVAILABLE', { details: { secretKey: key } });
    }
  }
}

/** 예외 한 줄 요약. 비밀값(쓰려던 값·알려진 비밀)은 지운다 */
function describeError(e: unknown, value: string | undefined): string {
  const err = e instanceof Error ? e : new Error(String(e));
  let text = `${err.name}: ${err.message}`;
  if (value) text = text.split(value).join(SECRET_MASK);
  return scrubKnownSecrets(text).slice(0, 300);
}
