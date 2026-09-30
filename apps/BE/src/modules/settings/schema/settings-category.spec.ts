import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import { checkSettingsValue } from '../settings-file.loader.js';
import type { AppSettings } from './settings.types.js';

function withSettings(edit: (s: AppSettings) => void) {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  edit(settings);
  return checkSettingsValue(settings);
}

describe('설정 category.leafMapping·safety 카테고리 말(P2-06)', () => {
  it('기본 템플릿: 매핑표는 비어 있고 카테고리 말은 내장 목록이다', () => {
    expect(checkSettingsValue(DEFAULT_SETTINGS).ok).toBe(true);
    expect(DEFAULT_SETTINGS.category).toEqual({ leafMapping: [] });
    expect(DEFAULT_SETTINGS.safety.childCategoryWords).toEqual([
      '아동',
      '키즈',
      '주니어',
      '유아',
      '베이비',
    ]);
    expect(DEFAULT_SETTINGS.safety.excludedCategoryWords).toEqual([
      '바퀴',
      '롤러',
      '힐리스',
      '실버',
      '효도',
    ]);
  });

  it('빠진 category 섹션·카테고리 말은 기본값으로 채운다(이미 있는 설정 파일이 깨지지 않는다)', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown> & {
      safety: Record<string, unknown>;
    };
    delete old.category;
    delete old.safety.childCategoryWords;
    delete old.safety.excludedCategoryWords;
    const result = checkSettingsValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.category.leafMapping).toEqual([]);
    expect(result.settings.safety.childCategoryWords).toContain('키즈');
    expect(result.settings.safety.excludedCategoryWords).toContain('효도');
  });

  it('매핑표 한 줄: 장르 id·상품유형(선택·null)·리프 id 목록을 받는다', () => {
    expect(
      withSettings((s) => {
        s.category.leafMapping = [
          { genreId: 208025, productType: '러닝화', leafCategoryIds: ['50000830', '50000831'] },
          { genreId: 110983, leafCategoryIds: ['50000900'] },
          { genreId: 110983, productType: null, leafCategoryIds: ['50000901'] },
        ];
      }).ok,
    ).toBe(true);
  });

  it.each([
    ['장르 id 0', { genreId: 0, leafCategoryIds: ['1'] }],
    ['리프 id가 숫자가 아님', { genreId: 1, leafCategoryIds: ['ABC'] }],
    ['리프 id 21자', { genreId: 1, leafCategoryIds: ['1'.repeat(21)] }],
    ['빈 리프 목록', { genreId: 1, leafCategoryIds: [] }],
    ['모르는 키', { genreId: 1, leafCategoryIds: ['1'], gender: 'MALE' }],
  ])('%s → 스키마 오류', (_name, entry) => {
    const result = withSettings((s) => {
      (s.category as { leafMapping: unknown[] }).leafMapping = [entry];
    });
    expect(result).toMatchObject({ ok: false, kind: 'SCHEMA' });
  });

  it('내장 아동·제외 품목 카테고리 말을 빼면 안전 기준 완화로 거부(더하기는 된다)', () => {
    expect(withSettings((s) => s.safety.childCategoryWords.push('어린이')).ok).toBe(true);
    const removed = withSettings((s) => {
      s.safety.childCategoryWords = s.safety.childCategoryWords.filter((w) => w !== '키즈');
      s.safety.excludedCategoryWords = s.safety.excludedCategoryWords.filter((w) => w !== '롤러');
    });
    expect(removed).toMatchObject({
      ok: false,
      kind: 'SAFETY',
      violations: [
        { item: 'CHILD_CATEGORY_WORD_REMOVED', field: '/safety/childCategoryWords' },
        { item: 'EXCLUDED_CATEGORY_WORD_REMOVED', field: '/safety/excludedCategoryWords' },
      ],
    });
  });
});
