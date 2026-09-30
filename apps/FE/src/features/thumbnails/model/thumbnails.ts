import type { components } from '@/shared/api/schema';
import { formatKstTime } from '@/shared/lib/format';

export type ThumbnailSourceImage = components['schemas']['ThumbnailSourceImage'];
export type ThumbnailSourceImageList = components['schemas']['ThumbnailSourceImageList'];
export type ThumbnailReferencesRequest = components['schemas']['ThumbnailReferencesRequest'];
export type ThumbnailReferencesResult = components['schemas']['ThumbnailReferencesResult'];
export type ThumbnailPromptPreviewRequest = components['schemas']['ThumbnailPromptPreviewRequest'];
export type ThumbnailPromptPreview = components['schemas']['ThumbnailPromptPreview'];
export type ThumbnailFaceOption = components['schemas']['ThumbnailFaceOption'];
export type SourceSection = NonNullable<ThumbnailSourceImage['sourceSection']>;

/**
 * ⑤ 썸네일 준비 화면(SCR-05, Thumbnail.dc.html) 표시 규칙(P3-01). 레퍼런스 규칙·차단어 판단은 서버가 한다 — 여기서는 보드
 * 문구와 버튼 켜짐을 정한다.
 */

/** 레퍼런스 장수(IM-03, F-TH-04: 신발만 나온 컷 1~3장) */
export const REFERENCE_MAX = 3;

/** 얼굴 노출 수준(F-TH-11, 보드 순서·문구 그대로). 기본 전체(①-4) */
export const FACE_OPTIONS: readonly ThumbnailFaceOption[] = [
  'FULL_FACE',
  'CHIN_CROP',
  'HANDS_UPPER_BODY',
];
export const FACE_OPTION_LABEL: Record<ThumbnailFaceOption, string> = {
  FULL_FACE: '전체',
  CHIN_CROP: '턱 아래 크롭',
  HANDS_UPPER_BODY: '손·상반신만',
};
export const DEFAULT_FACE_OPTION: ThumbnailFaceOption = 'FULL_FACE';

/** 보드 문구 */
export const SOURCE_IMAGES_TITLE = '원본 이미지';
export const REFERENCE_ONLY_LABEL = '참조 전용';
export const REFERENCE_CHECKBOX_LABEL = '레퍼런스';
export const NO_PERSON_LABEL = '레퍼런스에 사람·얼굴 없음';
export const NO_PERSON_CAPTION = '체크해야 생성할 수 있습니다';
/** 원본 패널 아래 안내(보드 그대로 — '레퍼런스를 바꾸면 ⑤를 다시 실행해야 합니다'는 P3-01 규칙 10 문구) */
export const SOURCE_IMAGES_NOTE =
  '신발만 나온 컷 1~3장을 고릅니다 · 참조 전용 원본은 업로드하지 않습니다 · 레퍼런스를 바꾸면 ⑤를 다시 실행해야 합니다';
export const GENERATION_OPTIONS_TITLE = '생성 옵션';
export const FACE_GROUP_LABEL = '얼굴 노출 · 기본 전체';
export const PROMPT_TITLE = '프롬프트';
export const PROMPT_DEFAULT_META = '기본 골격 사용';
export const PROMPT_ADJUSTED_META = '조정 문구 사용';
export const PROMPT_ADJUSTMENT_LABEL = '프롬프트 조정(영어 권장, 2,000자까지)';
export const PROMPT_ADJUSTMENT_MAX = 2000;
export const NO_REAL_PERSON_TEXT = '실존 인물 이름 없음';
/** 생성 버튼(동작은 P3-02가 붙인다 — P3-01은 켜짐 조건만) */
export const GENERATE_LABEL = '만들기';

/** 빈 상태·꺼진 이유 문구(보드에 없음 — P3-01 Proposed) */
export const SOURCE_IMAGES_EMPTY_TEXT = '⑤를 실행하면 라쿠텐 원본 이미지를 받아 여기에 보입니다.';
export const SOURCE_IMAGES_LOADING_TEXT = '원본 이미지를 불러오는 중입니다.';
export const NOT_WAITING_REFERENCE_REASON =
  '⑤가 입력 대기일 때 레퍼런스를 고를 수 있습니다. 레퍼런스를 바꾸려면 ⑤를 다시 실행해 주세요.';
export const PICK_REFERENCE_FIRST_REASON = '레퍼런스를 1장 이상 고른 뒤 체크해 주세요.';
export const REFERENCE_LIMIT_REASON = '레퍼런스는 3장까지 고를 수 있습니다.';
export const GENERATE_NO_RUN_REASON = '⑤를 실행해 원본 이미지를 받은 뒤 만들 수 있습니다.';
export const GENERATE_NOT_WAITING_REASON = '⑤가 입력 대기일 때 만들 수 있습니다.';
export const GENERATE_NEEDS_REFERENCES_REASON =
  "레퍼런스 1~3장을 고르고 '레퍼런스에 사람·얼굴 없음'을 체크해 주세요.";
export const GENERATE_PREVIEW_PENDING_REASON = '프롬프트를 검사하는 중입니다.';
export const GENERATE_NOT_ALLOWED_REASON =
  '레퍼런스 확인이 저장되지 않았습니다. 다시 체크해 주세요.';

/** 차단어 이유 글(05-3 REAL_PERSON_NAME_BLOCKED 문구, `{단어}` = 걸린 단어) */
export function blockedTermsText(terms: readonly string[]): string {
  return `프롬프트에 실존 인물 이름(${terms.join(', ')})이 있어 만들 수 없습니다.`;
}

/** 원본 패널 출처 줄(보드 '라쿠텐 샵 A 상품 페이지 · 14:02 받음 · 6장'). 샵은 출처 샵 코드, 시각은 가장 늦게 받은 시각 */
export function sourceLineText(images: readonly ThumbnailSourceImage[]): string {
  if (images.length === 0) return '';
  const shop = images.find((i) => i.sourceShopCode)?.sourceShopCode ?? null;
  const times = images
    .map((i) => i.collectedAt)
    .filter((t): t is string => !!t)
    .sort();
  const last = times.at(-1);
  return [
    `라쿠텐 ${shop ?? '샵'} 상품 페이지`,
    last ? `${formatKstTime(last)} 받음` : null,
    `${images.length}장`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** 이미지 카드 아래 줄(보드 '1 · 1200×1200') */
export function imageCaption(
  index: number,
  image: Pick<ThumbnailSourceImage, 'width' | 'height'>,
): string {
  return `${index + 1} · ${image.width}×${image.height}`;
}

/** 레퍼런스 고르기 토글: 고른 것이면 빼고, 아니면 3장까지 뒤에 더한다(순서 = 고른 순서 = sortOrder) */
export function toggleReference(selection: readonly number[], imageAssetId: number): number[] {
  if (selection.includes(imageAssetId)) return selection.filter((id) => id !== imageAssetId);
  if (selection.length >= REFERENCE_MAX) return [...selection];
  return [...selection, imageAssetId];
}

/** 고른 순서 → PUT body(sortOrder 1~3). '사람·얼굴 없음'은 오너가 체크했을 때만 true로 부른다 */
export function referencesRequest(
  selection: readonly number[],
  noPersonConfirmed: boolean,
): ThumbnailReferencesRequest {
  return {
    references: selection.map((imageAssetId, i) => ({ imageAssetId, sortOrder: i + 1 })),
    noPersonConfirmed,
  };
}

/** 저장 결과가 지금 고른 것과 같은가(순서 포함) */
export function sameSelection(
  result: Pick<ThumbnailReferencesResult, 'references'> | null | undefined,
  selection: readonly number[],
): boolean {
  if (!result || result.references.length !== selection.length) return false;
  const saved = [...result.references].sort((a, b) => a.sortOrder - b.sortOrder);
  return saved.every((r, i) => r.imageAssetId === selection[i]);
}

export interface GenerateState {
  /** ⑤ 현재 실행이 있는가 */
  hasRun: boolean;
  /** ⑤가 입력 대기인가 */
  waiting: boolean;
  /** 레퍼런스 1~3장을 고르고 '사람·얼굴 없음'을 체크해 저장했는가(이 화면에서) */
  referencesConfirmed: boolean;
  preview: ThumbnailPromptPreview | undefined;
}

/**
 * 생성 버튼 꺼진 이유(F-TH-05·10, P3-01 규칙 15). 켜짐 = ⑤ 입력 대기 + 레퍼런스 1~3장 + '사람·얼굴 없음' 체크(이 화면에서
 * 저장) + 미리보기 `generationAllowed`(차단어 없음 + 서버의 확인한 레퍼런스). 켜지면 null
 */
export function generateDisabledReason(state: GenerateState): string | null {
  if (!state.hasRun) return GENERATE_NO_RUN_REASON;
  if (!state.waiting) return GENERATE_NOT_WAITING_REASON;
  if (state.preview?.realPersonNameDetected) return blockedTermsText(state.preview.blockedTerms);
  if (!state.referencesConfirmed) return GENERATE_NEEDS_REFERENCES_REASON;
  if (!state.preview) return GENERATE_PREVIEW_PENDING_REASON;
  if (!state.preview.generationAllowed) return GENERATE_NOT_ALLOWED_REASON;
  return null;
}
