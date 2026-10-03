import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 개발 서버는 이 PC(127.0.0.1)에서만 연다. /api 요청은 BE(3100)로 넘긴다.
// changeOrigin: BE의 Host 검사(127.0.0.1:3100)를 통과하도록 Host 헤더를 대상 주소로 바꾼다.
// AUTOSTORE_API_PROXY_TARGET: 넘길 BE 주소를 바꿀 때만(흐름 테스트가 개발 BE와 다른 포트의 가짜 BE를 쓸 때). 기본 3100.
const apiTarget = process.env.AUTOSTORE_API_PROXY_TARGET ?? 'http://127.0.0.1:3100';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
  },
});
