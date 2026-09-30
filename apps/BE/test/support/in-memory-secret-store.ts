/**
 * 메모리 비밀 저장소(테스트용 SECRET_STORE). 실제 키체인은 건드리지 않는다.
 * 실제 구현(KeychainSecretStore)의 예외 변환(→ 503 KEYCHAIN_UNAVAILABLE)·알려진 비밀 등록을 그대로 쓰도록,
 * 키체인 항목만 메모리 Map으로 바꿔 끼운다. `unavailable = true`면 모든 읽기·쓰기가 실패한다(키체인이 잠긴 것처럼).
 */
import {
  type KeychainEntry,
  KeychainSecretStore,
} from '../../src/common/secrets/keychain-secret-store.js';
import type { SecretKey } from '../../src/common/secrets/secret-keys.js';

export const IN_MEMORY_SECRET_SERVICE = 'autoStore-test-memory';

class MemoryKeychain {
  readonly items = new Map<string, { value: string; updatedAt: Date }>();
  unavailable = false;
  writes = 0;

  constructor(readonly now: () => Date) {}

  private check(): void {
    if (this.unavailable) throw new Error('User interaction is not allowed. (keychain locked)');
  }

  entry(account: string): KeychainEntry {
    return {
      getPassword: () => {
        this.check();
        return Promise.resolve(this.items.get(account)?.value ?? null);
      },
      setPassword: (password: string) => {
        this.check();
        this.writes += 1;
        this.items.set(account, { value: password, updatedAt: this.now() });
        return Promise.resolve();
      },
      deletePassword: () => {
        this.check();
        return Promise.resolve(this.items.delete(account));
      },
    };
  }
}

export class InMemorySecretStore extends KeychainSecretStore {
  private readonly memory: MemoryKeychain;

  constructor(options: { now?: () => Date; initial?: Partial<Record<SecretKey, string>> } = {}) {
    const memory = new MemoryKeychain(options.now ?? (() => new Date()));
    super({
      service: IN_MEMORY_SECRET_SERVICE,
      entryFactory: (_service, account) => memory.entry(account),
      readModifiedAt: (_service, account) =>
        Promise.resolve(memory.items.get(account)?.updatedAt ?? null),
    });
    this.memory = memory;
    for (const [key, value] of Object.entries(options.initial ?? {})) {
      if (value !== undefined) memory.items.set(key, { value, updatedAt: memory.now() });
    }
  }

  /** true면 키체인이 잠긴 것처럼 모든 읽기·쓰기가 실패한다(→ 503 KEYCHAIN_UNAVAILABLE) */
  set unavailable(on: boolean) {
    this.memory.unavailable = on;
  }

  get unavailable(): boolean {
    return this.memory.unavailable;
  }

  /** 테스트 확인용: 저장된 값(원문) */
  peek(key: SecretKey): string | undefined {
    return this.memory.items.get(key)?.value;
  }

  get writeCount(): number {
    return this.memory.writes;
  }

  /** 모두 비운다(테스트 사이) */
  reset(): void {
    this.memory.items.clear();
    this.memory.unavailable = false;
    this.memory.writes = 0;
  }
}
