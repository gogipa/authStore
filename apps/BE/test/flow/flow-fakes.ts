/**
 * 흐름 테스트(P5-01) 가짜 연동 묶음. 앞 문서들이 만든 가짜 서버·fixture를 그대로 이어 붙인다 — 실제 커머스API·라쿠텐·데이터랩·
 * 환율·AI CLI·이미지 생성은 부르지 않는다.
 * - HTTP_FETCH 자리에 `fetch`(호스트별 라우터)를 끼운다. 실제 관문(`ExternalHttpGateway` — 허용 목록·UA·간격·call_log)은 그대로
 *   지나고, 소켓은 열지 않는다. 라우터가 모르는 호스트는 `violations`에 남기고 연결 오류로 끊는다(흐름 테스트가 0건을 본다)
 * - 커머스API(api.commerce.naver.com): 토큰·추천/제한 태그·이미지 업로드·상품 등록·판매자관리코드 조회
 * - 라쿠텐: Item Search 키워드 검색 = `anchor-match12-p{page}.json`(P2-03 비교표 fixture), 그 밖(itemCode·shopCode 검색·장르·
 *   상품 페이지)은 `RakutenFixtureServer` 기본 답. 상품 이미지 CDN 3곳은 `test/fixtures/thumbnails/images` 파일로 답한다
 * - AI CLI는 `AI_ENGINE_ADAPTERS` 가짜(⑥-1 카피·⑥-2 사양·② 동일 상품 보조), 이미지 생성은 `FakeImageGenProvider`
 */
import type { Clock } from '../../src/modules/integrations/http/clock.token.js';
import type { HttpFetch } from '../../src/modules/integrations/http/http-fetch.token.js';
import { FakeImageGenProvider } from '../../src/modules/integrations/image-gen/fake-image-gen.provider.js';
import { COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH } from '../../src/modules/integrations/naver-commerce/commerce-images.port.js';
import { useFakeContentAi } from '../fixtures/content/seed-content.js';
import {
  thumbnailImageBytes,
  thumbnailItemFixture,
} from '../fixtures/thumbnails/seed-thumbnail-waiting.js';
import { useFakeAiMatch } from '../support/fake-ai-engine.adapter.js';
import { createFakeAiEngines, type FakeAiEngines } from '../support/fake-ai-engines.js';
import { FakeCommerceImagesServer } from '../support/fake-commerce-images.js';
import {
  type CreateProductMode,
  FakeCommerceProductsServer,
  type SellerCodeSearchMode,
} from '../support/fake-commerce-products.js';
import { FakeCommerceTagsServer } from '../support/fake-commerce-tags.js';
import { FakeCommerceTransport } from '../support/fake-commerce-transport.js';
import { RakutenFixtureServer, rakutenSearchFixture } from '../support/rakuten-fixture.adapters.js';

/** 흐름 테스트 시계: 실제 시각을 따라가되 관문의 간격 대기(sleep)는 기다리지 않고 시각만 앞당긴다 */
export class FlowClock implements Clock {
  private offsetMs = 0;

  now(): Date {
    return new Date(Date.now() + this.offsetMs);
  }

  sleep(ms: number): Promise<void> {
    this.offsetMs += Math.max(0, ms);
    return Promise.resolve();
  }
}

const COMMERCE_HOST = 'api.commerce.naver.com';
const RAKUTEN_API_HOST = 'openapi.rakuten.co.jp';
const RAKUTEN_PAGE_HOST = 'item.rakuten.co.jp';
const RAKUTEN_IMAGE_HOSTS = [
  'tshop.r10s.jp',
  'image.rakuten.co.jp',
  'thumbnail.image.rakuten.co.jp',
];
/** 가짜가 답하는 호스트(이 밖은 위반) */
export const FLOW_FAKE_HOSTS = [
  COMMERCE_HOST,
  RAKUTEN_API_HOST,
  RAKUTEN_PAGE_HOST,
  ...RAKUTEN_IMAGE_HOSTS,
] as const;

/** fixture 지도에 없는 상품 이미지 주소에 답할 파일(test/fixtures/thumbnails/images) */
const FALLBACK_IMAGES = [
  'original-1.jpg',
  'original-2.jpg',
  'original-3.jpg',
  'original-4.jpg',
  'original-5.jpg',
  'original-6.jpg',
] as const;

function hashOf(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** 흐름 테스트가 바꾸는 가짜 동작(제어 API `POST /__flow/fakes`) */
export interface FlowFakeModes {
  /** ⑨ 상품 등록 응답(기본 200). HOLD = 응답을 붙잡는다(재시작 시험) */
  createMode?: CreateProductMode;
  /** 판매자관리코드 조회 응답(기본 EMPTY) */
  searchMode?: SellerCodeSearchMode;
  /** 붙잡은 등록 요청을 200으로 푼다 */
  release?: boolean;
}

export interface FlowViolation {
  at: string;
  method: string;
  /** 쿼리를 뺀 주소(키가 쿼리에 실려도 남지 않게) */
  url: string;
}

export class FlowFakes {
  readonly clock = new FlowClock();
  readonly ai: FakeAiEngines = createFakeAiEngines();
  readonly imageGen = new FakeImageGenProvider();
  readonly commerce = new FakeCommerceTransport();
  readonly tags = new FakeCommerceTagsServer();
  readonly images = new FakeCommerceImagesServer();
  readonly products = new FakeCommerceProductsServer();
  readonly rakuten = new RakutenFixtureServer(this.clock);
  readonly violations: FlowViolation[] = [];
  readonly imageRequests: string[] = [];
  private readonly commerceFetch: (url: string, init: RequestInit) => Promise<Response>;
  private readonly imageFiles = thumbnailItemFixture().imageFiles;

  constructor(
    modes: FlowFakeModes = {},
    private readonly onViolation: (v: FlowViolation) => void = () => undefined,
  ) {
    // 커머스 기본 응답: 이미지 업로드는 이미지 가짜, 그 밖(토큰·태그)은 태그 가짜
    this.commerce.defaultResponder = (req) =>
      req.path.endsWith(COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH)
        ? this.images.respond(req)
        : this.tags.respond(req);
    this.commerceFetch = this.products.fetchHandler(this.commerce);
    useFakeAiMatch(this.ai);
    useFakeContentAi(this.ai);
    this.apply(modes);
  }

  apply(modes: FlowFakeModes): void {
    if (modes.createMode) this.products.createMode = modes.createMode;
    if (modes.searchMode) this.products.searchMode = modes.searchMode;
    if (modes.release) this.products.release();
  }

  /** HTTP_FETCH 자리 */
  readonly fetch: HttpFetch = async (url, init) => {
    const u = new URL(url);
    if (u.hostname === COMMERCE_HOST) return this.commerceFetch(url, init);
    if (u.hostname === RAKUTEN_API_HOST && u.pathname.includes('IchibaItem')) {
      const keyword = u.searchParams.get('keyword');
      if (keyword && !u.searchParams.get('itemCode') && !u.searchParams.get('shopCode')) {
        // 키워드 검색: P2-03 비교표 fixture(1쪽 MATCH 12 + …, 2쪽 MATCH 2)
        this.rakuten.calls.push({
          kind: 'SEARCH',
          url,
          params: Object.fromEntries(u.searchParams),
          at: this.clock.now().getTime(),
          headers: {},
        });
        const page = Number(u.searchParams.get('page') ?? '1') >= 2 ? 2 : 1;
        return new Response(rakutenSearchFixture(`anchor-match12-p${page}.json`), {
          status: 200,
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
        });
      }
    }
    if (u.hostname === RAKUTEN_API_HOST || u.hostname === RAKUTEN_PAGE_HOST) {
      return this.rakuten.fetchHandler(url, init);
    }
    if (RAKUTEN_IMAGE_HOSTS.includes(u.hostname)) {
      this.imageRequests.push(url);
      // fixture 지도에 없는 상품 이미지 주소(예: 비교표 샵 페이지의 media.images)도 작은 실제 JPEG로 답한다(주소마다 다른 파일)
      const name = this.imageFiles[url] ?? FALLBACK_IMAGES[hashOf(url) % FALLBACK_IMAGES.length]!;
      return new Response(new Uint8Array(thumbnailImageBytes(name)), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      });
    }
    const violation: FlowViolation = {
      at: new Date().toISOString(),
      method: (init.method ?? 'GET').toUpperCase(),
      url: `${u.protocol}//${u.host}${u.pathname}`,
    };
    this.violations.push(violation);
    this.onViolation(violation);
    throw new TypeError(`fetch failed (흐름 테스트: 가짜가 없는 호스트 ${u.host})`);
  };

  /** 제어 API `GET /__flow/state`의 가짜 쪽 값(본문·키 없이 수만) */
  state() {
    return {
      httpFetch: 'flow-fake-router' as const,
      fakeHosts: [...FLOW_FAKE_HOSTS],
      violations: [...this.violations],
      commerce: {
        tokenRequests: this.commerce.tokenRequests.length,
        tokenFormKeys: this.commerce.tokenRequests.map((r) =>
          [...new URLSearchParams(r.body ?? '').keys()].sort(),
        ),
        productCreates: this.products.creates.length,
        productCreateDisplayStatus: this.products.creates.map(
          (c) =>
            ((c.body?.smartstoreChannelProduct as Record<string, unknown> | undefined)
              ?.channelProductDisplayStatusType as string | undefined) ?? null,
        ),
        sellerCodeSearches: this.products.searches.length,
        imageUploadRequests: this.images.requestCount,
        imageUploadParts: this.images.partCount,
        restrictedBatches: this.tags.restrictedBatches.length,
        recommendKeywords: [...this.tags.recommendKeywords],
        createMode: this.products.createMode,
        searchMode: this.products.searchMode,
      },
      rakuten: {
        search: this.rakuten.callsOf('SEARCH').length,
        genre: this.rakuten.callsOf('GENRE').length,
        page: this.rakuten.callsOf('PAGE').length,
        image: this.imageRequests.length,
      },
      imageGen: this.imageGen.calls.length,
      ai: {
        claude: this.ai.claude.calls.runStructured.map((c) => c.task),
        agy: this.ai.agy.calls.runStructured.length,
        codex: this.ai.codex.calls.runStructured.length,
      },
    };
  }
}
