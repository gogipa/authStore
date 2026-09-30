import { Inject, Injectable, Logger } from '@nestjs/common';
import { COMMERCE_SECRET_KEYS } from '../../../common/secrets/secret-keys.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { classifyCommerceAuthCause } from '../../integrations/naver-commerce/commerce-auth-cause.js';
import { COMMERCE_TOKEN_PATH } from '../../integrations/naver-commerce/commerce-endpoints.js';
import { CommerceTokenService } from '../../integrations/naver-commerce/commerce-token.service.js';
import type { CommerceAuthStatusDto } from './commerce-auth-status.dto.js';

/**
 * 커머스API 인증 상태(F-SY-02, F-BS-47, 05-2 CommerceAuthStatus). 토큰 값은 담지 않는다.
 * - 마지막 발급 호출: call_log에서 target=COMMERCE_API이고 주소가 토큰 경로인 가장 최근 행.
 * - 토큰: CommerceTokenService 메모리 캐시.
 * - 원인: 마지막 발급 호출이 실패였으면 (http_status, error_code)로 분류, 성공이거나 기록이 없으면 null.
 */
@Injectable()
export class CommerceAuthStatusService {
  private readonly logger = new Logger(CommerceAuthStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: CommerceTokenService,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
  ) {}

  async getStatus(): Promise<CommerceAuthStatusDto> {
    const [secretsConfigured, last] = await Promise.all([
      this.commerceSecretsConfigured(),
      this.prisma.callLog.findFirst({
        where: { target: 'COMMERCE_API', urlMasked: { contains: COMMERCE_TOKEN_PATH } },
        orderBy: [{ calledAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    const token = this.tokens.status();
    const failed = last?.succeeded === false;
    return {
      secretsConfigured,
      tokenValid: token.tokenValid,
      tokenExpiresAt: token.expiresAt ? token.expiresAt.toISOString() : null,
      lastCheckedAt: last ? last.calledAt.toISOString() : null,
      lastSucceeded: last ? last.succeeded : null,
      lastHttpStatus: last ? last.httpStatus : null,
      lastErrorCode: last ? last.errorCode : null,
      causeCategory: failed ? classifyCommerceAuthCause(last.httpStatus, last.errorCode) : null,
      lastTraceId: last ? last.traceId : null,
    };
  }

  /** POST /auth-checks — 캐시와 상관없이 토큰을 한 번 받고 새 상태를 준다(실패는 409·502·503) */
  async check(): Promise<CommerceAuthStatusDto> {
    await this.tokens.forceRefresh();
    return this.getStatus();
  }

  /** 커머스 키 둘이 모두 있는지. 키체인을 못 열면 false(이 API는 503을 두지 않는다, 05-2) */
  private async commerceSecretsConfigured(): Promise<boolean> {
    try {
      const statuses = await Promise.all(COMMERCE_SECRET_KEYS.map((k) => this.secrets.status(k)));
      return statuses.every((s) => s.configured);
    } catch {
      this.logger.warn('키체인을 열 수 없어 커머스 키 저장 여부를 false로 둡니다.');
      return false;
    }
  }
}
