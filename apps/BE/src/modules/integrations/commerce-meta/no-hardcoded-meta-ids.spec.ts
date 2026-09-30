import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * 규칙 2(F-BS-48, RG-03): 카테고리·원산지 ID를 코드·설정에 박지 않는다. 쓰는 곳은 캐시(CommerceMetaCacheService)에서 읽는다.
 * 앱 소스(테스트·생성물 제외)와 기본 설정 템플릿에 네이버 리프 카테고리 ID 모양(8자리 5000xxxx)이나
 * 수입산 원산지 코드 모양(02 + 5자리)이 글자로 들어 있지 않은지 본다.
 */
const SRC_DIR = join(import.meta.dirname, '..', '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'generated' ? [] : sourceFiles(path);
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.testing.ts')) return [];
    return /\.(ts|json)$/.test(entry.name) ? [path] : [];
  });
}

const CATEGORY_ID_LIKE = /(?<![0-9])50[0-9]{6}(?![0-9])/;
const ORIGIN_CODE_LIKE = /['"`]02[0-9]{5}['"`]/;

/**
 * 예외(이유를 적는다): 데이터랩 인기검색어 수집 cid(P2-01, PRD §8.1 — 여성신발 50000173·남성신발 50000174).
 * 등록에 쓰는 커머스API 리프 카테고리가 아니라 데이터랩 수집 대상 분야(2단계)이고, PRD가 값을 정했다.
 * 원본은 설정 `keywords.datalab.defaultCids`이고 keywords 상수·설명에 같은 값이 나온다.
 */
const DATALAB_COLLECTION_CIDS = /(?<![0-9])5000017[34](?![0-9])/g;

describe('카테고리·원산지 ID를 코드·설정에 박지 않는다(규칙 2)', () => {
  const files = sourceFiles(SRC_DIR);

  it('앱 소스·기본 설정 템플릿을 모두 본다', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('settings.default.json'))).toBe(true);
  });

  it.each(files.map((f) => [relative(SRC_DIR, f), f]))('%s', (_name, file) => {
    const text = readFileSync(file, 'utf8').replace(DATALAB_COLLECTION_CIDS, '');
    expect(text).not.toMatch(CATEGORY_ID_LIKE);
    expect(text).not.toMatch(ORIGIN_CODE_LIKE);
  });
});
