/**
 * 가짜 데이터랩(P2-01). (cid, page) → fixture 파일·상태 코드로 답한다. 실제 데이터랩은 부르지 않는다.
 * - `port`: `DATALAB_RANK_PORT` 모양(단위 테스트가 서비스에 넣거나 e2e가 overrideProvider로 끼운다). 호출을 기록한다
 * - `fetchHandler`: 가짜 fetch(HTTP_FETCH) 처리 함수. form 본문의 cid·page로 같은 답을 준다 → 실제 어댑터·관문을 지난다
 * - 기본 답: `<cid>-p<page>.json`(없으면 `empty-ranks.json`). `answer(cid, page, …)`로 바꾸고, `hold()`로 다음 요청을
 *   `release()` 때까지 붙잡는다(수집 중 두 번째 요청 검사)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  DatalabRankFetchOptions,
  DatalabRankPageRequest,
  DatalabRankPageResponse,
  DatalabRankPort,
} from '../../src/modules/integrations/datalab/datalab-rank.port.js';

const RANK_DIR = join(import.meta.dirname, '..', 'fixtures', 'datalab', 'rank');
const PASTE_DIR = join(import.meta.dirname, '..', 'fixtures', 'datalab', 'paste');

/** 데이터랩은 JSON 본문을 text/html로 준다(PRD §8.1) */
export const DATALAB_CONTENT_TYPE = 'text/html;charset=UTF-8';

export function datalabRankFixture(name: string): string {
  return readFileSync(join(RANK_DIR, name), 'utf8');
}

export function datalabPasteFixture(name: string): string {
  return readFileSync(join(PASTE_DIR, name), 'utf8');
}

interface StatusCase {
  contentType: string;
  body: string;
}

export function datalabStatusCase(status: 403 | 404 | 418 | 429): DatalabRankPageResponse {
  const cases = JSON.parse(datalabRankFixture('status-cases.json')) as Record<string, StatusCase>;
  const c = cases[String(status)]!;
  return { httpStatus: status, contentType: c.contentType, bodyText: c.body };
}

/** 답 하나: 파일 이름(200) 또는 상태 코드 경우 또는 그대로의 응답 */
export type DatalabAnswer =
  | { file: string; status?: number }
  | { statusCase: 403 | 404 | 418 | 429 }
  | { response: DatalabRankPageResponse }
  | { error: Error };

export interface DatalabCall extends DatalabRankPageRequest {
  /** fetchHandler로 받은 요청이면 form 원문·헤더 */
  form?: URLSearchParams;
  headers?: Record<string, string>;
}

export class DatalabFixtureServer {
  calls: DatalabCall[] = [];
  /** port.describe가 돌려준 call_log 요약(단위 테스트 확인용) */
  described: { errorCode?: string | null; itemCount?: number | null }[] = [];
  private readonly answers = new Map<string, DatalabAnswer>();
  private held: { promise: Promise<void>; release: () => void } | null = null;

  reset(): void {
    this.calls = [];
    this.described = [];
    this.answers.clear();
    this.release();
  }

  /** (cid, page)의 답을 바꾼다 */
  answer(cid: string, page: number, answer: DatalabAnswer): this {
    this.answers.set(`${cid}:${page}`, answer);
    return this;
  }

  /** 다음 요청부터 release() 때까지 답을 붙잡는다 */
  hold(): void {
    if (this.held) return;
    let release!: () => void;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.held = { promise, release };
  }

  release(): void {
    this.held?.release();
    this.held = null;
  }

  /** 받은 요청 수(cid·page 순서 확인용) */
  get callKeys(): string[] {
    return this.calls.map((c) => `${c.cid}:p${c.page}`);
  }

  private resolve(cid: string, page: number): DatalabRankPageResponse {
    const answer = this.answers.get(`${cid}:${page}`) ?? this.defaultAnswer(cid, page);
    if ('error' in answer) throw answer.error;
    if ('response' in answer) return answer.response;
    if ('statusCase' in answer) return datalabStatusCase(answer.statusCase);
    const name = answer.file;
    return {
      httpStatus: answer.status ?? 200,
      contentType: name.endsWith('.html') ? 'text/html;charset=UTF-8' : DATALAB_CONTENT_TYPE,
      bodyText: datalabRankFixture(name),
    };
  }

  private defaultAnswer(cid: string, page: number): DatalabAnswer {
    const name = `${cid}-p${page}.json`;
    try {
      datalabRankFixture(name);
      return { file: name };
    } catch {
      return { file: 'empty-ranks.json' };
    }
  }

  /** 포트 모양(DATALAB_RANK_PORT) */
  readonly port: DatalabRankPort = {
    fetchRankPage: async (
      request: DatalabRankPageRequest,
      options: DatalabRankFetchOptions = {},
    ): Promise<DatalabRankPageResponse> => {
      this.calls.push({ ...request });
      if (this.held) await this.held.promise;
      const response = this.resolve(request.cid, request.page);
      if (options.describe) this.described.push(options.describe(response));
      return response;
    },
  };

  /** 가짜 fetch 처리 함수(e2e: `t.fetch.handler = server.fetchHandler`) */
  readonly fetchHandler = async (_url: string, init: RequestInit): Promise<Response> => {
    const form = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
    const cid = form.get('cid') ?? '';
    const page = Number(form.get('page') ?? '0');
    this.calls.push({
      cid,
      page,
      startDate: form.get('startDate') ?? '',
      endDate: form.get('endDate') ?? '',
      form,
      headers: { ...(init.headers as Record<string, string>) },
    });
    if (this.held) await this.held.promise;
    const response = this.resolve(cid, page);
    return new Response(response.bodyText, {
      status: response.httpStatus,
      headers: response.contentType ? { 'Content-Type': response.contentType } : {},
    });
  };
}
