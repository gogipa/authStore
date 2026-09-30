import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
      // findBy·waitFor를 5초까지 기다리므로(src/test/setup.ts) 테스트 하나의 한도도 넉넉히 둔다
      testTimeout: 20000,
    },
  }),
);
