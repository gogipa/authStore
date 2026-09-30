import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import { checkSettingsValue } from '../settings-file.loader.js';
import type { AppSettings } from './settings.types.js';

function withSettings(edit: (s: AppSettings) => void) {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  edit(settings);
  return checkSettingsValue(settings);
}

describe('설정 keywords.datalab·safety 신발 단어(P2-01)', () => {
  it('기본 템플릿은 통과하고 datalab 기본값은 PRD §8.1 값이다', () => {
    const result = checkSettingsValue(DEFAULT_SETTINGS);
    expect(result.ok).toBe(true);
    expect(DEFAULT_SETTINGS.keywords.datalab).toEqual({
      rankUrl: 'https://datalab.naver.com/shoppingInsight/getCategoryKeywordRank.naver',
      pageSize: 20,
      maxPage: 25,
      requestIntervalSeconds: 2,
      defaultCids: ['50000173', '50000174'],
    });
  });

  it('빠진 datalab 섹션·신발 단어는 기본값으로 채운다(이미 있는 설정 파일이 깨지지 않는다)', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as {
      keywords: Record<string, unknown>;
      safety: Record<string, unknown>;
    };
    delete old.keywords.datalab;
    delete old.safety.wheeledShoeWords;
    delete old.safety.seniorShoeWords;
    const result = checkSettingsValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.keywords.datalab.requestIntervalSeconds).toBe(2);
    expect(result.settings.safety.wheeledShoeWords).toContain('힐리스');
  });

  it.each([
    [
      '요청 간격 2초 미만(F-BS-33)',
      (s: AppSettings) => (s.keywords.datalab.requestIntervalSeconds = 1.5),
    ],
    ['다른 호스트', (s: AppSettings) => (s.keywords.datalab.rankUrl = 'https://example.com/rank')],
    ['http', (s: AppSettings) => (s.keywords.datalab.rankUrl = 'http://datalab.naver.com/x')],
    [
      '콤마로 묶은 cid',
      (s: AppSettings) => (s.keywords.datalab.defaultCids = ['50000173,50000174']),
    ],
    ['빈 cid 목록', (s: AppSettings) => (s.keywords.datalab.defaultCids = [])],
  ])('%s → 스키마 오류', (_name, edit) => {
    const result = withSettings(edit);
    expect(result).toMatchObject({ ok: false, kind: 'SCHEMA' });
  });

  it('내장 바퀴·고령자 단어를 빼면 안전 기준 완화로 거부(더하기는 된다)', () => {
    expect(withSettings((s) => s.safety.wheeledShoeWords.push('인라인')).ok).toBe(true);
    const removed = withSettings((s) => {
      s.safety.seniorShoeWords = s.safety.seniorShoeWords.filter((w) => w !== '효도화');
    });
    expect(removed).toMatchObject({
      ok: false,
      kind: 'SAFETY',
      violations: [{ item: 'SENIOR_SHOE_WORD_REMOVED', field: '/safety/seniorShoeWords' }],
    });
  });
});
