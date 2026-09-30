import {
  THUMBNAIL_FACE_OPTIONS,
  type ThumbnailFaceOption,
} from '../../settings/schema/settings.types.js';

export { THUMBNAIL_FACE_OPTIONS, type ThumbnailFaceOption };

/**
 * 얼굴 노출 수준 → 프롬프트에 넣을 영어 문장(F-TH-11, US-13 AC2, PRD §8.4 골격 주석
 * `full face | crop at chin (face not shown) | hands and upper body only` 그대로).
 */
export const FACE_OPTION_PHRASES: Readonly<Record<ThumbnailFaceOption, string>> = {
  FULL_FACE: 'full face',
  CHIN_CROP: 'crop at chin (face not shown)',
  HANDS_UPPER_BODY: 'hands and upper body only',
};

/** 오너 프롬프트 조정 문구 최대 길이(05-2 ThumbnailPromptPreviewRequest.promptAdjustment maxLength) */
export const PROMPT_ADJUSTMENT_MAX = 2000;

/** 골격의 자리표시자(설정 스키마 pattern이 둘 다 있는지 본다) */
export const PROMPT_PLACEHOLDERS = {
  resolution: '{resolution}',
  faceOption: '{face_option}',
} as const;

export function isThumbnailFaceOption(value: unknown): value is ThumbnailFaceOption {
  return typeof value === 'string' && (THUMBNAIL_FACE_OPTIONS as readonly string[]).includes(value);
}

/** 조정 문구 정리: null·공백뿐이면 null, 아니면 앞뒤 공백을 뺀 글 */
export function normalizeAdjustment(adjustment: string | null | undefined): string | null {
  const text = adjustment?.trim() ?? '';
  return text === '' ? null : text;
}

/**
 * ⑤ 프롬프트(F-TH-06·F-TH-11, P3-01 규칙 11·12) — 순수 함수. 미리보기(P3-01)와 생성 요청(P3-02)이 같은 함수를 쓴다.
 * 설정의 영어 골격에서 `{resolution}`을 해상도 px(기본 2048)로, `{face_option}`을 얼굴 노출 문장으로 모두 바꾸고, 오너 조정
 * 문구(앞뒤 공백 제거, 비었으면 붙이지 않는다)를 한 줄 띄워 뒤에 붙인다. 골격 끝의 공백·줄바꿈은 뺀다.
 */
export function buildPrompt(
  template: string,
  resolutionPx: number,
  faceOption: ThumbnailFaceOption,
  adjustment?: string | null,
): string {
  if (!isThumbnailFaceOption(faceOption)) {
    throw new Error(`알 수 없는 얼굴 노출 옵션입니다: ${String(faceOption)}`);
  }
  if (!Number.isInteger(resolutionPx) || resolutionPx <= 0) {
    throw new Error(`해상도는 1 이상의 정수여야 합니다: ${resolutionPx}`);
  }
  const body = template
    .split(PROMPT_PLACEHOLDERS.resolution)
    .join(String(resolutionPx))
    .split(PROMPT_PLACEHOLDERS.faceOption)
    .join(FACE_OPTION_PHRASES[faceOption])
    .trimEnd();
  const extra = normalizeAdjustment(adjustment);
  return extra ? `${body}\n\n${extra}` : body;
}
