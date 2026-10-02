import { DEFAULT_SETTINGS } from '../defaults/default-settings.js';
import { checkSettingsValue } from '../settings-file.loader.js';
import type { AppSettings } from './settings.types.js';

function withSettings(edit: (s: AppSettings) => void) {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  edit(settings);
  return checkSettingsValue(settings);
}

describe('설정 thumbnail 섹션(P3-01 — ⑤ 프롬프트 골격·얼굴 노출 기본값·후보 수·해상도)', () => {
  it('기본 템플릿: PRD §8.4 영어 골격, 얼굴 노출 FULL_FACE, 후보 2장, 2048px', () => {
    expect(checkSettingsValue(DEFAULT_SETTINGS).ok).toBe(true);
    const t = DEFAULT_SETTINGS.thumbnail;
    expect(t.faceOptionDefault).toBe('FULL_FACE');
    expect(t.candidateCount).toBe(2);
    expect(t.resolutionPx).toBe(2048);
    // P3-02: 이미지 생성 공급자(D-19 AGY)·생성 타임아웃 15분
    expect(t.imageProvider).toBe('AGY');
    expect(t.generationTimeoutSeconds).toBe(900);
    expect(t.promptTemplate).toContain('{resolution}');
    expect(t.promptTemplate).toContain('{face_option}');
    expect(t.promptTemplate).toContain('NOT resembling any real person or celebrity');
  });

  it('빠진 thumbnail 섹션은 기본값으로 채운다(이미 있는 설정 파일이 깨지지 않는다)', () => {
    const old = structuredClone(DEFAULT_SETTINGS) as unknown as Record<string, unknown>;
    delete old.thumbnail;
    const result = checkSettingsValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.settings.thumbnail).toEqual(DEFAULT_SETTINGS.thumbnail);
  });

  it.each([
    [
      '{resolution} 없음',
      (s: AppSettings) => (s.thumbnail.promptTemplate = 'Photo. {face_option}'),
    ],
    ['{face_option} 없음', (s: AppSettings) => (s.thumbnail.promptTemplate = '{resolution} px')],
    ['빈 골격', (s: AppSettings) => (s.thumbnail.promptTemplate = '')],
    [
      '모르는 얼굴 옵션',
      (s: AppSettings) =>
        ((s.thumbnail as { faceOptionDefault: string }).faceOptionDefault = 'SIDE'),
    ],
    ['후보 0장', (s: AppSettings) => (s.thumbnail.candidateCount = 0)],
    ['후보 5장', (s: AppSettings) => (s.thumbnail.candidateCount = 5)],
    ['해상도 256', (s: AppSettings) => (s.thumbnail.resolutionPx = 256)],
    [
      '모르는 공급자',
      (s: AppSettings) => ((s.thumbnail as { imageProvider: string }).imageProvider = 'MIDJOURNEY'),
    ],
    ['타임아웃 0초', (s: AppSettings) => (s.thumbnail.generationTimeoutSeconds = 0)],
    ['타임아웃 15분 초과', (s: AppSettings) => (s.thumbnail.generationTimeoutSeconds = 901)],
    [
      '모르는 키',
      (s: AppSettings) => ((s.thumbnail as unknown as Record<string, unknown>).model = 'x'),
    ],
  ])('%s → 스키마 오류', (_name, edit) => {
    expect(withSettings(edit)).toMatchObject({ ok: false, kind: 'SCHEMA' });
  });

  it('여러 줄 골격·다른 해상도·얼굴 옵션 기본값은 받는다', () => {
    expect(
      withSettings((s) => {
        s.thumbnail.promptTemplate = 'Line one {resolution}\nLine two {face_option}\n';
        s.thumbnail.resolutionPx = 1024;
        s.thumbnail.faceOptionDefault = 'HANDS_UPPER_BODY';
        s.thumbnail.candidateCount = 4;
      }).ok,
    ).toBe(true);
  });

  it('실존 인물 차단어: 더하기는 되고 내장 단어를 빼면 안전 기준 완화로 거부(P1-03, 규칙 14)', () => {
    expect(withSettings((s) => s.safety.personBlockWords.push('가상아이돌테스트')).ok).toBe(true);
    expect(
      withSettings((s) => {
        s.safety.personBlockWords = s.safety.personBlockWords.filter((w) => w !== 'BTS');
      }),
    ).toMatchObject({
      ok: false,
      kind: 'SAFETY',
      violations: [{ item: 'PERSON_BLOCK_WORD_REMOVED', field: '/safety/personBlockWords' }],
    });
  });
});
