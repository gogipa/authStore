import { Global, Module } from '@nestjs/common';
import { KeychainSecretStore } from './keychain-secret-store.js';
import { SECRET_STORE } from './secret-store.port.js';

/**
 * 비밀정보 저장소(전역, Proposed P1-07: C4에 자리가 없어 common에 둔다).
 * system(키 입력 API)과 integrations(커머스·라쿠텐·환율)가 같이 쓴다. `SECRET_STORE` 하나만 낸다.
 * 테스트는 `overrideProvider(SECRET_STORE).useValue(new InMemorySecretStore())`로 바꾼다(test/support).
 */
@Global()
@Module({
  providers: [{ provide: SECRET_STORE, useFactory: () => new KeychainSecretStore() }],
  exports: [SECRET_STORE],
})
export class SecretsModule {}
