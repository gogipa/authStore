/**
 * 가짜 커머스API 상품 등록·판매자관리코드 조회(P4-03). 실제 커머스API를 부르지 않는다(실제 스토어 — 샌드박스 없음).
 * - `FakeCommerceProductsServer.fetchHandler(transport)`: 가짜 fetch(HTTP_FETCH)의 handler. `POST /v2/products`·`POST /v1/products/search`
 *   요청을 받은 순서대로 기록하고(본문 JSON·Authorization), 모드에 따라 fixture(`test/fixtures/registration/register`)로 답한다.
 *   그 밖의 경로(토큰·restricted-tags 등)는 P1-07 가짜 커머스 서버(`FakeCommerceTransport.fetchHandler`)로 넘긴다 — 실제 관문(허용 목록·
 *   call_log)을 지난다.
 * - 등록 모드: '200'·'400'·'500'·'503' fixture, 'TIMEOUT'(응답을 보내지 않는다 — 관문의 AbortSignal이 끊을 때까지 기다린다),
 *   'RESET'(연결 끊김 TypeError ECONNRESET), 'HOLD'(`release()`까지 붙잡았다가 200). 검색 모드: 'EMPTY'·'FOUND'(받은 판매자관리코드를 응답에 넣는다)·'500'.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COMMERCE_CREATE_PRODUCT_PATH,
  COMMERCE_PRODUCT_SEARCH_PATH,
} from '../../src/modules/integrations/naver-commerce/commerce-products.port.js';
import type { CommerceFixture, FakeCommerceTransport } from './fake-commerce-transport.js';

export const REGISTER_FIXTURE_DIR = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'registration',
  'register',
);

export type ProductsFixtureName =
  | 'products.200'
  | 'products.400-invalid-inputs'
  | 'products.500'
  | 'products.503'
  | 'products-search.found'
  | 'products-search.empty';

export function productsFixture(name: ProductsFixtureName): CommerceFixture {
  return JSON.parse(
    readFileSync(join(REGISTER_FIXTURE_DIR, `${name}.json`), 'utf8'),
  ) as CommerceFixture;
}

export type CreateProductMode = '200' | '400' | '500' | '503' | 'TIMEOUT' | 'RESET' | 'HOLD';
export type SellerCodeSearchMode = 'EMPTY' | 'FOUND' | '500';

export interface RecordedProductsRequest {
  path: string;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

const CREATE_FIXTURE: Record<'200' | '400' | '500' | '503', ProductsFixtureName> = {
  '200': 'products.200',
  '400': 'products.400-invalid-inputs',
  '500': 'products.500',
  '503': 'products.503',
};

function headerOf(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

function toResponse(fixture: CommerceFixture): Response {
  return new Response(JSON.stringify(fixture.body), {
    status: fixture.status,
    headers: { 'Content-Type': 'application/json', ...fixture.headers },
  });
}

export class FakeCommerceProductsServer {
  readonly creates: RecordedProductsRequest[] = [];
  readonly searches: RecordedProductsRequest[] = [];
  createMode: CreateProductMode = '200';
  searchMode: SellerCodeSearchMode = 'EMPTY';
  private held: (() => void)[] = [];

  reset(): void {
    this.creates.length = 0;
    this.searches.length = 0;
    this.createMode = '200';
    this.searchMode = 'EMPTY';
    this.release();
  }

  /** 'HOLD'로 붙잡은 등록 요청을 200으로 풀어 준다(재시작 정리 e2e — 응답 전에 앱이 꺼진 것처럼) */
  release(): void {
    const held = this.held;
    this.held = [];
    for (const open of held) open();
  }

  /** 가짜 fetch handler: 등록·검색 경로는 여기서, 나머지는 P1-07 가짜 커머스 서버로 */
  fetchHandler(
    transport: FakeCommerceTransport,
  ): (url: string, init: RequestInit) => Promise<Response> {
    return async (url, init) => {
      const path = new URL(url).pathname;
      const recorded = (): RecordedProductsRequest => ({
        path,
        body:
          typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
        authorization: headerOf(init, 'authorization'),
      });
      if (path.endsWith(COMMERCE_CREATE_PRODUCT_PATH)) {
        this.creates.push(recorded());
        if (this.createMode === 'TIMEOUT') {
          return new Promise<Response>((_, reject) => {
            const signal = init.signal;
            if (!signal) return;
            // fetch가 시간 초과로 끊을 때와 같은 이름(TimeoutError)으로 거절한다(Jest vm 안에서는 DOMException이 Error가 아니다)
            const onAbort = () => {
              const error = new Error('The operation was aborted due to timeout');
              error.name = 'TimeoutError';
              reject(error);
            };
            signal.addEventListener('abort', onAbort, { once: true });
          });
        }
        if (this.createMode === 'HOLD') {
          await new Promise<void>((resolve) => this.held.push(resolve));
          return toResponse(productsFixture('products.200'));
        }
        if (this.createMode === 'RESET') {
          const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
          throw new TypeError('fetch failed', { cause });
        }
        return toResponse(productsFixture(CREATE_FIXTURE[this.createMode]));
      }
      if (path.endsWith(COMMERCE_PRODUCT_SEARCH_PATH)) {
        const req = recorded();
        this.searches.push(req);
        if (this.searchMode === '500') return toResponse(productsFixture('products.500'));
        if (this.searchMode === 'EMPTY')
          return toResponse(productsFixture('products-search.empty'));
        const raw = req.body?.sellerManagementCode;
        const code = typeof raw === 'string' ? raw : '';
        const found = productsFixture('products-search.found');
        return toResponse({
          ...found,
          body: JSON.parse(JSON.stringify(found.body).replace('{sellerManagementCode}', code)),
        });
      }
      return transport.fetchHandler(url, init);
    };
  }
}
