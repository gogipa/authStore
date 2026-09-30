import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import {
  isCommerceSecretKey,
  isSecretKey,
  SECRET_KEYS,
  type SecretKey,
} from '../../../common/secrets/secret-keys.js';
import { registerKnownSecret } from '../../../common/secrets/secret-mask.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import { CommerceTokenService } from '../../integrations/naver-commerce/commerce-token.service.js';
import type { SecretStatusListDto } from './secret.dto.js';

/**
 * 비밀정보 키 입력(F-SY-01, F-BS-24·25). 값은 SecretStore(키체인)에만 쓰고 돌려주지 않는다.
 * 감사 기록은 키 이름만 남긴다(user_action_log SETTING_CHANGED, detail `{ secretKey }` — Proposed).
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);

  constructor(
    @Inject(SECRET_STORE) private readonly store: SecretStore,
    private readonly tokens: CommerceTokenService,
    private readonly audit: UserActionLogService,
  ) {}

  /** GET /secrets — 허용 키 6개의 저장 여부(05-2 순서). 키체인을 못 열면 503 */
  async list(): Promise<SecretStatusListDto> {
    const items = [];
    for (const secretKey of SECRET_KEYS) {
      const status = await this.store.status(secretKey);
      items.push({
        secretKey,
        configured: status.configured,
        updatedAt: status.updatedAt ? status.updatedAt.toISOString() : null,
      });
    }
    return { items };
  }

  /**
   * PUT /secrets/{secretKey} — 넣거나 바꾼다(같은 값 덮어쓰기는 멱등). 목록 밖 키는 404.
   * 커머스 키를 바꾸면 토큰 캐시를 바로 비운다(tokenValid=false).
   */
  async save(secretKey: string, value: string): Promise<void> {
    if (!isSecretKey(secretKey)) throw new ApiException('SECRET_KEY_UNKNOWN');
    // 뒤에서 어떤 로그·오류가 나도 값이 지워지게 먼저 알려 둔다
    registerKnownSecret(value);
    await this.store.set(secretKey, value);
    if (isCommerceSecretKey(secretKey)) this.tokens.invalidate();
    await this.recordAudit(secretKey);
  }

  private async recordAudit(secretKey: SecretKey): Promise<void> {
    try {
      await this.audit.record({ eventType: 'SETTING_CHANGED', detail: { secretKey } });
    } catch (e) {
      // 값은 이미 키체인에 들어갔다. 감사 기록 실패로 요청을 실패시키지 않는다
      this.logger.warn(
        `비밀 키 변경 감사 기록에 실패했습니다(${secretKey}): ${e instanceof Error ? e.name : 'Error'}`,
      );
    }
  }
}
