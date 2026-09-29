import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * 레이어 경계(03-2 §4·§5, 적용: P1-02). ESLint 기본 규칙 `no-restricted-imports`만 쓴다(새 플러그인 없음).
 * 한계: 상대 경로(`../../features/x/api`)로 레이어를 넘는 import는 못 잡는다. 폴더 밖은 `@/` 별칭으로 부른다.
 * 검증: src/app/eslint-boundaries.test.ts
 */
const layer = (files, patterns) => ({
  files,
  rules: { 'no-restricted-imports': ['error', { patterns }] },
});

export const boundaries = [
  // shared는 도메인·화면을 모른다 — 위 레이어를 부르면 재사용이 깨진다
  layer(
    ['src/shared/**/*.{ts,tsx}'],
    [
      {
        group: ['@/app', '@/app/*', '@/pages', '@/pages/*', '@/features', '@/features/*'],
        message: 'shared는 app·pages·features를 import하지 않습니다.',
      },
    ],
  ),
  // features는 화면·라우터를 모른다 — 도메인 로직이 한 화면에 묶이지 않게
  layer(
    ['src/features/**/*.{ts,tsx}'],
    [
      {
        group: ['@/app', '@/app/*', '@/pages', '@/pages/*'],
        message: 'features는 app·pages를 import하지 않습니다.',
      },
      // 다른 feature 내부 파일 직접 import 금지 — 공개 API(index.ts)로만
      {
        group: ['@/features/*/*'],
        message: '다른 feature는 @/features/<이름>(index.ts)으로만 import합니다.',
      },
    ],
  ),
  // pages는 라우터가 부른다 — 화면끼리 엮이면 lazy 분할이 깨진다
  layer(
    ['src/pages/**/*.{ts,tsx}'],
    [
      { group: ['@/app', '@/app/*'], message: 'pages는 app을 import하지 않습니다.' },
      {
        group: ['@/pages/*'],
        message: '다른 화면을 import하지 않습니다. 공통은 features·shared로 올립니다.',
      },
      {
        group: ['@/features/*/*'],
        message: 'feature 내부 파일 직접 import 금지(index.ts로만).',
      },
    ],
  ),
];

export default defineConfig([
  // 생성물(schema.d.ts, tokens.css)과 빌드 산출물은 검사하지 않는다.
  globalIgnores(['dist', 'coverage', 'src/shared/api/schema.d.ts']),
  {
    files: ['**/*.{js,mjs,ts,tsx}'],
    extends: [js.configs.recommended],
    rules: {
      'no-console': ['warn', { allow: ['info', 'warn', 'error'] }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  ...boundaries,
  // 포맷 규칙은 Prettier에 맡긴다(겹치는 ESLint 규칙 끄기). 항상 마지막에 둔다.
  prettier,
]);
