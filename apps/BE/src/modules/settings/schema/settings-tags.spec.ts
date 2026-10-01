import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import { checkSettingsValue } from '../settings-file.loader.js';
import type { AppSettings } from './settings.types.js';

function withSettings(edit: (s: AppSettings) => void) {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  edit(settings);
  return checkSettingsValue(settings);
}

describe('설정 tags 섹션(P3-05 — ⑦ 용도어·추천 캐시·restricted 개수·입력 상한·규칙 사전)', () => {
  it('기본 템플릿: 용도어 데일리, 캐시 10분, restricted 10개씩, 입력 1MB, AI 판정 꺼짐, 규칙 사전', () => {
    expect(checkSettingsValue(DEFAULT_SETTINGS).ok).toBe(true);
    const tags = DEFAULT_SETTINGS.tags;
    expect(tags).toMatchObject({
      useWords: ['데일리'],
      recommendCacheMinutes: 10,
      restrictedBatchSize: 10,
      competitorInputMaxBytes: 1_048_576,
      aiRelevanceEnabled: false,
    });
    expect(tags.rules.keepOwnBrandRecommended).toBe(true);
    expect(tags.rules.brands.map((b) => b.name)).toEqual(
      expect.arrayContaining(['아식스', '나이키', '아디다스', '뉴발란스']),
    );
    expect(tags.rules.promotionWords).toEqual(expect.arrayContaining(['무료배송', '특가']));
    // '정품'은 홍보 문구에 넣지 않는다(제한 여부는 restricted-tags가 본다)
    expect(tags.rules.promotionWords).not.toContain('정품');
    expect(tags.rules.childWords).toEqual(expect.arrayContaining(['키즈', '아동']));
    expect(tags.rules.genderWords.FEMALE).toEqual(expect.arrayContaining(['여성', '여자']));
  });

  it('M1은 AI 관련성 판정을 켤 수 없다(aiRelevanceEnabled=true는 형식 오류)', () => {
    const result = withSettings((s) => (s.tags.aiRelevanceEnabled = true));
    expect(result.ok).toBe(false);
  });

  it('범위 밖 값(restricted 0개·입력 상한 6MB·용도어 101자)은 형식 오류', () => {
    expect(withSettings((s) => (s.tags.restrictedBatchSize = 0)).ok).toBe(false);
    expect(withSettings((s) => (s.tags.competitorInputMaxBytes = 6_000_000)).ok).toBe(false);
    expect(withSettings((s) => (s.tags.useWords = ['가'.repeat(101)])).ok).toBe(false);
  });

  it('빠진 tags 섹션은 기본값으로 채운다(이미 있는 설정 파일이 깨지지 않는다)', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete old.tags;
    const result = checkSettingsValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.tags.restrictedBatchSize).toBe(10);
    expect(result.settings.tags.rules.brands.length).toBeGreaterThan(0);
  });
});
