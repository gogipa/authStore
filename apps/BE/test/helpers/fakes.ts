/**
 * e2e 가짜: 시계(CLOCK)·fetch(HTTP_FETCH). Nest DI overrideProvider로 끼운다(Jest ESM은 jest.mock을 못 쓴다).
 * 실제 외부 서비스는 부르지 않는다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../../src/modules/integrations/http/clock.token.js';
import type { HttpFetch } from '../../src/modules/integrations/http/http-fetch.token.js';

/** 가상 시계. sleep은 기다리지 않고 시간만 옮긴다 */
export class FakeClock implements Clock {
  constructor(public ms: number) {}

  now(): Date {
    return new Date(this.ms);
  }

  sleep(ms: number): Promise<void> {
    this.ms += Math.max(0, ms);
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.ms += ms;
  }
}

export interface FakeFetchCall {
  url: string;
  init: RequestInit;
  /** 가상 시계 기준 요청 시작 시각(ms) */
  startedAt: number;
  finishedAt?: number;
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** 받은 요청을 기록하고 handler의 응답을 돌려주는 가짜 fetch */
export class FakeFetch {
  calls: FakeFetchCall[] = [];
  inFlight = 0;
  maxInFlight = 0;
  handler: Handler = () => jsonResponse(200, { ok: true });
  /** 요청 하나가 걸리는 가상 시간(ms) */
  durationMs = 0;

  constructor(private readonly clock: FakeClock) {}

  reset(): void {
    this.calls = [];
    this.inFlight = 0;
    this.maxInFlight = 0;
    this.handler = () => jsonResponse(200, { ok: true });
    this.durationMs = 0;
  }

  readonly fn: HttpFetch = async (url, init) => {
    const call: FakeFetchCall = { url, init, startedAt: this.clock.now().getTime() };
    this.calls.push(call);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.durationMs > 0) await this.clock.sleep(this.durationMs);
      return await this.handler(url, init);
    } finally {
      this.inFlight -= 1;
      call.finishedAt = this.clock.now().getTime();
    }
  };
}

const HTTP_FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'integrations', 'http');

export function httpFixture(name: string): Buffer {
  return readFileSync(join(HTTP_FIXTURES, name));
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** fixture 파일 본문으로 응답을 만든다 */
export function fixtureResponse(status: number, fixture: string, contentType: string): Response {
  return new Response(new Uint8Array(httpFixture(fixture)), {
    status,
    headers: { 'Content-Type': contentType },
  });
}
