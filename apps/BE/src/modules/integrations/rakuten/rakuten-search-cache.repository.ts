import { Injectable } from '@nestjs/common';
import type { Prisma, RakutenSearchCache } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import type { RakutenSearchParams } from './rakuten-search.request.js';

export interface RakutenSearchCacheWrite {
  queryHash: string;
  keyword: string | null;
  genreId: number | null;
  page: number;
  /** 비밀값을 뺀 요청 파라미터 사본 */
  requestParams: RakutenSearchParams;
  /** 응답 Items 배열 원문(formatVersion=2) */
  responseItems: unknown[];
  fetchedAt: Date;
  expiresAt: Date;
}

/**
 * Item Search 응답 캐시(ERD `rakuten_search_cache`, integrations 소유 — ERD 결정 ⑭). 이력이 아닌 캐시라 query_hash로
 * 덮어쓰고 물리 삭제도 허용한다. 200 응답만 넣는다. `expires_at > now`인 행만 적중이다.
 */
@Injectable()
export class RakutenSearchCacheRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 아직 유효한 캐시(없으면 null) */
  findFresh(queryHash: string, now: Date): Promise<RakutenSearchCache | null> {
    return this.prisma.rakutenSearchCache.findFirst({
      where: { queryHash, expiresAt: { gt: now } },
    });
  }

  /** query_hash로 넣거나 덮어쓴다 */
  async upsert(write: RakutenSearchCacheWrite): Promise<void> {
    const data = {
      keyword: write.keyword,
      genreId: write.genreId,
      page: write.page,
      requestParams: write.requestParams as Prisma.InputJsonValue,
      responseItems: write.responseItems as Prisma.InputJsonValue,
      resultCount: write.responseItems.length,
      fetchedAt: write.fetchedAt,
      expiresAt: write.expiresAt,
    };
    await this.prisma.rakutenSearchCache.upsert({
      where: { queryHash: write.queryHash },
      create: { queryHash: write.queryHash, ...data },
      update: data,
    });
  }

  /** 만료된 캐시를 지운다(캐시라 물리 삭제 허용). 지운 행 수 */
  async deleteExpired(now: Date): Promise<number> {
    const { count } = await this.prisma.rakutenSearchCache.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return count;
  }
}
