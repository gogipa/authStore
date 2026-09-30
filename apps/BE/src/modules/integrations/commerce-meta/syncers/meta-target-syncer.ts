import type { Prisma } from '../../../../generated/prisma/client.js';
import type { MetaApi } from '../commerce-meta-api.js';
import type { MetaSyncTarget } from '../commerce-meta.constants.js';

/** 동기화기가 캐시 표에 쓰는 DB(트랜잭션 안) */
export type MetaDb = Prisma.TransactionClient;

/** 카테고리 단위 대상이 부를 리프를 캐시에서 고른다(성별 신발 리프, 규칙 1 Proposed) */
export interface MetaLeafSource {
  /** `removed_at`이 없는 성별 신발 경로 리프의 category_id(아동·제외 품목 포함 — 상세를 받아야 거를 수 있다) */
  shoeLeafCategoryIds(): Promise<string[]>;
}

export interface MetaFetchContext {
  api: MetaApi;
  leaves: MetaLeafSource;
}

/**
 * 대상 하나의 동기화기(P1-08 §5). 외부 호출은 `fetch`(트랜잭션 밖)에서 모두 끝내고 응답을 행으로 바꿔 둔다.
 * `apply`는 한 트랜잭션 안에서 캐시를 쓰고 받은 건수(item_count)를 돌려준다(규칙 3·5).
 */
export interface MetaTargetSyncer<Raw = unknown> {
  readonly target: MetaSyncTarget;
  fetch(ctx: MetaFetchContext): Promise<Raw>;
  apply(tx: MetaDb, raw: Raw, now: Date): Promise<number>;
}

/** 앞 대상이 필요한 것을 만들지 않았다(예: 카테고리 캐시가 비었다). 그 대상만 FAILED */
export class MetaPrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetaPrerequisiteError';
  }
}

/** 카테고리 단위 대상이 부를 리프. 없으면 먼저 카테고리 목록을 받으라고 알린다 */
export async function requireShoeLeaves(ctx: MetaFetchContext): Promise<string[]> {
  const ids = await ctx.leaves.shoeLeafCategoryIds();
  if (ids.length === 0) {
    throw new MetaPrerequisiteError(
      '성별 신발 카테고리가 캐시에 없습니다. 카테고리 목록을 먼저 받아 주세요.',
    );
  }
  return ids;
}
