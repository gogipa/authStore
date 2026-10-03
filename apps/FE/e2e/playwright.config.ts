import { defineConfig } from '@playwright/test';

/**
 * 포트(환경 변수로 바꿀 수 있다 — 기본값은 그대로). 개발 서버(`pnpm dev`)가 3100·5173을 쓰는 동안 돌리려면
 * 예: `FLOW_FE_PORT=5183 FLOW_BE_PORT=3110 FLOW_CONTROL_PORT=3111 pnpm test:flow`.
 * 감독(apps/BE/test/flow/flow-server.mjs)과 fixture(support/flow-fixtures.ts)도 같은 변수를 읽는다.
 */
const FE_PORT = Number(process.env.FLOW_FE_PORT ?? 5173);
const BE_PORT = Number(process.env.FLOW_BE_PORT ?? 3100);
const CONTROL_PORT = Number(process.env.FLOW_CONTROL_PORT ?? 3101);
const FE_URL = `http://127.0.0.1:${FE_PORT}`;

/**
 * 끝까지 흐름 테스트(P5-01). `pnpm test:flow`(저장소 루트)로 돈다. 브라우저는 Playwright Chromium(`playwright install chromium`).
 * - webServer 1: 가짜 연동 BE(apps/BE/test/flow/flow-server.mjs — 127.0.0.1:FLOW_BE_PORT(3100), 제어 FLOW_CONTROL_PORT(3101),
 *   DB autostore_test)
 * - webServer 2: Vite 개발 서버 127.0.0.1:FLOW_FE_PORT(5173)(/api → FLOW_BE_PORT, `AUTOSTORE_API_PROXY_TARGET`)
 * - 워커 1(직렬): 테스트마다 BE를 다시 켜고 테스트 DB를 비운다(`flow` fixture). 공통 fixture가 127.0.0.1 밖 요청을 끊고 기록한다
 * 이미 떠 있는 서버를 다시 쓰지 않는다(개발 BE·개발 DB에 붙지 않게 — BE 포트가 차 있으면 시작하지 않는다).
 */
export default defineConfig({
  testDir: '.',
  testMatch: /flow-.*\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: '../test-results/flow',
  use: {
    baseURL: FE_URL,
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node test/flow/flow-server.mjs',
      cwd: '../../BE',
      url: `http://127.0.0.1:${CONTROL_PORT}/__flow/health`,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${FE_PORT} --strictPort`,
      cwd: '..',
      url: FE_URL,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ...(process.env as Record<string, string>),
        AUTOSTORE_API_PROXY_TARGET: `http://127.0.0.1:${BE_PORT}`,
      },
    },
  ],
});
