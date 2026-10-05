import {
  generationSummary,
  promptPreview,
  sourceImage,
  thumbnailOutput,
} from '@/test/fixtures/thumbnails';
import { DEMO_IMAGE_ID, demoImageUrl } from '../images';
import { DEMO_IDS, STORY } from './story';
import type { Ok, Schema } from './types';
import { fakeSha256 } from './util';

export type FaceOption = Schema<'ThumbnailFaceOption'>;

export const FACE_OPTIONS: readonly FaceOption[] = ['FULL_FACE', 'CHIN_CROP', 'HANDS_UPPER_BODY'];

/** ショップA 상품 사진 3장(참조 전용 원본) */
export const SOURCE_IMAGE_IDS: readonly number[] = [
  DEMO_IMAGE_ID.source1,
  DEMO_IMAGE_ID.source2,
  DEMO_IMAGE_ID.source3,
];

/** ⑤ AI 후보 칸(번호 → 생성본). 번호 하나가 다시 만들어져도 그 번호의 그림은 같다 */
export const SLOT_IMAGE: Readonly<Record<number, number>> = {
  1: DEMO_IMAGE_ID.generated1,
  2: DEMO_IMAGE_ID.generated2,
};

/** 후보 칸 수(설정 `thumbnail.candidateCount` 기본 2) */
export const CANDIDATE_COUNT = Object.keys(SLOT_IMAGE).length;

/** 생성 요청 해상도(설정 `thumbnail.resolutionPx` 기본 1024 — D-21) */
export const RESOLUTION_PX = 1024;

/** 프롬프트 조정 문구 상한(05-2 maxLength) */
export const PROMPT_ADJUSTMENT_MAX = 2000;

/** 모든 이미지 id(원본 + 생성본) — 이 밖의 id는 없는 이미지(404 IMAGE_ASSET_NOT_FOUND) */
export const KNOWN_IMAGE_IDS: ReadonlySet<number> = new Set([
  ...SOURCE_IMAGE_IDS,
  ...Object.values(SLOT_IMAGE),
]);

/** G3 체크리스트 7칸(보드 순서, 05-2 GateThumbnailChecklist) */
export const G3_CHECKLIST_KEYS = [
  'shoeRatioOver70',
  'detailMatch',
  'colorMatchesSelectedColor',
  'referenceNoPerson',
  'noRealPersonResemblance',
  'noTextOrPrice',
  'singleProductSingleModel',
] as const;

// ── 프롬프트 · 실존 인물 차단어 ────────────────────────────────────────────────

/** 설정 `thumbnail.promptTemplate` 기본 골격(BE settings.default.json) */
const PROMPT_TEMPLATE = [
  'Photorealistic studio product photo, square 1:1, {resolution} pixels.',
  'A fictional young Korean male model with K-pop idol styling — NOT resembling any real person or celebrity —',
  'holds the exact shoe from the reference images toward the camera.',
  'The shoe is the hero: it fills at least 70% of the frame, centered, in sharp focus.',
  'Reproduce the shoe exactly as in the references: same logo, stitching, colors, materials, sole pattern, laces and eyelets.',
  'Do not add, remove, or alter any logo or text. One shoe (or one pair) only. One person only.',
  'Model framing: {face_option}.',
  'Clean light-gray background, soft studio lighting. No text, no watermark, no price, no graphics.',
].join('\n');

const FACE_PHRASE: Readonly<Record<FaceOption, string>> = {
  FULL_FACE: 'full face',
  CHIN_CROP: 'crop at chin (face not shown)',
  HANDS_UPPER_BODY: 'hands and upper body only',
};

/** 앱 내장 실존 인물·그룹 차단어(BE `BUILTIN_PERSON_BLOCK_WORDS`) */
const PERSON_BLOCK_WORDS: readonly string[] = [
  '방탄소년단',
  'BTS',
  '블랙핑크',
  'BLACKPINK',
  '트와이스',
  '세븐틴',
  '스트레이 키즈',
  'Stray Kids',
  '에스파',
  'aespa',
  '뉴진스',
  'NewJeans',
  '르세라핌',
  'LE SSERAFIM',
  '아이브',
  '엔하이픈',
  'ENHYPEN',
  '에이티즈',
  'ATEEZ',
  'ITZY',
  '차은우',
  '장원영',
  '카리나',
];

/** 조정 문구 정리: null·공백뿐이면 null */
export function normalizeAdjustment(adjustment: string | null | undefined): string | null {
  const text = adjustment?.trim() ?? '';
  return text === '' ? null : text;
}

/** 골격의 {resolution}·{face_option}을 채우고 조정 문구를 한 줄 띄워 붙인다(BE `buildPrompt`) */
export function buildPrompt(faceOption: FaceOption, adjustment: string | null): string {
  const body = PROMPT_TEMPLATE.split('{resolution}')
    .join(String(RESOLUTION_PX))
    .split('{face_option}')
    .join(FACE_PHRASE[faceOption])
    .trimEnd();
  return adjustment ? `${body}\n\n${adjustment}` : body;
}

const normalize = (text: string): string => text.normalize('NFKC').toLowerCase();
const ASCII_ALNUM = /[a-z0-9]/;
const escapeRegExp = (ch: string): string => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 프롬프트에 걸린 차단어(BE `findBlockedTerms`): NFKC·소문자, 차단어 안 공백 무시, 영문·숫자로 시작·끝나는 차단어는 단어 경계를 본다.
 * 사전 표기 그대로, 사전 순서대로 돌려준다.
 */
export function findBlockedTerms(prompt: string): string[] {
  const text = normalize(prompt);
  return PERSON_BLOCK_WORDS.filter((term) => {
    const chars = [...normalize(term).replace(/\s+/gu, '')];
    if (chars.length === 0) return false;
    const body = chars.map(escapeRegExp).join('\\s*');
    const head = ASCII_ALNUM.test(chars[0]!) ? '(?<![a-z0-9])' : '';
    const tail = ASCII_ALNUM.test(chars[chars.length - 1]!) ? '(?![a-z0-9])' : '';
    return new RegExp(`${head}${body}${tail}`, 'u').test(text);
  });
}

/** 프롬프트 미리보기(저장 없는 계산). 생성 허용 = 차단어 없음 + 이 실행에 확인한 레퍼런스 1~3장 */
export function thumbnailPromptPreview(input: {
  faceOption: FaceOption;
  promptAdjustment: string | null | undefined;
  referencesConfirmed: boolean;
}): Ok<'/thumbnail-prompt-previews', 'post'> {
  const adjustment = normalizeAdjustment(input.promptAdjustment);
  const prompt = buildPrompt(input.faceOption, adjustment);
  const blockedTerms = findBlockedTerms(prompt);
  return promptPreview({
    prompt,
    faceOption: input.faceOption,
    requestedSizePx: RESOLUTION_PX,
    promptAdjusted: adjustment !== null,
    realPersonNameDetected: blockedTerms.length > 0,
    blockedTerms,
    generationAllowed: blockedTerms.length === 0 && input.referencesConfirmed,
  });
}

// ── 원본 · 레퍼런스 ───────────────────────────────────────────────────────────

/** 원본 이미지 목록(받은 시각 `collectedAt`). 용도 배지는 모두 상품 이미지(PRODUCT_IMAGE) */
export function sourceImages(collectedAt: number): Ok<'/candidates/{candidateId}/source-images'> {
  return {
    itemCode: STORY.itemCode,
    items: SOURCE_IMAGE_IDS.map((imageAssetId, index) =>
      sourceImage({
        imageAssetId,
        sourceUrl: `tshop.r10s.jp/shop-a/cabinet/item/asics-1201a019-108_${index + 1}.jpg`,
        sourceItemCode: STORY.itemCode,
        sourceModelCodeNorm: '1201A019108',
        sourceColorCode: STORY.colorCode,
        collectedAt: new Date(collectedAt).toISOString(),
        fileUrl: demoImageUrl(imageAssetId),
        sha256: fakeSha256(`source-${imageAssetId}`),
      }),
    ),
  };
}

/** 이 ⑤ 버전의 레퍼런스 한 장 */
export interface ReferenceRec {
  id: number;
  imageAssetId: number;
  sortOrder: number;
  /** '사람·얼굴 없음'을 확인한 시각(ms) */
  confirmedAt: number;
}

export function referenceItems(refs: readonly ReferenceRec[]): Schema<'ThumbnailReferenceItem'>[] {
  return [...refs]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((ref) => ({
      id: ref.id,
      imageAssetId: ref.imageAssetId,
      sortOrder: ref.sortOrder,
      noPersonConfirmedAt: new Date(ref.confirmedAt).toISOString(),
      createdAt: new Date(ref.confirmedAt).toISOString(),
      isSameAnchor: true,
      fileUrl: demoImageUrl(ref.imageAssetId),
    }));
}

// ── 생성 시도 ────────────────────────────────────────────────────────────────

/** 생성 시도 한 건(번호 하나의 한 회차) */
export interface GenerationRec {
  id: number;
  slotNo: number;
  attemptNo: number;
  triggerType: 'INITIAL' | 'OWNER_RETRY';
  promptAdjusted: boolean;
  faceOption: FaceOption;
  prompt: string;
  status: 'RUNNING' | 'SUCCEEDED';
  resultImageAssetId: number | null;
  startedAt: number;
  finishedAt: number | null;
}

export function generationSummaryOf(
  rec: GenerationRec,
  adopted: boolean,
): Schema<'ThumbnailGenerationSummary'> {
  return generationSummary({
    slotNo: rec.slotNo,
    generationRunId: rec.id,
    attemptNo: rec.attemptNo,
    triggerType: rec.triggerType,
    promptAdjusted: rec.promptAdjusted,
    faceOption: rec.faceOption,
    requestedSizePx: RESOLUTION_PX,
    provider: 'AGY',
    model: 'gemini-3.8-flash-high',
    providerVersion: '1.2.9',
    status: rec.status,
    resultImageAssetId: rec.resultImageAssetId,
    startedAt: new Date(rec.startedAt).toISOString(),
    finishedAt: rec.finishedAt === null ? null : new Date(rec.finishedAt).toISOString(),
    adopted,
  });
}

/** 생성 시도 한 건 전체(프롬프트 전문 포함) */
export function generationRunDetail(
  rec: GenerationRec,
  view: { stepRunId: number; candidateId: number; adopted: boolean; referenceImageIds: number[] },
): Ok<'/generation-runs/{generationRunId}'> {
  return {
    ...generationSummaryOf(rec, view.adopted),
    stepRunId: view.stepRunId,
    candidateId: view.candidateId,
    prompt: rec.prompt,
    referenceSetSha256: fakeSha256(`references-${view.referenceImageIds.join(',')}`),
    shoeBox: null,
    detailVerdict: null,
  };
}

// ── ⑤ 산출물 · G3 선택 ────────────────────────────────────────────────────────

/** G3로 고른 선택본 */
export interface SelectionRec {
  id: number;
  representativeImageAssetId: number;
  additionalImageAssetIds: number[];
  sameProductColorConfirmedAt: number | null;
  selectedAt: number;
}

/** 이 이미지를 만든 생성 시도 id(선택본 이미지 줄의 `generationRunId`) */
export type RunIdOfImage = (imageAssetId: number) => number | null;

function selectionView(
  rec: SelectionRec,
  runIdOfImage: RunIdOfImage,
): NonNullable<Schema<'ThumbnailOutput'>['selection']> {
  const images = [
    { imageAssetId: rec.representativeImageAssetId, role: 'REPRESENTATIVE' as const },
    ...rec.additionalImageAssetIds.map((imageAssetId) => ({
      imageAssetId,
      role: 'ADDITIONAL' as const,
    })),
  ];
  return {
    thumbnailSelectionId: rec.id,
    checklist: {
      version: 'M1-2',
      shoeRatioOver70: true,
      detailMatch: true,
      colorMatchesSelectedColor: true,
      referenceNoPerson: true,
      noRealPersonResemblance: true,
      noTextOrPrice: true,
      singleProductSingleModel: true,
    },
    sameProductColorConfirmedAt:
      rec.sameProductColorConfirmedAt === null
        ? null
        : new Date(rec.sameProductColorConfirmedAt).toISOString(),
    selectedAt: new Date(rec.selectedAt).toISOString(),
    images: images.map((image, sortOrder) => ({
      imageAssetId: image.imageAssetId,
      generationRunId: runIdOfImage(image.imageAssetId),
      role: image.role,
      sortOrder,
      fileUrl: demoImageUrl(image.imageAssetId),
    })),
  };
}

/** ⑤ 한 버전의 산출물 한 화면 단위 */
export function thumbnailOutputOf(input: {
  stepRunId: number;
  candidateId: number;
  version: number;
  stepRunStatus: Schema<'StepStatus'>;
  isCurrent: boolean;
  references: readonly ReferenceRec[];
  generations: readonly GenerationRec[];
  selection: SelectionRec | null;
  g3: { gatePassId: number; passedAt: number; basisStepRunId: number } | null;
  g3Valid: boolean;
}): Ok<'/candidates/{candidateId}/thumbnail'> {
  const adoptedIds = new Set(
    input.selection
      ? [input.selection.representativeImageAssetId, ...input.selection.additionalImageAssetIds]
      : [],
  );
  const runIdOfImage: RunIdOfImage = (imageAssetId) =>
    input.generations.find((run) => run.resultImageAssetId === imageAssetId)?.id ?? null;
  return thumbnailOutput({
    stepRunId: input.stepRunId,
    candidateId: input.candidateId,
    version: input.version,
    stepRunStatus: input.stepRunStatus,
    isCurrent: input.isCurrent,
    references: referenceItems(input.references),
    referencesConfirmed: input.references.length >= 1 && input.references.length <= 3,
    candidateCount: CANDIDATE_COUNT,
    generationRuns: [...input.generations]
      .sort((a, b) => a.slotNo - b.slotNo || a.attemptNo - b.attemptNo)
      .map((run) =>
        generationSummaryOf(
          run,
          run.resultImageAssetId !== null && adoptedIds.has(run.resultImageAssetId),
        ),
      ),
    selection: input.selection ? selectionView(input.selection, runIdOfImage) : null,
    g3: {
      gatePassId: input.g3?.gatePassId ?? null,
      passedAt: input.g3 ? new Date(input.g3.passedAt).toISOString() : null,
      basisStepRunId: input.g3?.basisStepRunId ?? null,
      valid: input.g3Valid,
      changedBasisKeys: [],
    },
    sameProductColorRequired: false,
  });
}

/** 예시 여정의 G3 선택본 id(이야기 값) */
export const SELECTION_ID = DEMO_IDS.thumbnailSelection;
