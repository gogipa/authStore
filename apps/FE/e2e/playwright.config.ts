import { defineConfig } from '@playwright/test';

/**
 * 끝까지 흐름 테스트(P5-01). `pnpm test:flow`(저장소 루트)로 돈다. 브라우저는 Playwright Chromium(`playwright install chromium`).
 * - webServer 1: 가짜 연동 BE(apps/BE/test/flow/flow-server.mjs — 127.0.0.1:3100, 제어 3101, DB autostore_test)
 * - webServer 2: Vite 개발 서버 127.0.0.1:5173(/api → 3100)
 * - 워커 1(직렬): 테스트마다 BE를 다시 켜고 테스트 DB를 비운다(`flow` fixture). 공통 fixture가 127.0.0.1 밖 요청을 끊고 기록한다
 * 이미 떠 있는 서버를 다시 쓰지 않는다(개발 BE·개발 DB에 붙지 않게 — 3100이 차 있으면 시작하지 않는다).
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
    baseURL: 'http://127.0.0.1:5173',
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
      url: 'http://127.0.0.1:3101/__flow/health',
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort',
      cwd: '..',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
