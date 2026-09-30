import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import { checkSettingsValue } from '../settings-file.loader.js';
import type { AppSettings } from './settings.types.js';

function withSettings(edit: (s: AppSettings) => void) {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  edit(settings);
  return checkSettingsValue(settings);
}

describe('설정 content 섹션(P3-03 — ⑥-2 나라 사전·소재 말·항목 이름·스펙 이미지)', () => {
  it('기본 템플릿: 나라 사전(ベトナム → 아시아 > 베트남)·항목 이름(原産国·MADE IN)·스펙 이미지 4장·5MB', () => {
    expect(checkSettingsValue(DEFAULT_SETTINGS).ok).toBe(true);
    const c = DEFAULT_SETTINGS.content;
    expect(c.originCountries).toContainEqual({ raw: 'ベトナム', area: '아시아 > 베트남' });
    expect(c.materialTerms).toContainEqual({ raw: '合成皮革', ko: '합성가죽' });
    expect(c.factLabels.origin).toEqual(expect.arrayContaining(['原産国', '製造国', 'MADE IN']));
    expect(c.factLabels.heelHeight).toContain('ヒール高さ');
    expect(c.specImages).toEqual({ maxCount: 4, maxBytes: 5_242_880 });
  });

  it('빠진 content 섹션은 기본값으로 채운다(이미 있는 설정 파일이 깨지지 않는다)', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete old.content;
    const result = checkSettingsValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.content).toEqual(DEFAULT_SETTINGS.content);
  });

  it.each([
    [
      "'대륙 > 국가' 모양이 아님",
      (s: AppSettings) => (s.content.originCountries = [{ raw: 'X', area: '베트남' }]),
    ],
    ['빈 원문', (s: AppSettings) => (s.content.materialTerms = [{ raw: '', ko: '고무' }])],
    ['항목 이름 목록이 빔', (s: AppSettings) => (s.content.factLabels.origin = [])],
    ['스펙 이미지 11장', (s: AppSettings) => (s.content.specImages.maxCount = 11)],
    ['스펙 이미지 20MB 초과', (s: AppSettings) => (s.content.specImages.maxBytes = 30_000_000)],
    [
      '모르는 키',
      (s: AppSettings) => ((s.content as unknown as Record<string, unknown>).model = 'x'),
    ],
  ])('%s → 검사 실패', (_label, edit) => {
    expect(withSettings(edit).ok).toBe(false);
  });
});
