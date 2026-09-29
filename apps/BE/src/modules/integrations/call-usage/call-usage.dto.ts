import { ApiProperty } from '@nestjs/swagger';
import { CALL_LOG_TARGETS, type CallLogTarget } from '../http/external-targets.js';

/** RAKUTEN_PAGE 조회 이유(rakuten_item.fetch_reason, ck_rakuten_item_fetch) */
export const RAKUTEN_FETCH_REASONS = [
  'SOURCING',
  'URL_ENTRY',
  'STOCK_CHECK',
  'REFETCH',
  'SYNC',
] as const;
export type RakutenFetchReason = (typeof RAKUTEN_FETCH_REASONS)[number];

export type CountsByFetchReason = Record<RakutenFetchReason, number>;

/** 05-2 components.schemas.CallUsageByTarget(SSE call-usage.changed와 같은 뜻) */
export class CallUsageByTargetDto {
  @ApiProperty({ enum: CALL_LOG_TARGETS })
  target!: CallLogTarget;

  @ApiProperty({ type: 'string', format: 'date', description: '오늘(KST)' })
  kstDate!: string;

  @ApiProperty({ type: 'integer', minimum: 0, description: '오늘 호출 수(실패·중단 요청 포함)' })
  count!: number;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    minimum: 0,
    description: '하루 상한(상한이 없는 대상은 null)',
  })
  dailyLimit!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0 })
  remaining!: number | null;

  @ApiProperty()
  limitReached!: boolean;

  @ApiProperty({
    type: 'string',
    format: 'date-time',
    nullable: true,
    description: '403·418·429 뒤 24시간 쉼이 끝나는 시각',
  })
  blockedUntil!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    enum: [403, 418, 429],
    description: '쉼을 일으킨 응답 코드',
  })
  httpStatus!: 403 | 418 | 429 | null;

  @ApiProperty({
    type: 'object',
    nullable: true,
    properties: Object.fromEntries(
      RAKUTEN_FETCH_REASONS.map((r) => [r, { type: 'integer', minimum: 0 }]),
    ),
    description: 'RAKUTEN_PAGE만 — 조회 이유(rakuten_item.fetch_reason)별 수. 다른 대상은 null',
  })
  countsByFetchReason!: CountsByFetchReason | null;

  @ApiProperty({ type: 'array', nullable: true, description: '(M2) 하루 상한 몫. M1은 null' })
  budgetBuckets!: null;
}

/** 05-2 components.schemas.CallUsageList */
export class CallUsageListDto {
  @ApiProperty({ type: [CallUsageByTargetDto] })
  items!: CallUsageByTargetDto[];
}
