/**
 * 가짜 커머스API 메타 서버(P1-08). 실제 커머스API를 부르지 않는다.
 * `FakeCommerceTransport`(P1-07)의 기본 응답을 경로별 메타 fixture로 바꾼다 — 토큰 경로는 그대로 token-200.
 * - 단위 테스트: `createCommerceKit()`의 transport에 `install(kit.transport)`.
 * - e2e: 같은 transport의 `fetchHandler`를 가짜 fetch(HTTP_FETCH)에 두면 실제 관문(call_log)을 지난다.
 * 특정 경로만 실패시키려면 `override('/v1/seller/addressbooks-for-page', 'error-500')`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMERCE_TOKEN_PATH } from '../../src/modules/integrations/naver-commerce/commerce-endpoints.js';
import {
  commerceAuthFixture,
  type CommerceFixture,
  type FakeCommerceTransport,
  type RecordedCommerceRequest,
} from './fake-commerce-transport.js';

const META_FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'commerce', 'meta');
/** 커머스API 주소의 경로 앞부분(`https://api.commerce.naver.com/external`) */
const BASE_PATH = '/external';

export function metaFixturePath(name: string): string {
  return join(META_FIXTURES, `${name}.json`);
}

export function hasMetaFixture(name: string): boolean {
  return existsSync(metaFixturePath(name));
}

export function commerceMetaFixture(name: string): CommerceFixture {
  return JSON.parse(readFileSync(metaFixturePath(name), 'utf8')) as CommerceFixture;
}

/** fixture 본문(응답 body만) */
export function metaFixtureBody<T = unknown>(name: string): T {
  return commerceMetaFixture(name).body as T;
}

function ok(body: unknown, traceId: string): CommerceFixture {
  return { status: 200, headers: { 'GNCP-GW-Trace-ID': traceId }, body };
}

function notFound(): CommerceFixture {
  return {
    status: 404,
    headers: { 'GNCP-GW-Trace-ID': 'fixture-trace-404' },
    body: { code: 'NOT_FOUND', message: '대상을 찾을 수 없습니다.', traceId: 'fixture-trace-404' },
  };
}

type Override = string | CommerceFixture | ((req: RecordedCommerceRequest) => CommerceFixture);

interface CategoryItem {
  id: string;
  name: string;
  wholeCategoryName: string;
}

/** 대상별 예상 건수(fixture 기본 상태: categories-last, 성별 신발 리프 7개) */
export const META_FIXTURE_ITEM_COUNTS = {
  CATEGORY: 8,
  CATEGORY_DETAIL: 7,
  STANDARD_OPTIONS: 7,
  PRODUCT_ATTRIBUTES: 7,
  ORIGIN_AREA: 7,
  ADDRESSBOOK: 4,
  PROVIDED_NOTICE: 1,
  RETURN_DELIVERY_COMPANY: 3,
} as const;

/** 전체 동기화 한 번의 커머스API 호출 수(토큰 발급 제외): 1 + 7 + 7 + 14 + (1+4) + 2 + 1 + 1 */
export const META_FIXTURE_API_CALLS = 38;

export class FakeCommerceMetaServer {
  /** CATEGORY 응답으로 쓸 fixture 이름 */
  categories: 'categories-last' | 'categories-last-v2' = 'categories-last';
  private readonly overrides = new Map<string, Override[]>();
  /** 경로별로 한 번만 쓰는 응답(차례로) */
  private readonly once = new Map<string, Override[]>();

  /** 이 경로(`/v1/...`, 쿼리 없이)의 응답을 늘 이것으로 */
  override(path: string, responder: Override): this {
    this.overrides.set(path, [responder]);
    return this;
  }

  /** 이 경로의 다음 응답들을 차례로(다 쓰면 원래 응답) */
  respondOnce(path: string, ...responders: Override[]): this {
    this.once.set(path, [...(this.once.get(path) ?? []), ...responders]);
    return this;
  }

  reset(): void {
    this.categories = 'categories-last';
    this.overrides.clear();
    this.once.clear();
  }

  /** transport의 기본 응답을 이 서버로 바꾼다(토큰 경로는 token-200) */
  install(transport: FakeCommerceTransport): this {
    transport.defaultResponder = (req) =>
      req.path.endsWith(COMMERCE_TOKEN_PATH) ? commerceAuthFixture('token-200') : this.respond(req);
    return this;
  }

  respond(req: RecordedCommerceRequest): CommerceFixture {
    const url = new URL(req.url);
    const path = url.pathname.startsWith(BASE_PATH)
      ? url.pathname.slice(BASE_PATH.length)
      : url.pathname;
    const queued = this.once.get(path);
    if (queued && queued.length > 0) return this.resolve(queued.shift()!, req);
    const fixed = this.overrides.get(path);
    if (fixed) return this.resolve(fixed[0]!, req);
    return this.route(path, url.searchParams);
  }

  private resolve(responder: Override, req: RecordedCommerceRequest): CommerceFixture {
    if (typeof responder === 'string') return commerceMetaFixture(responder);
    if (typeof responder === 'function') return responder(req);
    return responder;
  }

  private categoryItems(): CategoryItem[] {
    return metaFixtureBody<CategoryItem[]>(this.categories);
  }

  private route(path: string, query: URLSearchParams): CommerceFixture {
    if (path === '/v1/categories') return commerceMetaFixture(this.categories);
    const detail = /^\/v1\/categories\/([^/]+)$/.exec(path);
    if (detail) {
      const id = decodeURIComponent(detail[1]!);
      if (hasMetaFixture(`category-detail-${id}`)) {
        return commerceMetaFixture(`category-detail-${id}`);
      }
      const item = this.categoryItems().find((c) => c.id === id);
      if (!item) return notFound();
      return ok(
        { ...item, last: true, exceptionalCategories: [], certificationInfos: [] },
        `fixture-trace-detail-${id}`,
      );
    }
    const categoryId = query.get('categoryId') ?? '';
    if (path === '/v1/options/standard-options') {
      return hasMetaFixture(`standard-options-${categoryId}`)
        ? commerceMetaFixture(`standard-options-${categoryId}`)
        : ok({ useStandardOption: false, standardOptionCategoryGroups: [] }, 'fixture-trace-so');
    }
    if (path === '/v1/product-attributes/attributes') {
      return hasMetaFixture(`product-attributes-${categoryId}`)
        ? commerceMetaFixture(`product-attributes-${categoryId}`)
        : ok([], 'fixture-trace-attributes-empty');
    }
    if (path === '/v1/product-attributes/attribute-values') {
      return hasMetaFixture(`product-attribute-values-${categoryId}`)
        ? commerceMetaFixture(`product-attribute-values-${categoryId}`)
        : ok([], 'fixture-trace-attribute-values-empty');
    }
    if (path === '/v1/product-origin-areas') return commerceMetaFixture('origin-areas');
    if (path === '/v1/product-origin-areas/sub-origin-areas') {
      const code = query.get('code') ?? '';
      return hasMetaFixture(`origin-areas-sub-${code}`)
        ? commerceMetaFixture(`origin-areas-sub-${code}`)
        : commerceMetaFixture('origin-areas-sub-empty');
    }
    if (path === '/v1/seller/addressbooks-for-page') {
      const page = query.get('page') ?? '1';
      return hasMetaFixture(`addressbooks-page-${page}`)
        ? commerceMetaFixture(`addressbooks-page-${page}`)
        : ok({ addressBooks: [], page: Number(page), totalPages: 2 }, 'fixture-trace-ab-empty');
    }
    if (path === '/v1/products-for-provided-notice/SHOES') {
      return commerceMetaFixture('provided-notice-shoes');
    }
    if (path === '/v2/product-delivery-info/return-delivery-companies') {
      return commerceMetaFixture('return-delivery-companies');
    }
    return notFound();
  }
}
