import { Injectable } from '@nestjs/common';
import type {
  Candidate,
  Prisma,
  SourcingComparison,
  SourcingComparisonRow,
  StepRun,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import { type AnchorKey, classifyRow, effectiveMatch } from './anchor-match.js';
import {
  detectCandidateGender,
  resolveCandidateGender,
  type DetectedCandidateGender,
} from './gender-detection.js';
import { idPathFromNamePath } from '../integrations/rakuten/rakuten-genre.service.js';
import type { RakutenItemWithSkus } from './rakuten-item.repository.js';
import { rankedRowIds } from './ranking.js';
import {
  anchorJansOf,
  calculateRow,
  EMPTY_CALC,
  pricingOf,
  type RowCalcContext,
  type RowCalcResult,
} from './row-calculation.js';
import { comparisonParamsOf } from './sourcing-output.js';

type Db = Prisma.TransactionClient;

export type HeadWithRun = SourcingComparison & { stepRun: StepRun };
export type RowWithItem = SourcingComparisonRow & {
  rakutenItem: { collectedAt: Date; saleStartsAt: Date | null; saleEndsAt: Date | null } | null;
};

/** 행 조회 때 붙이는 페이지 스냅샷 값(05-2 SourcingComparisonRow의 조인 칸) */
export const ROW_ITEM_INCLUDE = {
  rakutenItem: { select: { collectedAt: true, saleStartsAt: true, saleEndsAt: true } },
} as const;

/** 머리 행의 앵커(행 분류·재고 색상·JAN 재대조 기준) */
export function anchorOfHead(
  head: Pick<
    SourcingComparison,
    'anchorModelCodeNorm' | 'anchorColorCode' | 'anchorItemCode' | 'anchorColorLabel'
  >,
): AnchorKey & { colorLabel: string | null } {
  return {
    modelCodeNorm: head.anchorModelCodeNorm,
    colorCode: head.anchorColorCode,
    itemCode: head.anchorItemCode,
    colorLabel: head.anchorColorLabel,
  };
}

/**
 * ② 비교표 읽기·쓰기(ERD `sourcing_comparison`·`sourcing_comparison_row`, P2-03). 쓰기는 호출자 트랜잭션 안에서 하고
 * 그 ② 버전이 열려 있을 때만 된다(`trg_output_frozen` — 호출자가 입력 대기인지 먼저 본다).
 * - 행 분류(`classifyRows`), 페이지 스냅샷으로 검증·재고·실질가·재대조(`applySnapshot`), 쿠폰·배율만 바뀐 행의 포인트·실질가
 *   (`repriceRow`), 성별이 바뀐 뒤 검증 행 다시 계산(`recalculateVerifiedRows`), 순위(`rankedIds`)
 * - 계산 문맥(`contextOf`): 앵커 + 앵커 상품 페이지 JAN + 성별(오너 → 자동 → ②에서 고른 성별 → 후보 ② 값) + 버전 설정 사본
 */
@Injectable()
export class SourcingComparisonRepository {
  constructor(private readonly prisma: PrismaService) {}

  findHead(id: number, db: Db = this.prisma): Promise<HeadWithRun | null> {
    return db.sourcingComparison.findUnique({ where: { id }, include: { stepRun: true } });
  }

  findRow(rowId: number, db: Db = this.prisma) {
    return db.sourcingComparisonRow.findUnique({
      where: { id: rowId },
      include: { sourcingComparison: { include: { stepRun: true } } },
    });
  }

  rowsOf(db: Db, sourcingComparisonId: number): Promise<RowWithItem[]> {
    return db.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId },
      include: ROW_ITEM_INCLUDE,
      orderBy: { id: 'asc' },
    });
  }

  rowWithItem(db: Db, rowId: number): Promise<RowWithItem> {
    return db.sourcingComparisonRow.findUniqueOrThrow({
      where: { id: rowId },
      include: ROW_ITEM_INCLUDE,
    });
  }

  async rankedIds(db: Db, sourcingComparisonId: number): Promise<number[]> {
    const rows = await db.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId },
      select: {
        id: true,
        isVerified: true,
        stockPass: true,
        effectivePriceYen: true,
        searchRank: true,
      },
    });
    return rankedRowIds(rows);
  }

  /** 키워드 후보의 데이터랩 cid(성별 신호). 없으면 null */
  async keywordCidOf(
    db: Db,
    candidate: Pick<Candidate, 'sourceKeywordId'>,
  ): Promise<string | null> {
    if (candidate.sourceKeywordId === null) return null;
    const keyword = await db.keyword.findUnique({
      where: { id: candidate.sourceKeywordId },
      select: { cid: true },
    });
    return keyword?.cid ?? null;
  }

  /**
   * 행 분류(F-SO-09): 행마다 앵커와 비교해 anchor_match·model_code_norm·color_code를 쓴다. 페이지를 읽은 행(수동 행 등)은
   * 스냅샷의 メーカー型番을 알고 있는 型番으로 넘긴다. 바뀐 행 수를 돌려준다
   */
  async classifyRows(tx: Db, head: SourcingComparison): Promise<number> {
    const anchor = anchorOfHead(head);
    const rows = await tx.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId: head.id },
      include: { rakutenItem: { select: { modelCode: true } } },
    });
    let changed = 0;
    for (const row of rows) {
      const c = classifyRow(anchor, {
        itemCode: row.itemCode,
        itemName: row.itemName,
        modelCode: row.rakutenItem?.modelCode ?? null,
      });
      if (
        c.anchorMatch === row.anchorMatch &&
        c.modelCodeNorm === row.modelCodeNorm &&
        c.colorCode === row.colorCode
      ) {
        continue;
      }
      await tx.sourcingComparisonRow.update({
        where: { id: row.id },
        data: {
          anchorMatch: c.anchorMatch,
          modelCodeNorm: c.modelCodeNorm?.slice(0, 128) ?? null,
          colorCode: c.colorCode?.slice(0, 64) ?? null,
        },
      });
      changed += 1;
    }
    return changed;
  }

  /**
   * 성별 신호(F-SO-18): cid → 장르 경로(앵커 상품 페이지, 없으면 첫 검증 MATCH 행 페이지) → 상품명(앵커 행, CODE_ENTRY면
   * 첫 MATCH 행). 앵커 상품·MATCH 행을 모르면 null
   */
  async detectGender(
    db: Db,
    head: SourcingComparison,
    candidate: Pick<Candidate, 'sourceKeywordId'>,
    selected?: { itemName: string; genrePath: string | null } | null,
  ): Promise<DetectedCandidateGender | null> {
    const keywordCid = await this.keywordCidOf(db, candidate);
    let reference = selected ?? null;
    if (!reference) {
      const rows = await db.sourcingComparisonRow.findMany({
        where: { sourcingComparisonId: head.id },
        include: { rakutenItem: { select: { genrePath: true } } },
        orderBy: [{ searchRank: 'asc' }, { id: 'asc' }],
      });
      const anchorRow = head.anchorItemCode
        ? rows.find((r) => r.itemCode === head.anchorItemCode)
        : undefined;
      const verifiedMatch = rows.find((r) => r.anchorMatch === 'MATCH' && r.rakutenItem);
      const firstMatch = rows.find((r) => r.anchorMatch === 'MATCH');
      const genreSource = anchorRow?.rakutenItem ? anchorRow : verifiedMatch;
      const nameSource = anchorRow ?? firstMatch;
      reference = {
        itemName: nameSource?.itemName ?? '',
        genrePath: genreSource?.rakutenItem?.genrePath ?? null,
      };
    }
    return detectCandidateGender({
      keywordCid,
      genreIdPath: idPathFromNamePath(reference.genrePath),
      itemName: reference.itemName || null,
    });
  }

  /** 계산 문맥(앵커·앵커 JAN·성별·설정 사본) */
  async contextOf(
    db: Db,
    head: SourcingComparison,
    candidate: Pick<Candidate, 'gender' | 'genderSource'>,
    settings: Readonly<AppSettings>,
  ): Promise<RowCalcContext> {
    const anchor = anchorOfHead(head);
    let anchorJans: string[] | null = null;
    if (head.anchorItemCode) {
      const anchorRow = await db.sourcingComparisonRow.findFirst({
        where: {
          sourcingComparisonId: head.id,
          itemCode: head.anchorItemCode,
          rakutenItemId: { not: null },
        },
        include: { rakutenItem: { include: { skus: true } } },
      });
      if (anchorRow?.rakutenItem) {
        const jans = anchorJansOf(anchorRow.rakutenItem.skus, anchor);
        anchorJans = jans.length > 0 ? jans : null;
      }
    }
    const detectedGender = head.detectedGender;
    const detected: DetectedCandidateGender | null =
      detectedGender === 'MALE' || detectedGender === 'FEMALE'
        ? { gender: detectedGender, basis: 'ITEM_NAME' }
        : null;
    const gender = resolveCandidateGender({
      candidate,
      detected,
      ownerGenderInStep: head.ownerGender,
    }).effective;
    return { anchor, anchorJans, gender, params: comparisonParamsOf(head.params, settings) };
  }

  /**
   * 페이지를 읽은 행(F-SO-15·20·22): 스냅샷을 잇고 검증 + 재고·송료·포인트·실질가 + JAN·メーカー型番 재대조 + 수동 확인.
   * `fetchOrder`는 페이지 조회 반복 순서(재고 확인·수동 행은 그대로)
   */
  async applySnapshot(
    tx: Db,
    rowId: number,
    snapshot: RakutenItemWithSkus,
    ctx: RowCalcContext,
    options: { fetchOrder?: number | null } = {},
  ): Promise<{ row: SourcingComparisonRow; calc: RowCalcResult }> {
    const row = await tx.sourcingComparisonRow.findUniqueOrThrow({ where: { id: rowId } });
    const calc = calculateRow(
      row,
      {
        backOrderFlag: snapshot.backOrderFlag,
        modelCodeNorm: snapshot.modelCodeNorm,
        skus: snapshot.skus,
      },
      ctx,
    );
    const reasons = [snapshot.manualCheckNote, calc.stockManualCheckReason].filter(
      (r): r is string => !!r,
    );
    const updated = await tx.sourcingComparisonRow.update({
      where: { id: rowId },
      data: {
        isVerified: true,
        rakutenItemId: snapshot.id,
        ...(options.fetchOrder !== undefined && options.fetchOrder !== null
          ? { fetchOrder: options.fetchOrder }
          : {}),
        manualCheckRequired: snapshot.manualCheckRequired || calc.stockManualCheckReason !== null,
        manualCheckReason: reasons.length > 0 ? reasons.join(' / ').slice(0, 500) : null,
        janMatch: calc.janMatch,
        makerModelMatch: calc.makerModelMatch,
        ...calc.data,
      },
    });
    return { row: updated, calc };
  }

  /** 페이지를 읽었지만 쓸 수 없음(점검·파싱 실패·응답 없음) → 수동 확인. 검증은 그대로(미검증) */
  markUnusable(tx: Db, rowId: number, reason: string, fetchOrder?: number | null) {
    return tx.sourcingComparisonRow.update({
      where: { id: rowId },
      data: {
        manualCheckRequired: true,
        manualCheckReason: `페이지를 읽지 못함(${reason})`.slice(0, 500),
        ...(fetchOrder !== undefined && fetchOrder !== null ? { fetchOrder } : {}),
      },
    });
  }

  /** 검증 행 전부를 지금 문맥으로 다시 계산(성별이 바뀜 등 — DB만, 페이지를 다시 읽지 않는다) */
  async recalculateVerifiedRows(
    tx: Db,
    head: SourcingComparison,
    ctx: RowCalcContext,
  ): Promise<number> {
    const rows = await tx.sourcingComparisonRow.findMany({
      where: { sourcingComparisonId: head.id, isVerified: true, rakutenItemId: { not: null } },
      include: { rakutenItem: { include: { skus: true } } },
    });
    for (const row of rows) {
      if (!row.rakutenItem) continue;
      await this.applySnapshot(tx, row.id, row.rakutenItem, ctx);
    }
    return rows.length;
  }

  /** 쿠폰·배율만 바뀐 행의 포인트·실질가(PATCH, F-SO-25·26) */
  repriceRow(
    tx: Db,
    row: SourcingComparisonRow,
    head: SourcingComparison,
    settings: Readonly<AppSettings>,
  ) {
    const params = comparisonParamsOf(head.params, settings);
    const pricing = row.isVerified
      ? pricingOf(row, params)
      : pricingOf({ ...row, representativePriceYen: null, shippingYen: null }, params);
    return tx.sourcingComparisonRow.update({ where: { id: row.id }, data: pricing });
  }

  /** 행을 미검증 값으로(수동 확인 사유는 둔다) */
  clearCalc(tx: Db, rowId: number) {
    return tx.sourcingComparisonRow.update({ where: { id: rowId }, data: { ...EMPTY_CALC } });
  }

  /** K 집계·선택에 쓰는 '재고 통과 + 같은 상품' */
  static countsAsPassed(row: SourcingComparisonRow): boolean {
    return row.stockPass === true && effectiveMatch(row);
  }
}
