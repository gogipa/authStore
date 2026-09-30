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

  it('P3-04 키: 색상 사전·주의 문구·상품명 금지 수식어·여러 원산지 방식, 고지 버전·AI 표시(켬)·가죽 판정 말', () => {
    const c = DEFAULT_SETTINGS.content;
    expect(c.colorTerms).toContainEqual({ raw: 'クリーム', ko: '크림' });
    expect(c.cautionTemplates.default.length).toBeGreaterThan(0);
    expect(c.cautionTemplates.byMaterial.length).toBeGreaterThan(0);
    expect(c.productNameBannedWords).toEqual(
      expect.arrayContaining(['무료배송', '특가', '최저가']),
    );
    expect(c.multiOriginMode).toBe('FIRST_COUNTRY_PLURAL');
    const n = DEFAULT_SETTINGS.notice;
    expect(n.templateVersion).toMatch(/^[A-Za-z0-9._-]{1,40}$/);
    expect(n.aiImageLabel).toBe(true);
    expect(n.leatherTerms).toEqual(expect.arrayContaining(['가죽', '革', 'レザー']));
    // 배송기간은 개인 값이라 기본 템플릿은 비운다(F-BS-03) — ⑥-3이 PROFILE_INCOMPLETE로 채우라고 안내한다
    expect(n.values.deliveryDaysMin).toBeNull();
  });

  it('P3-04 새 키가 빠진 설정 파일도 기본값으로 채운다', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as {
      content: Record<string, unknown>;
      notice: Record<string, unknown>;
    };
    for (const key of [
      'colorTerms',
      'cautionTemplates',
      'productNameBannedWords',
      'multiOriginMode',
    ]) {
      delete old.content[key];
    }
    for (const key of ['templateVersion', 'aiImageLabel', 'leatherTerms']) delete old.notice[key];
    const result = checkSettingsValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.content.multiOriginMode).toBe('FIRST_COUNTRY_PLURAL');
    expect(result.settings.notice.aiImageLabel).toBe(true);
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
      '여러 원산지 방식 오타',
      (s: AppSettings) => ((s.content as { multiOriginMode: string }).multiOriginMode = 'FIRST'),
    ],
    ['고지 버전에 공백', (s: AppSettings) => (s.notice.templateVersion = 'v 1')],
    [
      '주의 문구 말 목록이 빔',
      (s: AppSettings) => (s.content.cautionTemplates.byMaterial = [{ terms: [], text: 'x' }]),
    ],
    [
      '모르는 키',
      (s: AppSettings) => ((s.content as unknown as Record<string, unknown>).model = 'x'),
    ],
  ])('%s → 검사 실패', (_label, edit) => {
    expect(withSettings(edit).ok).toBe(false);
  });
});
