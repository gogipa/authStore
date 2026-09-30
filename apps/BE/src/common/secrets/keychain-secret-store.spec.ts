import { Logger } from '@nestjs/common';
import { ApiException } from '../errors/api.exception.js';
import {
  type KeychainEntry,
  KeychainSecretStore,
  parseKeychainModifiedAt,
} from './keychain-secret-store.js';
import { clearKnownSecrets, scrubKnownSecrets } from './secret-mask.js';

const VALUE = 'fake-keychain-value-0001';

function memoryFactory(fail: () => Error | null) {
  const items = new Map<string, string>();
  const factory = (service: string, account: string): KeychainEntry => {
    const id = `${service}/${account}`;
    const guard = () => {
      const e = fail();
      if (e) throw e;
    };
    return {
      getPassword: () => {
        guard();
        return Promise.resolve(items.get(id) ?? null);
      },
      setPassword: (v) => {
        guard();
        items.set(id, v);
        return Promise.resolve();
      },
      deletePassword: () => {
        guard();
        return Promise.resolve(items.delete(id));
      },
    };
  };
  return { items, factory };
}

describe('KeychainSecretStore(가짜 키체인 항목)', () => {
  const warnings: string[] = [];
  const originalWarn = Logger.prototype.warn;
  beforeAll(() => {
    Logger.prototype.warn = function (message: unknown) {
      warnings.push(String(message));
    };
  });
  afterAll(() => {
    Logger.prototype.warn = originalWarn;
    clearKnownSecrets();
  });
  beforeEach(() => {
    warnings.length = 0;
    clearKnownSecrets();
  });

  it('set → get → status: 저장 여부와 수정 시각(읽기 함수 결과)을 준다. 값은 status에 없다', async () => {
    const { factory, items } = memoryFactory(() => null);
    const at = new Date('2026-09-30T01:23:45Z');
    const store = new KeychainSecretStore({
      service: 'svc',
      entryFactory: factory,
      readModifiedAt: () => Promise.resolve(at),
    });
    expect(await store.status('COMMERCE_CLIENT_ID')).toEqual({
      configured: false,
      updatedAt: null,
    });
    await store.set('COMMERCE_CLIENT_ID', VALUE);
    expect(items.get('svc/COMMERCE_CLIENT_ID')).toBe(VALUE);
    expect(await store.get('COMMERCE_CLIENT_ID')).toBe(VALUE);
    const status = await store.status('COMMERCE_CLIENT_ID');
    expect(status).toEqual({ configured: true, updatedAt: at });
    expect(JSON.stringify(status)).not.toContain(VALUE);
    // 같은 값 덮어쓰기는 멱등
    await store.set('COMMERCE_CLIENT_ID', VALUE);
    expect(await store.get('COMMERCE_CLIENT_ID')).toBe(VALUE);
  });

  it('읽거나 쓴 값은 알려진 비밀로 올라간다(로그에서 지워진다)', async () => {
    const { factory } = memoryFactory(() => null);
    const store = new KeychainSecretStore({
      entryFactory: factory,
      readModifiedAt: () => Promise.resolve(null),
    });
    await store.set('RAKUTEN_ACCESS_KEY', VALUE);
    expect(scrubKnownSecrets(`x ${VALUE} y`)).toBe('x *** y');
  });

  it('저장소 예외는 모두 503 KEYCHAIN_UNAVAILABLE로 바꾸고, 로그에는 값 없이 남긴다', async () => {
    const { factory } = memoryFactory(
      () => new Error(`SecKeychainItemModify failed for value ${VALUE}`),
    );
    const store = new KeychainSecretStore({
      entryFactory: factory,
      readModifiedAt: () => Promise.resolve(null),
    });
    // 쓰려던 값은 쓰기 전에 알려진 비밀로 올라가므로, 뒤이은 읽기 오류 글에 섞여도 지워진다
    for (const op of [
      () => store.set('COMMERCE_CLIENT_SECRET', VALUE),
      () => store.get('COMMERCE_CLIENT_SECRET'),
      () => store.status('COMMERCE_CLIENT_SECRET'),
    ]) {
      const e = await op().then(
        () => null,
        (err: unknown) => err,
      );
      expect(e).toBeInstanceOf(ApiException);
      expect((e as ApiException).code).toBe('KEYCHAIN_UNAVAILABLE');
      expect((e as ApiException).getStatus()).toBe(503);
      expect(JSON.stringify((e as ApiException).details)).not.toContain(VALUE);
      expect((e as ApiException).message).not.toContain(VALUE);
    }
    expect(warnings.length).toBeGreaterThanOrEqual(3);
    for (const w of warnings) expect(w).not.toContain(VALUE);
  });
});

describe('parseKeychainModifiedAt(security 출력)', () => {
  it('"mdat" 시각을 UTC로 읽는다', () => {
    const out = [
      'keychain: "/Users/x/Library/Keychains/login.keychain-db"',
      'class: "genp"',
      'attributes:',
      '    "acct"<blob>="COMMERCE_CLIENT_ID"',
      '    "cdat"<timedate>=0x32303236303932393030303030305A00  "20260929000000Z\\000"',
      '    "mdat"<timedate>=0x32303236303933303031323334355A00  "20260930012345Z\\000"',
      '    "svce"<blob>="autoStore"',
    ].join('\n');
    expect(parseKeychainModifiedAt(out)?.toISOString()).toBe('2026-09-30T01:23:45.000Z');
  });

  it('없거나 모양이 다르면 null', () => {
    expect(parseKeychainModifiedAt('')).toBeNull();
    expect(parseKeychainModifiedAt('"mdat"<timedate>=<NULL>')).toBeNull();
  });
});

/**
 * 실제 macOS 키체인 확인(기본으로 돌지 않는다). 켜는 법: `AUTOSTORE_KEYCHAIN_TEST=1 pnpm --filter @autostore/be test
 * -- keychain-secret-store`(06-4 §2). 임시 서비스 이름으로 넣고 읽고 지운다. 처음이면 macOS가 접근을 물을 수 있다.
 */
const realKeychain = process.env.AUTOSTORE_KEYCHAIN_TEST === '1' ? describe : describe.skip;

realKeychain('KeychainSecretStore(실제 키체인, AUTOSTORE_KEYCHAIN_TEST=1)', () => {
  const service = `autoStore-test-${process.pid}-${Date.now()}`;
  const store = new KeychainSecretStore({ service });

  afterAll(async () => {
    await store.delete('CUSTOMS_SERVICE_KEY').catch(() => false);
    clearKnownSecrets();
  });

  it('set → get → status → delete', async () => {
    const before = Date.now();
    await store.set('CUSTOMS_SERVICE_KEY', VALUE);
    expect(await store.get('CUSTOMS_SERVICE_KEY')).toBe(VALUE);
    const status = await store.status('CUSTOMS_SERVICE_KEY');
    expect(status.configured).toBe(true);
    if (process.platform === 'darwin') {
      // mdat은 초 단위(UTC)
      expect(status.updatedAt).not.toBeNull();
      expect(status.updatedAt!.getTime()).toBeGreaterThanOrEqual(before - 2_000);
      expect(status.updatedAt!.getTime()).toBeLessThanOrEqual(Date.now() + 2_000);
    }
    expect(await store.delete('CUSTOMS_SERVICE_KEY')).toBe(true);
    expect(await store.get('CUSTOMS_SERVICE_KEY')).toBeNull();
  });
});
