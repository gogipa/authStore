import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import {
  buildPrompt,
  FACE_OPTION_PHRASES,
  normalizeAdjustment,
  THUMBNAIL_FACE_OPTIONS,
} from './prompt-builder.js';
import { findBlockedTerms, personBlockDictionary } from './real-person-guard.js';

const TEMPLATE = DEFAULT_SETTINGS.thumbnail.promptTemplate;
/** 기본 해상도(D-21 — 1024) */
const RESOLUTION = DEFAULT_SETTINGS.thumbnail.resolutionPx;

describe('buildPrompt(P3-01 규칙 11·12, F-TH-06·11)', () => {
  it('세 얼굴 옵션이 각각 PRD §8.4 골격 주석의 영어 문장으로 들어간다', () => {
    expect(FACE_OPTION_PHRASES).toEqual({
      FULL_FACE: 'full face',
      CHIN_CROP: 'crop at chin (face not shown)',
      HANDS_UPPER_BODY: 'hands and upper body only',
    });
    for (const option of THUMBNAIL_FACE_OPTIONS) {
      const prompt = buildPrompt(TEMPLATE, RESOLUTION, option);
      expect(prompt).toContain(`Model framing: ${FACE_OPTION_PHRASES[option]}.`);
      expect(prompt).not.toContain('{face_option}');
      for (const other of THUMBNAIL_FACE_OPTIONS) {
        if (other !== option) expect(prompt).not.toContain(FACE_OPTION_PHRASES[other]);
      }
    }
  });

  it('{resolution} = 1024(기본 1K — D-21), 자리표시자가 남지 않는다', () => {
    expect(DEFAULT_SETTINGS.thumbnail.resolutionPx).toBe(1024);
    const prompt = buildPrompt(TEMPLATE, RESOLUTION, 'FULL_FACE');
    expect(prompt).toContain('square 1:1, 1024 pixels.');
    expect(prompt).not.toMatch(/\{resolution\}|\{face_option\}/);
    // 같은 자리가 여러 번 있어도 모두 바꾼다
    expect(buildPrompt('{resolution}x{resolution} {face_option}', 2048, 'CHIN_CROP')).toBe(
      '2048x2048 crop at chin (face not shown)',
    );
  });

  it('골격에는 가상 인물·신발 70%·로고·색상·밑창 보존·문구·가격·워터마크 없음이 들어 있다', () => {
    const prompt = buildPrompt(TEMPLATE, RESOLUTION, 'FULL_FACE');
    expect(prompt).toContain(
      'A fictional young Korean male model with K-pop idol styling — NOT resembling any real person or celebrity —',
    );
    expect(prompt).toContain('it fills at least 70% of the frame');
    expect(prompt).toContain('same logo, stitching, colors, materials, sole pattern');
    expect(prompt).toContain('No text, no watermark, no price, no graphics.');
  });

  it('조정 문구는 앞뒤 공백을 빼고 한 줄 띄워 뒤에 붙는다. 비었거나 공백뿐이면 붙이지 않는다', () => {
    const base = buildPrompt(TEMPLATE, RESOLUTION, 'FULL_FACE');
    expect(buildPrompt(TEMPLATE, RESOLUTION, 'FULL_FACE', '  Warm sunset light.  ')).toBe(
      `${base}\n\nWarm sunset light.`,
    );
    expect(buildPrompt(TEMPLATE, RESOLUTION, 'FULL_FACE', '   ')).toBe(base);
    expect(buildPrompt(TEMPLATE, RESOLUTION, 'FULL_FACE', null)).toBe(base);
    expect(normalizeAdjustment(' a ')).toBe('a');
    expect(normalizeAdjustment('')).toBeNull();
    expect(normalizeAdjustment(undefined)).toBeNull();
  });

  it('기본 골격만으로 만든 프롬프트는 차단어(내장 ∪ 기본 설정)에 걸리지 않는다', () => {
    const dictionary = personBlockDictionary(DEFAULT_SETTINGS.safety.personBlockWords);
    for (const option of THUMBNAIL_FACE_OPTIONS) {
      expect(findBlockedTerms(buildPrompt(TEMPLATE, RESOLUTION, option), dictionary)).toEqual([]);
    }
  });

  it('모르는 얼굴 옵션·잘못된 해상도는 던진다(앱 코드 잘못)', () => {
    expect(() => buildPrompt(TEMPLATE, RESOLUTION, 'SIDE' as never)).toThrow('얼굴 노출 옵션');
    expect(() => buildPrompt(TEMPLATE, 0, 'FULL_FACE')).toThrow('해상도');
  });
});
