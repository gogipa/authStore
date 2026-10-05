// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 소스 전체에 걸린 규칙(P1-02 §4)을 글자로 검사한다.
 * - 규칙 15: 실행 중에 밖을 부르지 않는다(글꼴·아이콘·스크립트 CDN 없음), 라이트 테마만.
 * - 규칙 8: API는 shared/api/client.ts의 `api`로만. `fetch`·`EventSource`를 직접 부르지 않는다(SSE는 events.ts).
 * - 규칙 10: 202 작업 결과를 폴링하지 않는다(refetchInterval 없음).
 * - 규칙 11: 전역 클라이언트 스토어 라이브러리를 쓰지 않는다.
 * - 브라우저 저장소는 shared/lib/browserStorage.ts로만 연다(체험 `/demo`가 보통 앱의 키에 쓰지 않게, D-31).
 * 앱 코드 = 테스트 아닌 파일 + 앱이 싣는 파일(main.tsx에서 import로 닿는 것 — 테스트 폴더의 fixture라도 체험 청크가 쓰면 빌드에 들어간다).
 */
const FE_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SCAN_EXT = /\.(tsx?|css|html)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SCAN_EXT.test(entry.name) ? [path] : [];
  });
}

const rel = (file: string) => relative(FE_ROOT, file).split(sep).join('/');
const isTestFile = (file: string) =>
  /(\.test\.tsx?$)|(\/src\/test\/)/.test(file.split(sep).join('/'));

const ALL_FILES = [join(FE_ROOT, 'index.html'), ...sourceFiles(join(FE_ROOT, 'src'))].filter(
  (file) => file !== SELF,
);

// ── 앱이 싣는 파일: index.html의 `/src/main.tsx`에서 import(정적·동적·export from·CSS)로 닿는 파일 ──

const FROM_IMPORT = /^\s*(?:import|export)\s+(type\s+)?[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm;
const SIDE_EFFECT_IMPORT = /^\s*import\s*['"]([^'"]+)['"]/gm;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** 파일이 부르는 모듈 이름(타입만 가져오는 `import type`·`export type`은 빌드에 남지 않아 뺀다) */
function importSpecifiers(text: string): string[] {
  return [
    ...[...text.matchAll(FROM_IMPORT)].filter((m) => !m[1]).map((m) => m[2]!),
    ...[...text.matchAll(SIDE_EFFECT_IMPORT)].map((m) => m[1]!),
    ...[...text.matchAll(DYNAMIC_IMPORT)].map((m) => m[1]!),
  ];
}

/** `@/…`·상대 경로를 파일로(쿼리 `?no-inline` 뗌). 패키지 이름이면 null */
function resolveImport(from: string, specifier: string): string | null {
  const bare = specifier.split('?')[0]!;
  let base: string;
  if (bare.startsWith('@/')) base = join(FE_ROOT, 'src', bare.slice(2));
  else if (bare.startsWith('.')) base = join(dirname(from), bare);
  else return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((file) => existsSync(file) && statSync(file).isFile()) ?? null;
}

function shippedGraph(entry: string) {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const specifier of importSpecifiers(readFileSync(file, 'utf8'))) {
      const target = resolveImport(file, specifier);
      if (target) queue.push(target);
      else if (!specifier.startsWith('.') && !specifier.startsWith('@/')) packages.add(specifier);
    }
  }
  return { files, packages };
}

const SHIPPED = shippedGraph(join(FE_ROOT, 'src', 'main.tsx'));

/** 앱 코드(테스트·생성물 제외 — 단, 앱이 싣는 테스트 폴더 파일은 앱 코드다). */
const APP_FILES = ALL_FILES.filter(
  (file) =>
    (!isTestFile(file) || SHIPPED.files.has(file)) &&
    !file.endsWith('schema.d.ts') &&
    !file.endsWith('.html'),
);

function offenders(files: string[], patterns: RegExp[]): string[] {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const hits = patterns.filter((re) => re.test(text));
    return hits.length > 0 ? [`${rel(file)}: ${hits.map(String).join(', ')}`] : [];
  });
}

describe('앱이 싣는 파일도 앱 코드 규칙을 지킨다', () => {
  const shipped = [...SHIPPED.files].map(rel);

  it('main.tsx에서 체험 청크(동적 import)와 그것이 쓰는 예시·fixture까지 닿는다', () => {
    expect(shipped).toEqual(
      expect.arrayContaining([
        'src/main.tsx',
        'src/app/routes.tsx',
        'src/app/demo/startDemo.tsx',
        'src/app/demo/demoApi.ts',
        'src/app/demo/sample/settings.ts',
        'src/test/fixtures/aiEngine.ts',
      ]),
    );
  });

  it('테스트 폴더에서 싣는 것은 fixture뿐이고, 모두 아래 앱 코드 규칙 검사에 들어간다', () => {
    const fromTestDir = shipped.filter((file) => file.startsWith('src/test/'));
    expect(fromTestDir.length).toBeGreaterThan(0);
    expect(fromTestDir.filter((file) => !file.startsWith('src/test/fixtures/'))).toEqual([]);
    expect(shipped.filter((file) => /\.test\.tsx?$/.test(file))).toEqual([]);
    const appFiles = new Set(APP_FILES.map(rel));
    expect(fromTestDir.filter((file) => !appFiles.has(file))).toEqual([]);
  });

  it('테스트 도구 패키지를 싣지 않는다', () => {
    expect(
      [...SHIPPED.packages].filter((name) =>
        /^(vitest|@vitest\/|@testing-library\/|@playwright\/|jsdom|msw)/.test(name),
      ),
    ).toEqual([]);
  });
});

describe('런타임 외부 호출 없음(규칙 15)', () => {
  it('검사할 파일이 있다', () => {
    expect(ALL_FILES.length).toBeGreaterThan(50);
    expect(APP_FILES.length).toBeGreaterThan(40);
  });

  it('index.html과 src/**에 https:// 주소·글꼴·CDN이 없다', () => {
    expect(
      offenders(ALL_FILES, [
        /https:\/\//i,
        /fonts\.googleapis|fonts\.gstatic|unpkg\.com|jsdelivr|cdnjs|\bcdn\./i,
        /@import\s+url\(/i,
        /http:\/\/(?!127\.0\.0\.1[:/]|localhost[:/])/i,
      ]),
    ).toEqual([]);
  });

  it('index.html은 외부 script·stylesheet를 부르지 않는다', () => {
    const html = readFileSync(join(FE_ROOT, 'index.html'), 'utf8');
    expect(html).not.toMatch(/<link[^>]+rel="(stylesheet|preconnect)"/i);
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/gi)].map((m) => m[1]);
    expect(scripts).toEqual(['/src/main.tsx']);
  });

  it('라이트 테마만 만든다(다크 분기 없음, D-13)', () => {
    expect(offenders(APP_FILES, [/prefers-color-scheme/i, /data-theme/i])).toEqual([]);
  });
});

describe('API 호출 규칙(규칙 8·10·11)', () => {
  it('fetch는 부르지 않는다(openapi-fetch `api`만, client.ts 밖)', () => {
    const files = APP_FILES.filter((file) => !rel(file).endsWith('src/shared/api/client.ts'));
    expect(offenders(files, [/\bfetch\s*\(/, /globalThis\.fetch/, /window\.fetch/])).toEqual([]);
  });

  it('EventSource는 shared/api/events.ts 한 곳에서만 연다', () => {
    const files = APP_FILES.filter((file) => !rel(file).endsWith('src/shared/api/events.ts'));
    expect(offenders(files, [/new\s+EventSource\s*\(/, /new\s+EventSourceImpl\s*\(/])).toEqual([]);
  });

  it('서비스 워커를 쓰지 않는다(체험 `/demo`도 요청을 가로채지 않고 메모리 예시로 답한다, D-31)', () => {
    expect(offenders(APP_FILES, [/serviceWorker/])).toEqual([]);
  });

  it('폴링하지 않는다(refetchInterval·setInterval 없음)', () => {
    expect(offenders(APP_FILES, [/refetchInterval/, /setInterval\s*\(/])).toEqual([]);
  });

  it('브라우저 저장소는 shared/lib/browserStorage.ts로만 연다(체험은 메모리 — 보통 앱 키에 쓰지 않는다, D-31)', () => {
    const files = APP_FILES.filter(
      (file) => !rel(file).endsWith('src/shared/lib/browserStorage.ts'),
    );
    expect(offenders(files, [/\b(localStorage|sessionStorage)\s*[.[]/])).toEqual([]);
  });

  it('전역 클라이언트 스토어를 두지 않는다(서버 값은 TanStack Query에만)', () => {
    expect(
      offenders(APP_FILES, [/from ['"](zustand|redux|@reduxjs\/toolkit|jotai|recoil|mobx|valtio)/]),
    ).toEqual([]);
  });
});
