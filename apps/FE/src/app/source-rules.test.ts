// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 소스 전체에 걸린 규칙(P1-02 §4)을 글자로 검사한다.
 * - 규칙 15: 실행 중에 밖을 부르지 않는다(글꼴·아이콘·스크립트 CDN 없음), 라이트 테마만.
 * - 규칙 8: API는 shared/api/client.ts의 `api`로만. `fetch`·`EventSource`를 직접 부르지 않는다(SSE는 events.ts).
 * - 규칙 10: 202 작업 결과를 폴링하지 않는다(refetchInterval 없음).
 * - 규칙 11: 전역 클라이언트 스토어 라이브러리를 쓰지 않는다.
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
/** 앱 코드(테스트·생성물 제외). */
const APP_FILES = ALL_FILES.filter(
  (file) => !isTestFile(file) && !file.endsWith('schema.d.ts') && !file.endsWith('.html'),
);

function offenders(files: string[], patterns: RegExp[]): string[] {
  return files.flatMap((file) => {
    const text = readFileSync(file, 'utf8');
    const hits = patterns.filter((re) => re.test(text));
    return hits.length > 0 ? [`${rel(file)}: ${hits.map(String).join(', ')}`] : [];
  });
}

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

  it('폴링하지 않는다(refetchInterval·setInterval 없음)', () => {
    expect(offenders(APP_FILES, [/refetchInterval/, /setInterval\s*\(/])).toEqual([]);
  });

  it('전역 클라이언트 스토어를 두지 않는다(서버 값은 TanStack Query에만)', () => {
    expect(
      offenders(APP_FILES, [/from ['"](zustand|redux|@reduxjs\/toolkit|jotai|recoil|mobx|valtio)/]),
    ).toEqual([]);
  });
});
