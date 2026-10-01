import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import {
  BUILTIN_EXTRA_CHARGE_WORDS,
  BUILTIN_MIN_BLOCK_WORDS,
  BUILTIN_ORIGIN_CONFUSION_WORDS,
} from '../safety/builtin-safety-lists.js';
import { validateSafetyFloor } from '../safety/safety-floor.validator.js';
import { checkSettingsValue } from '../settings-file.loader.js';
import type { AppSettings } from './settings.types.js';

function withSettings(edit: (s: AppSettings) => void): AppSettings {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  edit(settings);
  return settings;
}

describe('설정 — 최종 승인 문구 사전·registration 섹션(P4-02 Proposed 키)', () => {
  it('기본 템플릿: 최소 차단어 5말·혼동 표현·추가 청구 표현, 처음 10건 전시중지, 옵션 재고 상한 2', () => {
    expect(checkSettingsValue(DEFAULT_SETTINGS).ok).toBe(true);
    expect(validateSafetyFloor(DEFAULT_SETTINGS as AppSettings)).toEqual([]);
    expect(DEFAULT_SETTINGS.safety.minBlockWords).toEqual(
      expect.arrayContaining([...BUILTIN_MIN_BLOCK_WORDS]),
    );
    expect(BUILTIN_MIN_BLOCK_WORDS).toEqual([
      '반품 불가',
      '환불 불가',
      '최저가',
      '공식',
      '정품 100%',
    ]);
    expect(DEFAULT_SETTINGS.safety.originConfusionWords).toEqual(
      expect.arrayContaining([...BUILTIN_ORIGIN_CONFUSION_WORDS]),
    );
    expect(DEFAULT_SETTINGS.safety.extraChargeWords).toEqual(
      expect.arrayContaining([...BUILTIN_EXTRA_CHARGE_WORDS]),
    );
    expect(DEFAULT_SETTINGS.registration).toEqual({
      initialSuspensionCount: 10,
      optionStockCap: 2,
    });
  });

  it('내장 말은 뺄 수 없다(더하기만) — 빼면 안전 기준 완화로 거부', () => {
    const items = (s: AppSettings) => validateSafetyFloor(s).map((v) => v.item);
    expect(
      items(
        withSettings(
          (s) => (s.safety.minBlockWords = ['반품 불가', '환불 불가', '최저가', '정품 100%']),
        ),
      ),
    ).toEqual(['MIN_BLOCK_WORD_REMOVED']);
    expect(items(withSettings((s) => (s.safety.originConfusionWords = ['일본산'])))).toEqual([
      'ORIGIN_CONFUSION_WORD_REMOVED',
    ]);
    expect(items(withSettings((s) => (s.safety.extraChargeWords = [])))).toEqual([
      'EXTRA_CHARGE_WORD_REMOVED',
      'EXTRA_CHARGE_WORD_REMOVED',
    ]);
    expect(validateSafetyFloor(withSettings((s) => s.safety.minBlockWords.push('사은품')))).toEqual(
      [],
    );
  });

  it('registration 범위 밖 값(상한 0·처음 N건 1001)은 형식 오류', () => {
    expect(checkSettingsValue(withSettings((s) => (s.registration.optionStockCap = 0))).ok).toBe(
      false,
    );
    expect(
      checkSettingsValue(withSettings((s) => (s.registration.initialSuspensionCount = 1001))).ok,
    ).toBe(false);
  });

  it('빠진 섹션·키는 기본값으로 채운다(이미 있는 설정 파일이 깨지지 않는다)', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete old.registration;
    const safety = old.safety as Record<string, unknown>;
    delete safety.minBlockWords;
    delete safety.originConfusionWords;
    delete safety.extraChargeWords;
    const result = checkSettingsValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.registration.optionStockCap).toBe(2);
    expect(result.settings.safety.minBlockWords).toContain('공식');
  });
});
