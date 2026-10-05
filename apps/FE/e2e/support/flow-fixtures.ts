import { test as base, expect, type APIRequestContext } from '@playwright/test';

/**
 * 가짜 연동 BE(apps/BE/test/flow) 주소 — 앱 API는 Vite 프록시를 거치지만 준비·확인은 바로 부른다.
 * 포트는 playwright.config.ts와 같은 환경 변수(FLOW_BE_PORT 기본 3100, FLOW_CONTROL_PORT 기본 3101)를 읽는다.
 */
export const BE_URL = `http://127.0.0.1:${Number(process.env.FLOW_BE_PORT ?? 3100)}`;
/** 흐름 테스트 제어 API(테스트 전용, 앱 API가 아니다) */
export const CONTROL_URL = `http://127.0.0.1:${Number(process.env.FLOW_CONTROL_PORT ?? 3101)}`;
/** 브라우저가 부를 수 있는 호스트(앱 = Vite 127.0.0.1:FLOW_FE_PORT(기본 5173), 이미지 = /api/v1/image-assets) */
const APP_HOST = '127.0.0.1';
const RAKUTEN_IMAGE_HOST = 'thumbnail.image.rakuten.co.jp';
/** 투명한 1×1 PNG */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
/** 가짜 키체인 값의 표식(flow-app.ts FLOW_SECRETS) — 화면에 나오면 안 된다 */
const SECRET_MARKERS = ['TEST-SECRET-', 'TESTSECRETCOMMERCE'];

/** flow-fakes.ts `FlowFakeModes` */
export interface FlowFakeModes {
  createMode?: '200' | '400' | '500' | '503' | 'TIMEOUT' | 'RESET' | 'HOLD';
  searchMode?: 'EMPTY' | 'FOUND' | '500';
  release?: boolean;
}

export interface FlowViolation {
  at: string;
  method: string;
  url: string;
}

/** 제어 API `GET /__flow/state`(수만 — 본문·키 없음) */
export interface FlowState {
  httpFetch: string;
  fakeHosts: string[];
  violations: FlowViolation[];
  supervisorViolations: FlowViolation[];
  commerce: {
    tokenRequests: number;
    tokenFormKeys: string[][];
    productCreates: number;
    productCreateDisplayStatus: (string | null)[];
    sellerCodeSearches: number;
    imageUploadRequests: number;
    imageUploadParts: number;
    restrictedBatches: number;
    recommendKeywords: string[];
    createMode: string;
    searchMode: string;
  };
  rakuten: { search: number; genre: number; page: number; image: number };
  imageGen: number;
  ai: { claude: string[]; agy: number; codex: number };
}

export interface FlowControl {
  /** BE를 끄고 테스트 DB를 비운 뒤 시작점 시드로 다시 켠다 */
  reset(fakes?: FlowFakeModes): Promise<void>;
  /** BE만 끄고(SIGTERM) DB는 그대로 다시 켠다 — 앱 재시작 */
  restart(fakes?: FlowFakeModes): Promise<void>;
  fakes(modes: FlowFakeModes): Promise<FlowState>;
  state(): Promise<FlowState>;
}

interface FlowFixtures {
  /** 테스트마다 가짜 연동 BE를 새로 켠다(auto). 끝나면 BE가 허용 밖 호스트를 부르지 않았는지 본다 */
  flow: FlowControl;
  /** 127.0.0.1 밖 브라우저 요청을 끊고 모은다(auto). 끝나면 0건이어야 한다 */
  blockedRequests: string[];
  /** 가짜 연동 BE API(/api/v1, X-AutoStore-Client) — 화면 결과를 데이터로 한 번 더 확인할 때 */
  api: APIRequestContext;
}

export const test = base.extend<FlowFixtures>({
  flow: [
    async ({ playwright }, use) => {
      const control = await playwright.request.newContext({ baseURL: CONTROL_URL });
      const post = async (path: string, body: unknown) => {
        const res = await control.post(path, { data: body, timeout: 180_000 });
        expect(res.ok(), `${path} ${res.status()} ${await res.text()}`).toBe(true);
        return res;
      };
      const flow: FlowControl = {
        reset: async (fakes) => {
          await post('/__flow/reset', { fakes });
        },
        restart: async (fakes) => {
          await post('/__flow/restart', { fakes });
        },
        fakes: async (modes) => (await (await post('/__flow/fakes', modes)).json()) as FlowState,
        state: async () => (await (await control.get('/__flow/state')).json()) as FlowState,
      };
      await flow.reset();
      await use(flow);
      const state = await flow.state();
      expect(state.violations, 'BE가 가짜가 없는 호스트를 불렀다').toEqual([]);
      expect(state.supervisorViolations, 'BE가 가짜가 없는 호스트를 불렀다').toEqual([]);
      await control.dispose();
    },
    { auto: true },
  ],
  blockedRequests: [
    async ({ context }, use) => {
      const blocked: string[] = [];
      await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === APP_HOST) return route.continue();
        // ② '상품 고르기' 목록의 상품 사진(라쿠텐 썸네일 주소)은 실제로 받지 않고 1×1 그림으로 답한다(바깥 호출 0건 유지)
        if (url.hostname === RAKUTEN_IMAGE_HOST && route.request().resourceType() === 'image') {
          return route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG });
        }
        blocked.push(route.request().url());
        return route.abort('blockedbyclient');
      });
      await use(blocked);
      expect(blocked, '브라우저가 127.0.0.1 밖(글꼴·CDN·이미지)을 불렀다').toEqual([]);
    },
    { auto: true },
  ],
  api: async ({ playwright }, use) => {
    const api = await playwright.request.newContext({
      baseURL: `${BE_URL}/api/v1/`,
      extraHTTPHeaders: { 'X-AutoStore-Client': '1' },
    });
    await use(api);
    await api.dispose();
  },
  page: async ({ page }, use) => {
    await use(page);
    // 화면 어디에도 가짜 키체인 값이 없다(US-27 AC1·NFR-02)
    if (!page.isClosed()) {
      const html = await page.content();
      for (const marker of SECRET_MARKERS) expect(html).not.toContain(marker);
    }
  },
});

export { expect };
