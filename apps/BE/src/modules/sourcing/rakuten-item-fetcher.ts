import { Inject, Injectable, Logger } from '@nestjs/common';
import { childShoeRulesOf } from '../../common/child-shoe/child-shoe.rules.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { EXTERNAL_TARGETS } from '../integrations/http/external-targets.js';
import { RakutenGenreService } from '../integrations/rakuten/rakuten-genre.service.js';
import {
  RAKUTEN_PAGE_PORT,
  type RakutenPagePort,
} from '../integrations/rakuten/rakuten-page.port.js';
import {
  RAKUTEN_SEARCH_PORT,
  type RakutenSearchPort,
} from '../integrations/rakuten/rakuten-search.port.js';
import { SettingsService } from '../settings/settings.service.js';
import { entryChecksOf, type RakutenItemEntryChecks } from './entry-checks.js';
import { ItemCodeResolver } from './item-code.resolver.js';
import { parseItemPage } from './page-json.parser.js';
import {
  type RakutenEntrySource,
  type RakutenFetchReason,
  type RakutenGenreSource,
  RakutenItemRepository,
  type RakutenItemWithSkus,
} from './rakuten-item.repository.js';
import type { RakutenItemUrl } from './rakuten-url.js';

/** 페이지를 읽었지만 쓸 수 없는 이유(502 EXTERNAL_API_ERROR details.reason) */
export type PageFailureReason = 'MAINTENANCE_PAGE' | 'PARSE_FAILED' | `HTTP_${number}`;

const REASON_TEXT: Record<string, string> = {
  MAINTENANCE_PAGE: '점검·삭제 페이지',
  PARSE_FAILED: '페이지 정보를 읽지 못함',
};

/** 점검·파싱 실패·200 아님 → 502 EXTERNAL_API_ERROR(details.target=RAKUTEN_PAGE·reason) — URL 입구(동기) */
export function pageFailure(reason: PageFailureReason, callLogId?: number): ApiException {
  return new ApiException('EXTERNAL_API_ERROR', {
    message: formatErrorMessage('EXTERNAL_API_ERROR', {
      대상: EXTERNAL_TARGETS.RAKUTEN_PAGE.label,
      사유: REASON_TEXT[reason] ?? `응답 ${reason.replace('HTTP_', '')}`,
    }),
    details: { target: 'RAKUTEN_PAGE', reason, ...(callLogId ? { callLogId } : {}) },
  });
}

export interface FetchSnapshotOptions {
  entrySource: RakutenEntrySource;
  fetchReason: RakutenFetchReason;
  candidateId?: number | null;
  stepRunId?: number | null;
  /** 이미 아는 itemCode(재조회·재고 확인 — 보완 조회를 건너뛴다) */
  knownItemCode?: { itemCode: string; shopCode: string };
}

export interface FetchedSnapshot {
  item: RakutenItemWithSkus;
  checks: RakutenItemEntryChecks;
  /** 장르 경로(모르면 null) */
  genreIdPath: number[] | null;
}

/**
 * 라쿠텐 상품 페이지 한 건 → 스냅샷(F-SO-13·14·32, F-SO-07, F-BS-37). URL 입구·재조회·(P2-03) 재고 확인·페이지 조회 반복이 같이 쓴다.
 * 1. 페이지 포트(관문 RAKUTEN_PAGE 직렬 큐, 보내기 직전 call_log — 하루 상한 1건). 409 하루 상한·쉼은 그대로 던진다
 * 2. 200이 아니거나 점검 페이지·파싱 실패 → 502 EXTERNAL_API_ERROR(details.target=RAKUTEN_PAGE·reason). 행을 만들지 않는다
 * 3. itemCode: 페이지 JSON(`샵코드:상품관리번호`), 없으면 F-BS-37 보완 조회
 * 4. 장르: 페이지 JSON(genre_source PAGE_JSON), 없으면 itemCode로 Item Search(ITEM_SEARCH), 그래도 없으면 NOT_FOUND.
 *    장르 경로는 IchibaGenre 캐시(rakuten_genre). 보완 조회가 실패해도 URL 입구는 멈추지 않는다(장르 모름 → 성인용 확인)
 * 5. rakuten_item + rakuten_sku 한 트랜잭션(원본 바이트는 데이터 폴더) → 입구 검사(제외어·장르 범위·사이즈 의심)
 */
@Injectable()
export class RakutenItemFetcher {
  private readonly logger = new Logger(RakutenItemFetcher.name);

  constructor(
    @Inject(RAKUTEN_PAGE_PORT) private readonly pages: RakutenPagePort,
    @Inject(RAKUTEN_SEARCH_PORT) private readonly search: RakutenSearchPort,
    private readonly genres: RakutenGenreService,
    private readonly resolver: ItemCodeResolver,
    private readonly items: RakutenItemRepository,
    private readonly settings: SettingsService,
  ) {}

  async fetchSnapshot(
    url: RakutenItemUrl,
    options: FetchSnapshotOptions,
  ): Promise<FetchedSnapshot> {
    const ctx = { candidateId: options.candidateId ?? null, stepRunId: options.stepRunId ?? null };
    const res = await this.pages.fetchPage(url.url, ctx);
    if (res.httpStatus !== 200) throw pageFailure(`HTTP_${res.httpStatus}`, res.callLogId);
    const parsed = parseItemPage(res.bytes);
    if (parsed.kind === 'MAINTENANCE') throw pageFailure('MAINTENANCE_PAGE', res.callLogId);
    if (parsed.kind === 'PARSE_FAILED') throw pageFailure('PARSE_FAILED', res.callLogId);
    const page = parsed.page;

    const code = options.knownItemCode
      ? { ...options.knownItemCode, source: 'PAGE_JSON' as const }
      : await this.resolver.resolve(page, url, ctx);

    let genreId = page.genreId;
    let genreSource: RakutenGenreSource = genreId !== null ? 'PAGE_JSON' : 'NOT_FOUND';
    if (genreId === null) {
      genreId = await this.genreFromItemSearch(code.itemCode, ctx);
      if (genreId !== null) genreSource = 'ITEM_SEARCH';
    }
    const genrePath = genreId !== null ? await this.genres.pathOf(genreId, ctx) : null;

    const item = await this.items.insertSnapshot({
      page,
      itemCode: code.itemCode,
      shopCode: code.shopCode,
      itemUrl: url.url,
      entrySource: options.entrySource,
      fetchReason: options.fetchReason,
      collectedAt: res.fetchedAt,
      genreId,
      genreSource,
      genrePath: genrePath?.namePath ?? null,
      rawBytes: res.bytes,
    });
    const genreIdPath = genrePath?.idPath ?? null;
    return { item, checks: this.checksOf(item, genreIdPath), genreIdPath };
  }

  /** 입구 검사(규칙 12) — 스냅샷 값과 장르 경로로 */
  checksOf(
    item: Pick<RakutenItemWithSkus, 'itemName' | 'skus'>,
    genreIdPath: readonly number[] | null,
  ): RakutenItemEntryChecks {
    const settings = this.settings.current();
    return entryChecksOf(
      { itemName: item.itemName, genreIdPath, sizesMm: item.skus.map((s) => s.sizeMm) },
      { excludedWords: settings.sourcing.ngKeywords, childShoe: childShoeRulesOf(settings) },
    );
  }

  /** F-SO-07 장르 보완: itemCode로 Item Search. 부를 수 없거나 못 찾으면 null(장르 모름) */
  private async genreFromItemSearch(
    itemCode: string,
    ctx: { candidateId: number | null; stepRunId: number | null },
  ): Promise<number | null> {
    try {
      const result = await this.search.search({ itemCode, sourcingFilters: false }, ctx);
      const hit = result.items.find((i) => i.itemCode === itemCode) ?? result.items[0];
      return hit?.genreId && hit.genreId > 0 ? hit.genreId : null;
    } catch (error) {
      const reason = error instanceof ApiException ? error.code : (error as Error)?.name;
      this.logger.warn(`itemCode로 장르를 보완하지 못했습니다(${reason ?? 'Error'})`);
      return null;
    }
  }
}
