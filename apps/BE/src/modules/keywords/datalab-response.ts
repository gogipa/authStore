import type { DatalabRankPageResponse } from '../integrations/datalab/datalab-rank.port.js';
import { type AnomalyAbortReason, KEYWORD_MAX_LENGTH } from './keywords.constants.js';

/**
 * 데이터랩 순위 응답 분류(F-KW-04, PRD §8.1, P2-01 규칙 6). 순수 함수.
 * 응답 모양: Content-Type은 text/html이어도 본문은 JSON `{ returnCode, range, ranks: [{ rank, keyword, linkId }] }`.
 *
 * - OK: 순위가 한 개 이상. `lastPage`면(요청 크기보다 적게 옴) 그 cid의 마지막 페이지라 다음 페이지를 부르지 않는다(Proposed)
 * - END: `ranks: []` — 그 cid의 정상 종료(마지막 페이지 다음)
 * - ABORT: 이상 8종. 자동 재시도 없이 곧바로 멈춘다
 *
 * 판정 순서(Proposed): 403·418·429 → 404 → 그 밖 2xx 아님(본문과 관계없이 NOT_JSON, 상태 코드를 남김) → JSON 아님(NOT_JSON)
 * → `returnCode`가 0이 아니거나 없음(RETURN_CODE) → `ranks`가 배열이 아님·없음(NO_RANKS_KEY) → 빈 배열(END)
 * → 건수·순위 불일치(COUNT_MISMATCH).
 *
 * '건수 불일치' 기준(Proposed — 문서에 없음): 요청 크기(count)보다 많이 옴, 항목의 rank가 1 이상 정수가 아님·keyword가 빈
 * 글자이거나 100자 초과, rank가 그 페이지 구간((page−1)×count+1 ~ page×count) 밖, 같은 rank가 두 번.
 */
export interface RankedEntry {
  rank: number;
  keyword: string;
}

export type DatalabPageVerdict =
  | {
      kind: 'OK';
      entries: RankedEntry[];
      range: string | null;
      /** 요청 크기보다 적게 왔다(그 cid의 마지막 페이지) */
      lastPage: boolean;
    }
  | { kind: 'END'; range: string | null }
  | { kind: 'ABORT'; reason: AnomalyAbortReason; httpStatus: number | null };

export interface DatalabPageContext {
  page: number;
  pageSize: number;
}

function abort(reason: AnomalyAbortReason, httpStatus: number | null): DatalabPageVerdict {
  return { kind: 'ABORT', reason, httpStatus };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toRank(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) && value >= 1 ? value : null;
  if (typeof value === 'string' && /^[1-9]\d{0,8}$/.test(value.trim())) return Number(value);
  return null;
}

function isReturnCodeZero(value: unknown): boolean {
  return value === 0 || value === '0';
}

/** 응답 한 페이지를 분류한다 */
export function classifyDatalabResponse(
  response: DatalabRankPageResponse,
  ctx: DatalabPageContext,
): DatalabPageVerdict {
  const status = response.httpStatus;
  if (status === 403) return abort('HTTP_403', 403);
  if (status === 418) return abort('HTTP_418', 418);
  if (status === 429) return abort('HTTP_429', 429);
  if (status === 404) return abort('HTTP_404', 404);
  if (status < 200 || status >= 300) return abort('NOT_JSON', status);

  let body: unknown;
  try {
    body = JSON.parse(response.bodyText.replace(/^\uFEFF/, ''));
  } catch {
    return abort('NOT_JSON', null);
  }
  if (!isPlainObject(body)) return abort('NO_RANKS_KEY', null);
  if (!isReturnCodeZero(body.returnCode)) return abort('RETURN_CODE', null);
  const range = typeof body.range === 'string' ? body.range : null;
  if (!('ranks' in body) || !Array.isArray(body.ranks)) return abort('NO_RANKS_KEY', null);
  const ranks: unknown[] = body.ranks;
  if (ranks.length === 0) return { kind: 'END', range };
  if (ranks.length > ctx.pageSize) return abort('COUNT_MISMATCH', null);

  const low = (ctx.page - 1) * ctx.pageSize + 1;
  const high = ctx.page * ctx.pageSize;
  const seen = new Set<number>();
  const entries: RankedEntry[] = [];
  for (const item of ranks) {
    if (!isPlainObject(item)) return abort('COUNT_MISMATCH', null);
    const rank = toRank(item.rank);
    const keyword = typeof item.keyword === 'string' ? item.keyword.trim() : '';
    if (rank === null || keyword === '' || [...keyword].length > KEYWORD_MAX_LENGTH) {
      return abort('COUNT_MISMATCH', null);
    }
    if (rank < low || rank > high || seen.has(rank)) return abort('COUNT_MISMATCH', null);
    seen.add(rank);
    entries.push({ rank, keyword });
  }
  return { kind: 'OK', entries, range, lastPage: ranks.length < ctx.pageSize };
}

/**
 * call_log 결과 열(P1-01 관문 describeResponse): 이상이면 error_code에 사유(HTTP_*는 관문 기본값과 같다),
 * 받은 순위 수를 item_count에 넣는다(JSON이 아니거나 ranks가 배열이 아니면 null).
 */
export function describeDatalabResponse(
  response: DatalabRankPageResponse,
  ctx: DatalabPageContext,
): { errorCode: string | null; itemCount: number | null } {
  const verdict = classifyDatalabResponse(response, ctx);
  if (verdict.kind === 'OK') return { errorCode: null, itemCount: verdict.entries.length };
  if (verdict.kind === 'END') return { errorCode: null, itemCount: 0 };
  return { errorCode: verdict.reason, itemCount: countRanks(response.bodyText) };
}

function countRanks(bodyText: string): number | null {
  try {
    const body: unknown = JSON.parse(bodyText.replace(/^\uFEFF/, ''));
    return isPlainObject(body) && Array.isArray(body.ranks) ? body.ranks.length : null;
  } catch {
    return null;
  }
}
