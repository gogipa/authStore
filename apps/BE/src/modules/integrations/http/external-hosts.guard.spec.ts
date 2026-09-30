import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import { allAllowedHosts } from './external-targets.js';

/**
 * F-BS-07: 앱 코드(src, 테스트·생성물 제외)에 적힌 http(s) 주소의 호스트가 모두 허용 표 안에 있다.
 * 아래 예외 목록 밖의 호스트가 나오면 실패한다. 예외를 더할 때는 이유를 적는다.
 */
const EXCEPTIONS: Record<string, string> = {
  '127.0.0.1': '앱 자신(로컬 보안 Origin 비교·FE 개발 서버 Origin 기본값)',
  localhost: '앱 자신(로컬 보안 Origin 비교·FE 개발 서버 Origin 기본값)',
  'search.shopping.naver.com':
    '네이버쇼핑 검색 링크(P2-05 F-PJ-12) — 앱은 URL만 만들어 화면에 주고 부르지 않는다(오너가 새 탭으로 연다)',
};

const SRC = join(BE_ROOT, 'src');
const URL_RE = /https?:\/\/([^/\s'"`)\]>:?#]+)/gi;

function listSourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'generated' || name === 'node_modules') continue;
      listSourceFiles(p, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('외부 호스트 검사(F-BS-07)', () => {
  const allowed = allAllowedHosts();
  const files = listSourceFiles(SRC);

  it('검사할 소스 파일이 있다', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it('src 안의 http(s) 주소 호스트는 허용 표 또는 예외 목록 안에만 있다', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(URL_RE)) {
        const host = m[1]!.toLowerCase().replace(/\$\{.*$/, '');
        if (host === '' || allowed.has(host) || host in EXCEPTIONS) continue;
        offenders.push(`${relative(BE_ROOT, file)}: ${host}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('검사기가 실제로 걸러 낸다(허용 표 밖 호스트는 잡힌다)', () => {
    const sample = "const u = 'https://app.rakuten.co.jp/services/api'; // https://example.com/x";
    const hosts = [...sample.matchAll(URL_RE)].map((m) => m[1]!.toLowerCase());
    expect(hosts).toEqual(['app.rakuten.co.jp', 'example.com']);
    expect(hosts.filter((h) => !allowed.has(h) && !(h in EXCEPTIONS))).toHaveLength(2);
  });
});
