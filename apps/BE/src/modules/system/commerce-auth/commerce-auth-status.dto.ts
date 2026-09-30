import { ApiProperty } from '@nestjs/swagger';
import {
  COMMERCE_AUTH_CAUSE_CATEGORIES,
  type CommerceAuthCauseCategory,
} from '../../integrations/naver-commerce/commerce-auth-cause.js';

/** 05-2 components.schemas.CommerceAuthStatus(토큰 값은 담지 않는다) */
export class CommerceAuthStatusDto {
  @ApiProperty({ description: 'COMMERCE_CLIENT_ID·COMMERCE_CLIENT_SECRET가 모두 키체인에 있음' })
  secretsConfigured!: boolean;

  @ApiProperty({ description: '메모리 캐시의 토큰이 있고 만료 전(3시간 캐시, F-BS-47)' })
  tokenValid!: boolean;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  tokenExpiresAt!: string | null;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    nullable: true,
    description: '마지막 토큰 발급 호출 시각(call_log.called_at)',
  })
  lastCheckedAt!: string | null;

  @ApiProperty({ type: 'boolean', nullable: true })
  lastSucceeded!: boolean | null;

  @ApiProperty({ type: 'integer', nullable: true })
  lastHttpStatus!: number | null;

  @ApiProperty({
    type: 'string',
    nullable: true,
    maxLength: 100,
    description: 'GW.AUTHN, GW.IP_NOT_ALLOWED, CLIENT_IP_NOT_ALLOWED 등',
  })
  lastErrorCode!: string | null;

  @ApiProperty({
    enum: COMMERCE_AUTH_CAUSE_CATEGORIES,
    nullable: true,
    description: '마지막 실패의 원인 분류. 성공이거나 기록이 없으면 null',
  })
  causeCategory!: CommerceAuthCauseCategory | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100, description: 'GNCP-GW-Trace-ID' })
  lastTraceId!: string | null;
}
