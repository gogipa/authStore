/**
 * 가짜 커머스API 태그 서버(P3-05). 실제 커머스API를 부르지 않는다.
 * `FakeCommerceTransport`(P1-07)의 기본 응답을 태그 경로별 fixture로 바꾼다 — 토큰 경로는 그대로 token-200.
 * - recommend-tags: `keyword` 쿼리 → `test/fixtures/tags/recommend-tags/*.json`(파일의 `keyword`), 모르는 키워드는 빈 목록
 * - restricted-tags: 반복 쿼리 `tags` → 요청한 태그마다 `{tag, restricted}`(제한 목록 = `restricted-tags/response.json`)
 * e2e는 같은 transport의 `fetchHandler`를 가짜 fetch(HTTP_FETCH) 뒤에 두어 실제 관문(허용 목록·call_log)을 지나게 한다.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMMERCE_TOKEN_PATH } from '../../src/modules/integrations/naver-commerce/commerce-endpoints.js';
import {
  COMMERCE_RECOMMEND_TAGS_PATH,
  COMMERCE_RESTRICTED_TAGS_PATH,
} from '../../src/modules/integrations/naver-commerce/commerce-tags.port.js';
import {
  commerceAuthFixture,
  type CommerceFixture,
  type FakeCommerceTransport,
  type RecordedCommerceRequest,
} from './fake-commerce-transport.js';

export const TAGS_FIXTURE_DIR = join(import.meta.dirname, '..', 'fixtures', 'tags');

interface RecommendFixture {
  keyword: string;
  status: number;
  body: unknown;
}

/** recommend-tags fixture 전부(키워드 → 응답) */
export function recommendFixtures(): Map<string, RecommendFixture> {
  const dir = join(TAGS_FIXTURE_DIR, 'recommend-tags');
  const out = new Map<string, RecommendFixture>();
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const fixture = JSON.parse(readFileSync(join(dir, name), 'utf8')) as RecommendFixture;
    out.set(fixture.keyword, fixture);
  }
  return out;
}

/** 제한 태그 목록(restricted-tags/response.json의 restricted=true) */
export function restrictedFixtureTags(): string[] {
  const fixture = JSON.parse(
    readFileSync(join(TAGS_FIXTURE_DIR, 'restricted-tags', 'response.json'), 'utf8'),
  ) as { body: { tag: string; restricted: boolean }[] };
  return fixture.body.filter((v) => v.restricted).map((v) => v.tag);
}

export function tagsFixtureBytes(name: string): Buffer {
  return readFileSync(join(TAGS_FIXTURE_DIR, name));
}

export function tagsFixtureText(name: string): string {
  return readFileSync(join(TAGS_FIXTURE_DIR, name), 'utf8');
}

function ok(body: unknown): CommerceFixture {
  return { status: 200, headers: { 'GNCP-GW-Trace-ID': 'fixture-trace-tags' }, body };
}

export class FakeCommerceTagsServer {
  recommend = recommendFixtures();
  restricted = new Set(restrictedFixtureTags());
  /** 받은 추천 키워드(차례로) */
  readonly recommendKeywords: string[] = [];
  /** 받은 제한 태그 묶음(차례로) */
  readonly restrictedBatches: string[][] = [];
  /** 다음 태그 요청 하나를 이 상태로 실패시킨다 */
  private failures: number[] = [];

  install(transport: FakeCommerceTransport): this {
    transport.defaultResponder = (req) => this.respond(req);
    return this;
  }

  failNext(status: number): this {
    this.failures.push(status);
    return this;
  }

  reset(): void {
    this.recommend = recommendFixtures();
    this.restricted = new Set(restrictedFixtureTags());
    this.recommendKeywords.length = 0;
    this.restrictedBatches.length = 0;
    this.failures = [];
  }

  respond(req: RecordedCommerceRequest): CommerceFixture {
    if (req.path.endsWith(COMMERCE_TOKEN_PATH)) return commerceAuthFixture('token-200');
    const url = new URL(req.url);
    const isRecommend = req.path.endsWith(COMMERCE_RECOMMEND_TAGS_PATH);
    const isRestricted = req.path.endsWith(COMMERCE_RESTRICTED_TAGS_PATH);
    if ((isRecommend || isRestricted) && this.failures.length > 0) {
      const status = this.failures.shift()!;
      return {
        status,
        headers: {},
        body: { code: `FAKE_${status}`, message: '가짜 서버 실패', traceId: 'fixture-fail' },
      };
    }
    if (isRecommend) {
      const keyword = url.searchParams.get('keyword') ?? '';
      this.recommendKeywords.push(keyword);
      const fixture = this.recommend.get(keyword);
      return fixture ? { status: fixture.status, headers: {}, body: fixture.body } : ok([]);
    }
    if (isRestricted) {
      const tags = url.searchParams.getAll('tags');
      this.restrictedBatches.push(tags);
      return ok(tags.map((tag) => ({ tag, restricted: this.restricted.has(tag) })));
    }
    return commerceAuthFixture('api-200-ok');
  }
}
