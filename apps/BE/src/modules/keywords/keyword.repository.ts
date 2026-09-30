import { Injectable } from '@nestjs/common';
import type { Keyword, KeywordSnapshot, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { KeywordSnapshotDto, RankedKeywordDto } from './dto/keyword-snapshot.dto.js';
import {
  KEYWORD_EXCLUDED_REASON_CHILD,
  type KeywordAbortReason,
  type KeywordSnapshotMethod,
  type KeywordSnapshotStatus,
} from './keywords.constants.js';

type Db = PrismaService | Prisma.TransactionClient;

/** 묶음 행 + 집계(keywordCount·excludedCount) */
export interface SnapshotCounts {
  keywordCount: number;
  excludedCount: number;
}

/** 새로 넣을 키워드 한 줄 */
export interface KeywordRowInput {
  cid: string | null;
  rank: number;
  keyword: string;
  /** 아동 단어가 들었으면 true → excluded_reason 'CHILD' */
  excluded: boolean;
}

/** `@db.Date` 값 → 'YYYY-MM-DD' */
function dateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/** 'YYYY-MM-DD' → `@db.Date` 값(UTC 0시) */
export function toDateValue(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function toSnapshotDto(row: KeywordSnapshot, counts: SnapshotCounts): KeywordSnapshotDto {
  return {
    id: row.id,
    method: row.method as KeywordSnapshotMethod,
    collectedAt: row.collectedAt.toISOString(),
    requestedCids: [...row.requestedCids],
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    rankLimit: row.rankLimit,
    responseRange: row.responseRange,
    rangeMatched: row.rangeMatched,
    status: row.status as KeywordSnapshotStatus,
    abortReason: row.abortReason,
    httpStatus: row.httpStatus,
    filters: null,
    keywordCount: counts.keywordCount,
    excludedCount: counts.excludedCount,
  };
}

export function toRankedKeywordDto(
  row: Keyword & { candidates: { id: number }[] },
): RankedKeywordDto {
  return {
    id: row.id,
    keywordSnapshotId: row.keywordSnapshotId,
    cid: row.cid,
    rank: row.rank,
    keyword: row.keyword,
    excludedReason: row.excludedReason,
    selectedAt: row.selectedAt ? row.selectedAt.toISOString() : null,
    candidateIds: row.candidates.map((c) => c.id),
  };
}

/** 후보 id(역참조)를 id 순으로 */
export const KEYWORD_WITH_CANDIDATES = {
  candidates: { select: { id: true }, orderBy: { id: 'asc' } },
} as const satisfies Prisma.KeywordInclude;

/**
 * keyword_snapshot·keyword 접근(ERD §3.2). 두 표는 삭제 금지(trg_forbid_delete)라 지우는 메서드가 없다.
 * 집계(keywordCount·excludedCount)는 컬럼이 아니라 keyword groupBy다(05-2).
 */
@Injectable()
export class KeywordRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** 묶음 id별 키워드 수·제외 수 */
  async countsOf(
    ids: readonly number[],
    db: Db = this.prisma,
  ): Promise<Map<number, SnapshotCounts>> {
    const out = new Map<number, SnapshotCounts>(
      ids.map((id) => [id, { keywordCount: 0, excludedCount: 0 }]),
    );
    if (ids.length === 0) return out;
    const groups = await db.keyword.groupBy({
      by: ['keywordSnapshotId', 'excludedReason'],
      where: { keywordSnapshotId: { in: [...ids] } },
      _count: { _all: true },
    });
    for (const g of groups) {
      const counts = out.get(g.keywordSnapshotId);
      if (!counts) continue;
      counts.keywordCount += g._count._all;
      if (g.excludedReason !== null) counts.excludedCount += g._count._all;
    }
    return out;
  }

  async toDto(row: KeywordSnapshot, db: Db = this.prisma): Promise<KeywordSnapshotDto> {
    const counts = await this.countsOf([row.id], db);
    return toSnapshotDto(row, counts.get(row.id)!);
  }

  findSnapshot(id: number, db: Db = this.prisma): Promise<KeywordSnapshot | null> {
    return db.keywordSnapshot.findUnique({ where: { id } });
  }

  /** 진행 중(RUNNING) 묶음. 하나만 있어야 한다(시작 잠금) */
  findRunning(db: Db = this.prisma): Promise<KeywordSnapshot | null> {
    return db.keywordSnapshot.findFirst({ where: { status: 'RUNNING' }, orderBy: { id: 'desc' } });
  }

  /** 마지막으로 끝난 버튼 수집(수집 상태의 last*, Proposed: 붙여넣기는 데이터랩 수집 상태가 아니라 뺀다) */
  findLastFinishedButton(db: Db = this.prisma): Promise<KeywordSnapshot | null> {
    return db.keywordSnapshot.findFirst({
      where: { method: 'BUTTON', status: { not: 'RUNNING' } },
      orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** 키워드 줄을 넣는다(아동 단어가 든 줄은 excluded_reason 'CHILD' — 지우지 않는다, F-KW-07) */
  async insertKeywords(
    snapshotId: number,
    rows: readonly KeywordRowInput[],
    db: Db = this.prisma,
  ): Promise<void> {
    if (rows.length === 0) return;
    await db.keyword.createMany({
      data: rows.map((r) => ({
        keywordSnapshotId: snapshotId,
        cid: r.cid,
        rank: r.rank,
        keyword: r.keyword,
        excludedReason: r.excluded ? KEYWORD_EXCLUDED_REASON_CHILD : null,
      })),
    });
  }

  /** 버튼 수집을 정상 종료로 닫는다(RUNNING일 때만) */
  async complete(
    id: number,
    data: { responseRange: string | null; rangeMatched: boolean | null },
    db: Db = this.prisma,
  ): Promise<boolean> {
    const res = await db.keywordSnapshot.updateMany({
      where: { id, status: 'RUNNING' },
      data: { status: 'COMPLETED', ...data },
    });
    return res.count === 1;
  }

  /** 버튼 수집을 중단으로 닫는다(RUNNING일 때만, ck_kws_abort_pair·ck_kws_http) */
  async abort(
    id: number,
    data: {
      reason: KeywordAbortReason;
      httpStatus: number | null;
      responseRange: string | null;
      rangeMatched: boolean | null;
    },
    db: Db = this.prisma,
  ): Promise<boolean> {
    const res = await db.keywordSnapshot.updateMany({
      where: { id, status: 'RUNNING' },
      data: {
        status: 'ABORTED',
        abortReason: data.reason,
        httpStatus: data.httpStatus,
        responseRange: data.responseRange,
        rangeMatched: data.rangeMatched,
      },
    });
    return res.count === 1;
  }

  findKeyword(id: number, db: Db = this.prisma) {
    return db.keyword.findUnique({ where: { id }, include: KEYWORD_WITH_CANDIDATES });
  }
}
