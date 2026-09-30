import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { ProgressEventsService } from '../../common/events/progress-events.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  type PageFetchLoopResult,
  type PageFetchOutcome,
  type PageFetchRow,
  runPageFetchLoop,
} from './page-fetch-loop.js';
import { type FetchedSnapshot, RakutenItemFetcher } from './rakuten-item-fetcher.js';
import { parseRakutenItemUrl } from './rakuten-url.js';

/** 페이지를 읽을 비교표 행(앵커 분류 뒤 — P2-03이 만든다) */
export interface PageFetchTargetRow extends PageFetchRow {
  /** 검색 결과의 상품 주소(itemUrl) */
  itemUrl: string;
  /** 검색 결과의 itemCode(API 행 — 페이지 JSON 대신 이 값을 쓴다) */
  itemCode: string;
  shopCode: string;
}

export interface SourcingPageFetchInput<R extends PageFetchTargetRow> {
  candidateId: number;
  stepRunId: number;
  sourcingComparisonId: number;
  rows: readonly R[];
  /** 재고 통과 판정(P2-03 재고 판정 규칙). 읽은 스냅샷으로 판단한다 */
  judgeStock(row: R, snapshot: FetchedSnapshot): boolean | Promise<boolean>;
  /** 한 행을 읽을 때마다(스냅샷 연결·SSE sourcing.row-updated는 P2-03) */
  onFetched?(row: R, outcome: PageFetchOutcome<FetchedSnapshot>): void | Promise<void>;
  /** 가격 순서보다 먼저 읽을 행(P2-03: SEARCH_PICK 앵커 상품) */
  firstRowIds?: readonly number[];
}

/** 한 페이지만 쓸 수 없는 실패(점검·파싱 실패·응답 없음·itemCode 못 찾음) — 멈추지 않고 그 행을 수동 확인으로 넘긴다 */
const UNUSABLE_CODES = ['EXTERNAL_API_ERROR', 'RAKUTEN_ITEM_CODE_UNRESOLVED'];

/**
 * 앵커 뒤 페이지 조회 반복(F-SO-12, P2-02 규칙 7). `runPageFetchLoop`(순서·K·M·멈춤 사유)에 실제 페이지 읽기
 * (`RakutenItemFetcher` — 관문 RAKUTEN_PAGE 직렬 큐 하나·3초·보내기 직전 call_log·하루 상한·24시간 쉼, entry_source=API·
 * fetch_reason=SOURCING)를 끼우고, 끝나면 SSE `sourcing.page-fetch-finished`(`stopReason`)를 그 후보로 보낸다.
 * 재고 통과 판정과 행 갱신은 부르는 쪽(P2-03 앵커 API)이 넣는다. K·M·기본 송료는 현재 설정(`sourcing.pageFetch*`).
 */
@Injectable()
export class SourcingPageFetchService {
  constructor(
    private readonly fetcher: RakutenItemFetcher,
    private readonly events: ProgressEventsService,
    private readonly settings: SettingsService,
  ) {}

  async run<R extends PageFetchTargetRow>(
    input: SourcingPageFetchInput<R>,
  ): Promise<PageFetchLoopResult> {
    const { sourcing } = this.settings.current();
    const byId = new Map(input.rows.map((row) => [row.rowId, row]));
    const result = await runPageFetchLoop<FetchedSnapshot>({
      rows: input.rows,
      targetPassed: sourcing.pageFetchTargetCandidates,
      maxPages: sourcing.pageFetchMaxPages,
      defaultShippingYen: sourcing.defaultShippingYen,
      firstRowIds: input.firstRowIds,
      fetchPage: async (loopRow) => {
        const row = byId.get(loopRow.rowId)!;
        const outcome = await this.fetchOne(row, input);
        await input.onFetched?.(row, outcome);
        return outcome;
      },
      judgeStock: (loopRow, snapshot) => input.judgeStock(byId.get(loopRow.rowId)!, snapshot),
    });
    this.events.publish(
      'sourcing.page-fetch-finished',
      {
        sourcingComparisonId: input.sourcingComparisonId,
        fetchedCount: result.fetchedCount,
        passedCount: result.passedCount,
        stopReason: result.stopReason,
      },
      { candidateId: input.candidateId },
    );
    return result;
  }

  private async fetchOne(
    row: PageFetchTargetRow,
    input: { candidateId: number; stepRunId: number },
  ): Promise<PageFetchOutcome<FetchedSnapshot>> {
    const url = parseRakutenItemUrl(row.itemUrl);
    if (!url) return { kind: 'UNUSABLE', reason: 'URL_INVALID' };
    try {
      const snapshot = await this.fetcher.fetchSnapshot(url, {
        entrySource: 'API',
        fetchReason: 'SOURCING',
        candidateId: input.candidateId,
        stepRunId: input.stepRunId,
        knownItemCode: { itemCode: row.itemCode, shopCode: row.shopCode },
      });
      return { kind: 'FETCHED', snapshot };
    } catch (error) {
      if (error instanceof ApiException && UNUSABLE_CODES.includes(error.code)) {
        const reason = error.details?.reason;
        return { kind: 'UNUSABLE', reason: typeof reason === 'string' ? reason : error.code };
      }
      // 하루 상한·쉼(409)은 반복이 멈춤 사유로 바꾼다. 그 밖은 그대로
      throw error;
    }
  }
}
