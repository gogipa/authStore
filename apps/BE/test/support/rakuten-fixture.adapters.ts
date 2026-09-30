/**
 * 가짜 라쿠텐(P2-02). fixture(test/fixtures/rakuten)로 Item Search·IchibaGenre·상품 페이지에 답한다. 실제 라쿠텐은 부르지 않는다.
 * - 포트 가짜 3개(`searchPort`·`pagePort`·`genrePort`): 호출과 요청 시각(가짜 시계)을 기록한다. 단위 테스트가 서비스에 바로
 *   넣거나 e2e가 `overrideProvider(RAKUTEN_*_PORT)`로 끼운다
 * - `fetchHandler`: 가짜 fetch(HTTP_FETCH) 처리 함수. 같은 fixture로 답한다 → 실제 어댑터·외부 호출 관문(허용 목록·앱 UA·
 *   1.5초/3초 간격·call_log·하루 상한·24시간 쉼)을 지난다(e2e 기본, P2-01 데이터랩·P1-07 커머스와 같은 방식)
 * 기본 답
 * - Item Search: `itemCode=` → by-itemcode-genre.json, `shopCode=` → by-shop-itemurl.json, 그 밖 → `asics-1201a019-p{page}.json`
 * - IchibaGenre: genre/shoes-558885.json의 `responses[genreId]`, 없으면 404
 * - 상품 페이지: `PAGE_URLS`(경로 → pages/<이름>.eucjp.html), 없으면 404
 * `answerSearch`·`answerPage`로 답을 차례로 바꾼다(예: 429 → 429 → 200).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../../src/modules/integrations/http/clock.token.js';
import type {
  RakutenGenreLookup,
  RakutenGenrePort,
} from '../../src/modules/integrations/rakuten/rakuten-genre.port.js';
import { parseGenreResponse } from '../../src/modules/integrations/rakuten/rakuten-genre.http-adapter.js';
import type {
  RakutenPageCallContext,
  RakutenPagePort,
  RakutenPageResponse,
} from '../../src/modules/integrations/rakuten/rakuten-page.port.js';
import type {
  RakutenApiCallContext,
  RakutenSearchPort,
  RakutenSearchQuery,
  RakutenSearchResult,
} from '../../src/modules/integrations/rakuten/rakuten-search.port.js';
import {
  parseSearchResponse,
  toSearchItem,
} from '../../src/modules/integrations/rakuten/rakuten-search.request.js';

const RAKUTEN_DIR = join(import.meta.dirname, '..', 'fixtures', 'rakuten');

/** 라쿠텐 페이지 fixture 이름(pages/<이름>.eucjp.html) */
export type RakutenPageFixture =
  | 'normal'
  | 'fallback-root'
  | 'maintenance'
  | 'missing-keys'
  | 'child-max-235'
  | 'out-of-genre'
  | 'no-genre'
  | 'excluded-word-chuko'
  | 'no-item-code';

/** 상품 페이지 주소(item.rakuten.co.jp/<샵>/<상품>/) → fixture. 상품 조각은 itemCode(`샵:관리번호`)와 일부러 다르다 */
export const PAGE_URLS: Readonly<Record<RakutenPageFixture, string>> = {
  normal: 'https://item.rakuten.co.jp/shop-a/asics-1201a019-108/',
  'fallback-root': 'https://item.rakuten.co.jp/shop-a/fallback-root/',
  maintenance: 'https://item.rakuten.co.jp/shop-a/deleted-item/',
  'missing-keys': 'https://item.rakuten.co.jp/shop-m/kayano14-missing/',
  'child-max-235': 'https://item.rakuten.co.jp/shop-k/cortez-w/',
  'out-of-genre': 'https://item.rakuten.co.jp/shop-o/kayano14-training/',
  'no-genre': 'https://item.rakuten.co.jp/shop-g/no-genre-item/',
  'excluded-word-chuko': 'https://item.rakuten.co.jp/shop-u2/used-kayano14/',
  'no-item-code': 'https://item.rakuten.co.jp/shop-e/kayano14-cream-black/',
};

/** EUC-JP 페이지 바이트(받은 그대로) */
export function rakutenPageBytes(name: RakutenPageFixture): Buffer {
  return readFileSync(join(RAKUTEN_DIR, 'pages', `${name}.eucjp.html`));
}

/** 검색 fixture 원문(글자) */
export function rakutenSearchFixture(name: string): string {
  return readFileSync(join(RAKUTEN_DIR, 'search', name), 'utf8');
}

/** IchibaGenre fixture: genreId → 응답 본문 */
export function rakutenGenreResponses(): Record<string, unknown> {
  const parsed = JSON.parse(
    readFileSync(join(RAKUTEN_DIR, 'genre', 'shoes-558885.json'), 'utf8'),
  ) as {
    responses: Record<string, unknown>;
  };
  return parsed.responses;
}

/** 답 하나(HTTP 상태 + 본문). 파일 이름은 검색이면 search/, 페이지면 pages/ */
export type RakutenAnswer =
  | { status: number; file: string }
  | { status: number; page: RakutenPageFixture }
  | { status: number; body: string }
  | { error: Error };

export interface RakutenCall {
  kind: 'SEARCH' | 'GENRE' | 'PAGE';
  url: string;
  /** 쿼리(키 포함 — 테스트가 키가 URL에만 가는지 본다) */
  params: Record<string, string>;
  /** 가짜 시계 기준 요청 시각(ms) */
  at: number;
  headers: Record<string, string>;
}

export class RakutenFixtureServer {
  calls: RakutenCall[] = [];
  private searchQueue: RakutenAnswer[] = [];
  private pageQueue: RakutenAnswer[] = [];
  private readonly pageAnswers = new Map<string, RakutenAnswer>();
  private readonly genres = rakutenGenreResponses();

  constructor(private readonly clock: Pick<Clock, 'now'>) {}

  reset(): void {
    this.calls = [];
    this.searchQueue = [];
    this.pageQueue = [];
    this.pageAnswers.clear();
  }

  /** 다음 Item Search 답들(차례로 하나씩 쓴다. 다 쓰면 기본 답) */
  answerSearch(...answers: RakutenAnswer[]): this {
    this.searchQueue.push(...answers);
    return this;
  }

  /** 다음 상품 페이지 답들(차례로. 다 쓰면 주소별 답·기본 답) */
  answerPage(...answers: RakutenAnswer[]): this {
    this.pageQueue.push(...answers);
    return this;
  }

  /** 이 주소의 상품 페이지 답을 늘 바꾼다 */
  answerPageAt(url: string, answer: RakutenAnswer): this {
    this.pageAnswers.set(pathOf(url), answer);
    return this;
  }

  callsOf(kind: RakutenCall['kind']): RakutenCall[] {
    return this.calls.filter((c) => c.kind === kind);
  }

  // ── 답 고르기 ───────────────────────────────────────────────────────────

  private searchAnswer(params: Record<string, string>): RakutenAnswer {
    const queued = this.searchQueue.shift();
    if (queued) return queued;
    if (params.itemCode) return { status: 200, file: 'by-itemcode-genre.json' };
    if (params.shopCode) return { status: 200, file: 'by-shop-itemurl.json' };
    const page = Number(params.page ?? '1');
    return { status: 200, file: `asics-1201a019-p${page}.json` };
  }

  private genreAnswer(params: Record<string, string>): RakutenAnswer {
    const body = this.genres[params.genreId ?? ''];
    return body
      ? { status: 200, body: JSON.stringify(body) }
      : {
          status: 404,
          body: JSON.stringify({ errors: { errorCode: 404, errorMessage: 'not found' } }),
        };
  }

  private pageAnswer(url: string): RakutenAnswer {
    const queued = this.pageQueue.shift();
    if (queued) return queued;
    const fixed = this.pageAnswers.get(pathOf(url));
    if (fixed) return fixed;
    const name = (Object.keys(PAGE_URLS) as RakutenPageFixture[]).find(
      (k) => pathOf(PAGE_URLS[k]) === pathOf(url),
    );
    return name ? { status: 200, page: name } : { status: 404, body: 'Not Found' };
  }

  private static bytesOf(answer: Exclude<RakutenAnswer, { error: Error }>): Buffer {
    if ('page' in answer) return rakutenPageBytes(answer.page);
    if ('file' in answer) return Buffer.from(rakutenSearchFixture(answer.file), 'utf8');
    return Buffer.from(answer.body, 'utf8');
  }

  private record(kind: RakutenCall['kind'], url: string, headers: Record<string, string> = {}) {
    const u = new URL(url);
    this.calls.push({
      kind,
      url,
      params: Object.fromEntries(u.searchParams),
      at: this.clock.now().getTime(),
      headers,
    });
    return Object.fromEntries(u.searchParams);
  }

  // ── 가짜 fetch(e2e) ─────────────────────────────────────────────────────

  readonly fetchHandler = (url: string, init: RequestInit): Response => {
    const u = new URL(url);
    const headers = { ...(init.headers as Record<string, string>) };
    let answer: RakutenAnswer;
    let contentType: string;
    if (u.hostname === 'openapi.rakuten.co.jp') {
      const kind = u.pathname.includes('IchibaGenre') ? 'GENRE' : 'SEARCH';
      const params = this.record(kind, url, headers);
      answer = kind === 'GENRE' ? this.genreAnswer(params) : this.searchAnswer(params);
      contentType = 'application/json;charset=UTF-8';
    } else {
      this.record('PAGE', url, headers);
      answer = this.pageAnswer(url);
      contentType = 'text/html;charset=EUC-JP';
    }
    if ('error' in answer) throw answer.error;
    return new Response(new Uint8Array(RakutenFixtureServer.bytesOf(answer)), {
      status: answer.status,
      headers: { 'Content-Type': contentType },
    });
  };

  // ── 포트 가짜(단위·overrideProvider) ─────────────────────────────────────

  readonly searchPort: RakutenSearchPort = {
    search: (
      query: RakutenSearchQuery,
      _ctx?: RakutenApiCallContext,
    ): Promise<RakutenSearchResult> => {
      const params: Record<string, string> = { page: String(query.page ?? 1) };
      if (query.keyword) params.keyword = query.keyword;
      if (query.shopCode) params.shopCode = query.shopCode;
      if (query.itemCode) params.itemCode = query.itemCode;
      const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701?${new URLSearchParams(params).toString()}`;
      this.record('SEARCH', url);
      const answer = this.searchAnswer(params);
      if ('error' in answer) return Promise.reject(answer.error);
      const parsed = parseSearchResponse(RakutenFixtureServer.bytesOf(answer).toString('utf8'));
      const items = (parsed?.items ?? []).map(toSearchItem).filter((i) => i !== null);
      return Promise.resolve({
        items,
        page: query.page ?? 1,
        totalCount: parsed?.totalCount ?? null,
        fetchedAt: this.clock.now(),
        fromCache: false,
        queryHash: '0'.repeat(64),
      });
    },
  };

  readonly genrePort: RakutenGenrePort = {
    fetchGenre: (genreId: number): Promise<RakutenGenreLookup | null> => {
      const params = this.record(
        'GENRE',
        `https://openapi.rakuten.co.jp/ichibagt/api/IchibaGenre/Search/20170711?genreId=${genreId}`,
      );
      const answer = this.genreAnswer(params);
      if ('error' in answer || answer.status !== 200) return Promise.resolve(null);
      const parsed = parseGenreResponse(RakutenFixtureServer.bytesOf(answer).toString('utf8'));
      return Promise.resolve(parsed === 'INVALID' ? null : parsed);
    },
  };

  /** 상품 페이지 가짜(쉼·하루 상한은 흉내 내지 않는다 — 그 규칙은 관문 e2e가 본다) */
  readonly pagePort: RakutenPagePort = {
    fetchPage: (url: string, _ctx?: RakutenPageCallContext): Promise<RakutenPageResponse> => {
      this.record('PAGE', url);
      const answer = this.pageAnswer(url);
      if ('error' in answer) return Promise.reject(answer.error);
      return Promise.resolve({
        httpStatus: answer.status,
        bytes: RakutenFixtureServer.bytesOf(answer),
        fetchedAt: this.clock.now(),
        callLogId: this.calls.length,
      });
    },
  };
}

function pathOf(url: string): string {
  const u = new URL(url);
  return u.pathname.endsWith('/') ? u.pathname : `${u.pathname}/`;
}
