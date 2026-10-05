import type { DemoWorld } from '../../demoWorld';
import { get, post, put, read, type DemoRoute } from '../../router';
import {
  buildPrompt,
  CANDIDATE_COUNT,
  FACE_OPTIONS,
  findBlockedTerms,
  G3_CHECKLIST_KEYS,
  generationRunDetail,
  KNOWN_IMAGE_IDS,
  normalizeAdjustment,
  PROMPT_ADJUSTMENT_MAX,
  SELECTION_ID,
  SLOT_IMAGE,
  SOURCE_IMAGE_IDS,
  sourceImages,
  thumbnailOutputOf,
  thumbnailPromptPreview,
  referenceItems,
  type FaceOption,
  type GenerationRec,
  type ReferenceRec,
  type SelectionRec,
} from '../../sample/thumbnail';
import type { Schema } from '../../sample/types';
import { fakeSha256 } from '../../sample/util';
import { closeStepRun, currentRun, openStepRun, reevaluate, resumeToComplete } from '../engine';
import { httpError, validationFailed } from '../errors';
import type { StepRunner } from '../runner';
import { gateResult } from './pricing';
import {
  assertMutable,
  assertQueryKeys,
  assertStepRun,
  isId,
  isInt,
  isWaitingCurrent,
  notWaitingInput,
  outputNotFound,
  stepLocked,
  stepNotCompleted,
  stepRunIdOf,
  stepRunIdQuery,
  stepRunNotFound,
  throwIfFieldErrors,
  versionNotCurrent,
  type FieldErrors,
} from './guards';

/**
 * ⑤ 썸네일 + G3 썸네일 선택. 근거: BE `modules/thumbnails`.
 * - [실행]: 선택한 상품의 라쿠텐 원본 사진을 받고(원본은 상품 단위로 남는다) 입력 대기(`THUMBNAIL_REFERENCE_REQUIRED`)가 된다.
 *   ⑤는 G3(썸네일 선택)을 통과해야 끝난다 — 레퍼런스 저장과 생성 시도는 단계 상태를 바꾸지 않는다.
 * - 레퍼런스 1~3장 + '사람·얼굴 없음' 확인 → 생성(후보 2칸, 지연 뒤 SUCCEEDED) → 대표·추가 고르기 + 체크 7개 → G3 통과.
 * - 다시 실행하면 레퍼런스·생성 시도·선택본은 처음으로 돌아가고(G3는 ⑤가 끝나야 유효하다), 받아 둔 원본은 그대로다.
 */
export interface ThumbnailState {
  /** 원본을 받은 시각(ms) — 받기 전 null. 원본은 다시 실행해도 남는다 */
  originalsReceivedAt: number | null;
  /** 이 ⑤ 실행의 레퍼런스('사람·얼굴 없음'을 확인한 것만 저장한다) */
  references: ReferenceRec[];
  /** 레퍼런스를 저장한 횟수(후보 단위 선택 번호) */
  referenceInputNo: number;
  nextReferenceId: number;
  /** 생성 시도(번호·회차 순으로 쌓인다) */
  generations: GenerationRec[];
  nextGenerationId: number;
  /** 생성 시도를 연 ⑤ 실행 id(이 이미지들을 만든 버전). 다시 실행하면 새 이미지라 선택본 값도 달라진다 */
  generationRunId: number | null;
  /** G3로 고른 선택본 */
  selection: SelectionRec | null;
}

export const initialThumbnail = (): ThumbnailState => ({
  originalsReceivedAt: null,
  references: [],
  referenceInputNo: 0,
  nextReferenceId: 100,
  generations: [],
  nextGenerationId: 701,
  generationRunId: null,
  selection: null,
});

/** 레퍼런스·생성 진행(띠의 '다음에 할 일' 판단): 없음 → 레퍼런스 확인 → 생성 중 → 후보 생성됨 */
export type ThumbnailPhase = 'NONE' | 'REFERENCES' | 'GENERATING' | 'GENERATED';

export const thumbnailPhase = (s: ThumbnailState): ThumbnailPhase => {
  if (s.generations.some((run) => run.status === 'RUNNING')) return 'GENERATING';
  if (s.generations.some((run) => run.status === 'SUCCEEDED')) return 'GENERATED';
  return s.references.length > 0 ? 'REFERENCES' : 'NONE';
};

const REFERENCE_MIN = 1;
const REFERENCE_MAX = 3;
const ADDITIONAL_MAX = 9;

const generationRunning = (s: ThumbnailState): GenerationRec[] =>
  s.generations.filter((run) => run.status === 'RUNNING');

// ── 실행기 ─────────────────────────────────────────────────────────────────

export const thumbnailRunner: StepRunner = {
  stepCode: 'THUMBNAIL',
  delay: 'medium',
  onStart(w) {
    // 새 실행: 레퍼런스·생성본·선택본은 새 버전에서 새로 만든다. 받아 둔 원본 사진은 상품 단위라 그대로다
    const s = w.s.thumbnail;
    s.references = [];
    s.generations = [];
    s.generationRunId = null;
    s.selection = null;
  },
  outcome() {
    return {
      status: 'WAITING_INPUT',
      reasonCode: 'THUMBNAIL_REFERENCE_REQUIRED',
      pendingInputs: ['owner.referenceSelection'],
    };
  },
  onSettled(w, outcome) {
    // 원본을 받았다(입력 대기에 이르렀을 때). G3 통과로 끝나는 완료는 아무것도 바꾸지 않는다
    if (outcome.status === 'WAITING_INPUT' && w.s.thumbnail.originalsReceivedAt === null) {
      w.s.thumbnail.originalsReceivedAt = w.now();
    }
  },
};

// ── 조회 ───────────────────────────────────────────────────────────────────

/** `GET …/source-images`: ② 선택 상품의 원본 사진. ⑤ 실행 전에는 빈 목록 */
function sourceImageList(w: DemoWorld, query: URLSearchParams) {
  assertQueryKeys(query, ['sourceSection']);
  const section = query.get('sourceSection');
  if (section !== null && section !== 'PRODUCT_IMAGE' && section !== 'DESCRIPTION_IMAGE') {
    throw httpError(422, 'INVALID_QUERY_PARAMETER', '목록 조건이 올바르지 않습니다.', {
      fieldErrors: [
        { field: 'sourceSection', message: 'PRODUCT_IMAGE·DESCRIPTION_IMAGE 중 하나여야 합니다.' },
      ],
    });
  }
  const candidate = w.candidate();
  if (!candidate.itemCode) {
    throw httpError(409, 'SOURCING_SELECTION_REQUIRED', '② 소싱에서 상품을 먼저 골라 주세요.');
  }
  const received = w.s.thumbnail.originalsReceivedAt;
  if (received === null || section === 'DESCRIPTION_IMAGE') {
    return { itemCode: candidate.itemCode, items: [] };
  }
  return sourceImages(received);
}

/** 이 이미지를 결과로 낸 성공 시도가 지금 ⑤ 실행의 것인가 */
const isOurResult = (s: ThumbnailState, imageAssetId: number): boolean =>
  s.generations.some(
    (run) => run.status === 'SUCCEEDED' && run.resultImageAssetId === imageAssetId,
  );

/** `GET …/thumbnail`: ⑤ 한 버전의 산출물. ⑤를 한 번도 실행하지 않았을 때만 404 STEP_OUTPUT_NOT_FOUND */
function thumbnailView(w: DemoWorld, query: URLSearchParams) {
  assertQueryKeys(query, ['stepRunId']);
  const asked = stepRunIdQuery(query);
  const current = currentRun(w, 'THUMBNAIL');
  if (asked !== null) {
    // 지난 버전은 체험에 남지 않는다 — 현재 ⑤ 실행만 있다
    if (!current || current.id !== asked) throw stepRunNotFound();
  }
  if (!current) throw outputNotFound('THUMBNAIL');
  const run = current;
  const s = w.s.thumbnail;
  return thumbnailOutputOf({
    stepRunId: run.id,
    candidateId: w.candidate().id,
    version: run.version,
    stepRunStatus: w.s.steps.THUMBNAIL.status,
    isCurrent: true,
    references: s.references,
    generations: s.generations,
    selection: s.selection,
    g3: w.s.gates.G3,
    g3Valid: w.s.gates.G3 !== null && w.s.steps.THUMBNAIL.status === 'COMPLETED',
  });
}

// ── 레퍼런스 ───────────────────────────────────────────────────────────────

const imageNotAllowed = (message: string, details: Record<string, unknown>) =>
  httpError(422, 'IMAGE_NOT_ALLOWED', `이 이미지는 여기에 쓸 수 없습니다(${message}).`, {
    details,
  });

const imageNotFound = (imageAssetId: number) =>
  httpError(404, 'IMAGE_ASSET_NOT_FOUND', '이미지를 찾을 수 없습니다.', {
    details: { imageAssetId },
  });

const generationInProgress = (details: Record<string, unknown>) =>
  httpError(
    409,
    'ALREADY_IN_PROGRESS',
    '썸네일 생성이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
    { details: { job: 'GENERATION', ...details } },
  );

interface Choice {
  imageAssetId: number;
  sortOrder: number;
}

/** 개수(1~3) → 순서 범위·겹침 검사 후 순서대로(BE `validateChoices`) */
function validateChoices(references: unknown): Choice[] {
  if (!Array.isArray(references)) {
    throw validationFailed('references', '배열이어야 합니다.', references);
  }
  const choices: Choice[] = [];
  references.forEach((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const errors: FieldErrors = [];
    if (!isId(row.imageAssetId)) {
      errors.push({
        field: `references[${index}].imageAssetId`,
        message: '1 이상의 정수여야 합니다.',
        rejectedValue: row.imageAssetId,
      });
    }
    if (!isInt(row.sortOrder)) {
      errors.push({
        field: `references[${index}].sortOrder`,
        message: '1~3이어야 합니다.',
        rejectedValue: row.sortOrder,
      });
    }
    throwIfFieldErrors(errors);
    choices.push({ imageAssetId: row.imageAssetId as number, sortOrder: row.sortOrder as number });
  });
  if (choices.length < REFERENCE_MIN || choices.length > REFERENCE_MAX) {
    throw httpError(
      422,
      'IMAGE_COUNT_INVALID',
      '고른 이미지 수가 맞지 않습니다(레퍼런스 1~3장, 추가이미지 9장까지).',
      { details: { count: choices.length, min: REFERENCE_MIN, max: REFERENCE_MAX } },
    );
  }
  if (choices.some((c) => c.sortOrder < 1 || c.sortOrder > REFERENCE_MAX)) {
    throw validationFailed('references.sortOrder', '1~3이어야 합니다.');
  }
  const ids = new Set(choices.map((c) => c.imageAssetId));
  const orders = new Set(choices.map((c) => c.sortOrder));
  if (ids.size !== choices.length || orders.size !== choices.length) {
    throw validationFailed('references', '같은 이미지나 같은 순서를 두 번 넣을 수 없습니다.');
  }
  return [...choices].sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * `PUT /step-runs/{id}/thumbnail-references`(200): 레퍼런스 1~3장과 '사람·얼굴 없음' 확인. 검사 순서(BE): 실행 없음 404 → ⑤ 아님 422 →
 * 장수 422 → 확인 없음 422 → 잠긴·제외 여정 409 → 입력 대기 아님 409 → 생성 중 409 → 없는 이미지 404 → 쓸 수 없는 이미지 422.
 * 최신 선택과 같은 선택이면 새 번호 없이 200(멱등).
 */
function putReferences(
  w: DemoWorld,
  idText: string | undefined,
  body: Record<string, unknown>,
): Schema<'ThumbnailReferencesResult'> {
  const stepRunId = stepRunIdOf(idText);
  const run = assertStepRun(w, stepRunId, 'THUMBNAIL', 'NOT_THUMBNAIL');
  const choices = validateChoices(body.references);
  if (body.noPersonConfirmed !== true) {
    throw httpError(422, 'NO_PERSON_CONFIRMATION_REQUIRED', "'사람·얼굴 없음'을 체크해 주세요.");
  }
  assertMutable(w);
  if (!isWaitingCurrent(w, 'THUMBNAIL', run)) {
    throw notWaitingInput({ stepRunId, status: run.status });
  }
  const s = w.s.thumbnail;
  const running = generationRunning(s);
  if (running.length > 0) throw generationInProgress({});
  for (const choice of choices) {
    if (!KNOWN_IMAGE_IDS.has(choice.imageAssetId)) throw imageNotFound(choice.imageAssetId);
  }
  for (const choice of choices) {
    if (!SOURCE_IMAGE_IDS.includes(choice.imageAssetId)) {
      throw imageNotAllowed('라쿠텐 원본 이미지만 레퍼런스로 고를 수 있습니다', {
        imageAssetId: choice.imageAssetId,
        reason: 'NOT_ORIGINAL',
      });
    }
  }

  const same =
    s.references.length === choices.length &&
    choices.every((c, i) => {
      const ref = s.references[i];
      return ref?.imageAssetId === c.imageAssetId && ref.sortOrder === c.sortOrder;
    });
  if (!same) {
    const now = w.now();
    s.referenceInputNo += 1;
    s.references = choices.map((c) => ({
      id: s.nextReferenceId++,
      imageAssetId: c.imageAssetId,
      sortOrder: c.sortOrder,
      confirmedAt: now,
    }));
    w.mark('referencesConfirmed', now);
  }
  return {
    stepRunId,
    inputNo: Math.max(s.referenceInputNo, 1),
    references: referenceItems(s.references),
    sameProductColorRequired: false,
  };
}

// ── 프롬프트 미리보기 · 생성 ─────────────────────────────────────────────────

const FACE_MESSAGE = 'FULL_FACE·CHIN_CROP·HANDS_UPPER_BODY 중 하나여야 합니다.';
const isFaceOption = (value: unknown): value is FaceOption =>
  typeof value === 'string' && (FACE_OPTIONS as readonly string[]).includes(value);

/** `POST /thumbnail-prompt-previews`(200, 저장 없음): 채운 프롬프트와 차단어 검사. 차단어가 있어도 200이다 */
function promptPreview(w: DemoWorld, body: Record<string, unknown>) {
  const errors: FieldErrors = [];
  if (!isId(body.stepRunId)) {
    errors.push({
      field: 'stepRunId',
      message: '1 이상의 정수여야 합니다.',
      rejectedValue: body.stepRunId,
    });
  }
  if (!isFaceOption(body.faceOption)) {
    errors.push({ field: 'faceOption', message: FACE_MESSAGE, rejectedValue: body.faceOption });
  }
  const adjustment = body.promptAdjustment;
  if (adjustment !== undefined && adjustment !== null) {
    if (typeof adjustment !== 'string') {
      errors.push({ field: 'promptAdjustment', message: '글자여야 합니다.' });
    } else if (adjustment.length > PROMPT_ADJUSTMENT_MAX) {
      errors.push({
        field: 'promptAdjustment',
        message: `${PROMPT_ADJUSTMENT_MAX}자 이하여야 합니다.`,
      });
    }
  }
  throwIfFieldErrors(errors);
  const run = assertStepRun(w, body.stepRunId as number, 'THUMBNAIL', 'NOT_THUMBNAIL');
  const isCurrent = currentRun(w, 'THUMBNAIL')?.id === run.id;
  return thumbnailPromptPreview({
    faceOption: body.faceOption as FaceOption,
    promptAdjustment: adjustment as string | null | undefined,
    referencesConfirmed: isCurrent && w.s.thumbnail.references.length >= REFERENCE_MIN,
  });
}

interface GenerationRequest {
  slotNos: number[];
  faceOption: FaceOption;
  promptAdjustment: string | null;
}

/** 요청 값 검사(BE `parseGenerationRequest`): 번호는 1..N의 서로 다른 정수 1개 이상, 얼굴 3종, 조정 문구 2000자 이하 */
function parseGenerationRequest(body: Record<string, unknown>): GenerationRequest {
  const errors: FieldErrors = [];
  const slots = body.slotNos;
  if (
    !Array.isArray(slots) ||
    slots.length === 0 ||
    !slots.every((n) => isInt(n) && n >= 1 && n <= CANDIDATE_COUNT) ||
    new Set(slots).size !== slots.length
  ) {
    errors.push({
      field: 'slotNos',
      message: `후보 번호는 1~${CANDIDATE_COUNT} 안의 서로 다른 정수 1개 이상이어야 합니다.`,
      rejectedValue: slots,
    });
  }
  if (!isFaceOption(body.faceOption)) {
    errors.push({ field: 'faceOption', message: FACE_MESSAGE, rejectedValue: body.faceOption });
  }
  const adjustment = body.promptAdjustment;
  if (
    adjustment !== undefined &&
    adjustment !== null &&
    (typeof adjustment !== 'string' || adjustment.length > PROMPT_ADJUSTMENT_MAX)
  ) {
    errors.push({
      field: 'promptAdjustment',
      message: `${PROMPT_ADJUSTMENT_MAX}자 이하 글이어야 합니다.`,
    });
  }
  throwIfFieldErrors(errors);
  return {
    slotNos: [...(slots as number[])].sort((a, b) => a - b),
    faceOption: body.faceOption as FaceOption,
    promptAdjustment: typeof adjustment === 'string' ? adjustment : null,
  };
}

/**
 * `POST /step-runs/{id}/generation-runs`(202): 번호마다 생성 시도를 RUNNING으로 열고, 지연 뒤 차례로 SUCCEEDED로 닫는다(이미지
 * 작업은 한 번에 하나라 번호 순서대로 끝난다). 검사 순서(BE): 실행 없음 404 → ⑤ 아님 422 → 모양 422 → 실존 인물 이름 422 → 잠긴·제외 409
 * → 입력 대기 아님 409 → 레퍼런스 미확인 409 → 같은 번호 생성 중 409. ⑤ 단계 상태는 입력 대기 그대로다.
 */
function createGenerationRuns(
  w: DemoWorld,
  idText: string | undefined,
  body: Record<string, unknown>,
): Schema<'GenerationRunAccepted'> {
  const stepRunId = stepRunIdOf(idText);
  const run = assertStepRun(w, stepRunId, 'THUMBNAIL', 'NOT_THUMBNAIL');
  const request = parseGenerationRequest(body);
  const adjustment = normalizeAdjustment(request.promptAdjustment);
  const prompt = buildPrompt(request.faceOption, adjustment);
  const blockedTerms = findBlockedTerms(prompt);
  if (blockedTerms.length > 0) {
    throw httpError(
      422,
      'REAL_PERSON_NAME_BLOCKED',
      `프롬프트에 실존 인물 이름(${blockedTerms.join(', ')})이 있어 만들 수 없습니다.`,
      { details: { blockedTerms } },
    );
  }
  assertMutable(w);
  if (!isWaitingCurrent(w, 'THUMBNAIL', run)) {
    throw notWaitingInput({ stepRunId, status: run.status });
  }
  const s = w.s.thumbnail;
  if (s.references.length < REFERENCE_MIN || s.references.length > REFERENCE_MAX) {
    throw httpError(
      409,
      'REFERENCES_NOT_CONFIRMED',
      "레퍼런스 컷을 고르고 '사람·얼굴 없음'을 체크해 주세요.",
      { details: { stepRunId, referenceCount: s.references.length } },
    );
  }
  const busy = request.slotNos.filter((slot) =>
    s.generations.some((g) => g.slotNo === slot && g.status === 'RUNNING'),
  );
  if (busy.length > 0) throw generationInProgress({ slotNos: busy });

  const now = w.now();
  s.generationRunId = run.id;
  const created: GenerationRec[] = request.slotNos.map((slotNo) => {
    const attemptNo = s.generations.filter((g) => g.slotNo === slotNo).length + 1;
    const rec: GenerationRec = {
      id: s.nextGenerationId++,
      slotNo,
      attemptNo,
      triggerType: attemptNo === 1 ? 'INITIAL' : 'OWNER_RETRY',
      promptAdjusted: adjustment !== null,
      faceOption: request.faceOption,
      prompt,
      status: 'RUNNING',
      resultImageAssetId: null,
      startedAt: now,
      finishedAt: null,
    };
    s.generations.push(rec);
    return rec;
  });
  w.mark('generationStarted', now);
  // 이미지 작업은 한 번에 하나라 번호 순서대로 끝난다: 첫 칸은 보통, 다음 칸은 조금 뒤
  created.forEach((rec, index) => {
    w.schedule(w.delay('medium') + index * w.delay('short'), () => {
      // 처음으로 돌아갔거나(다시 실행·처음부터 다시) 이미 닫힌 시도면 아무것도 하지 않는다
      if (!w.s.thumbnail.generations.includes(rec) || rec.status !== 'RUNNING') return;
      const finished = w.now();
      rec.status = 'SUCCEEDED';
      rec.resultImageAssetId = SLOT_IMAGE[rec.slotNo] ?? null;
      rec.finishedAt = finished;
      if (!w.s.thumbnail.generations.some((g) => g.status === 'RUNNING')) {
        w.mark('generationDone', finished);
      }
    });
  });
  return {
    stepRunId,
    candidateId: w.candidate().id,
    generationRuns: created.map((rec) => ({
      generationRunId: rec.id,
      slotNo: rec.slotNo,
      attemptNo: rec.attemptNo,
      triggerType: rec.triggerType,
      status: 'RUNNING' as const,
    })),
  };
}

/** `GET /generation-runs/{id}`: 시도 한 건(프롬프트 전문). 모르는 id는 404 GENERATION_RUN_NOT_FOUND */
function generationRunView(w: DemoWorld, idText: string | undefined) {
  const s = w.s.thumbnail;
  const rec =
    idText !== undefined && /^[1-9]\d{0,9}$/.test(idText)
      ? s.generations.find((g) => g.id === Number(idText))
      : undefined;
  const run = currentRun(w, 'THUMBNAIL');
  if (!rec || !run) {
    throw httpError(404, 'GENERATION_RUN_NOT_FOUND', '썸네일 생성 기록을 찾을 수 없습니다.');
  }
  const adopted =
    rec.resultImageAssetId !== null &&
    s.selection !== null &&
    (s.selection.representativeImageAssetId === rec.resultImageAssetId ||
      s.selection.additionalImageAssetIds.includes(rec.resultImageAssetId));
  return generationRunDetail(rec, {
    stepRunId: run.id,
    candidateId: w.candidate().id,
    adopted,
    referenceImageIds: s.references.map((ref) => ref.imageAssetId),
  });
}

// ── G3 썸네일 선택 ──────────────────────────────────────────────────────────

interface G3Body {
  basisStepRunId: number;
  representativeImageAssetId: number;
  additionalImageAssetIds: number[];
  checklist: Record<string, unknown>;
  sameProductColorConfirmed: boolean;
}

/** 통과 요청 모양 검사(BE `parseGatePassBody` G3). 어긋나면 422 VALIDATION_FAILED(칸 오류를 모두 모은다) */
function parseG3Body(body: Record<string, unknown>): G3Body {
  const allowed = [
    'basisStepRunId',
    'representativeImageAssetId',
    'additionalImageAssetIds',
    'checklist',
    'sameProductColorConfirmed',
  ];
  const errors: FieldErrors = [];
  for (const key of Object.keys(body)) {
    if (body[key] !== undefined && !allowed.includes(key)) {
      errors.push({
        field: key,
        message: 'G3 통과에서는 받지 않는 칸입니다.',
        rejectedValue: body[key],
      });
    }
  }
  if (!isId(body.basisStepRunId)) {
    errors.push({
      field: 'basisStepRunId',
      message: '1 이상의 정수여야 합니다.',
      rejectedValue: body.basisStepRunId,
    });
  }
  if (!isId(body.representativeImageAssetId)) {
    errors.push({
      field: 'representativeImageAssetId',
      message: '1 이상의 정수여야 합니다.',
      rejectedValue: body.representativeImageAssetId,
    });
  }
  const extra = body.additionalImageAssetIds;
  if (
    !Array.isArray(extra) ||
    extra.length > 100 ||
    !extra.every(isId) ||
    new Set(extra).size !== extra.length
  ) {
    errors.push({
      field: 'additionalImageAssetIds',
      message: '서로 다른 이미지 id 목록이어야 합니다(추가이미지는 9장까지).',
      rejectedValue: extra,
    });
  } else if (extra.includes(body.representativeImageAssetId as number)) {
    errors.push({
      field: 'additionalImageAssetIds',
      message: '대표이미지를 추가이미지에 다시 넣을 수 없습니다.',
      rejectedValue: extra,
    });
  }
  const checklist = body.checklist;
  if (!checklist || typeof checklist !== 'object' || Array.isArray(checklist)) {
    errors.push({
      field: 'checklist',
      message: '체크리스트가 필요합니다.',
      rejectedValue: checklist,
    });
  }
  if (
    body.sameProductColorConfirmed !== undefined &&
    typeof body.sameProductColorConfirmed !== 'boolean'
  ) {
    errors.push({
      field: 'sameProductColorConfirmed',
      message: 'true·false여야 합니다.',
      rejectedValue: body.sameProductColorConfirmed,
    });
  }
  throwIfFieldErrors(errors);
  return {
    basisStepRunId: body.basisStepRunId as number,
    representativeImageAssetId: body.representativeImageAssetId as number,
    additionalImageAssetIds: [...(extra as number[])],
    checklist: checklist as Record<string, unknown>,
    sameProductColorConfirmed: body.sameProductColorConfirmed === true,
  };
}

/** 체크리스트 칸 검사: 모르는 키·boolean이 아닌 값은 422 VALIDATION_FAILED, 빠진 칸·false는 CHECKLIST_INCOMPLETE */
function checkChecklist(checklist: Record<string, unknown>): void {
  const errors: FieldErrors = [];
  for (const [key, value] of Object.entries(checklist)) {
    if (!(G3_CHECKLIST_KEYS as readonly string[]).includes(key)) {
      errors.push({
        field: `checklist.${key}`,
        message: '받지 않는 항목입니다.',
        rejectedValue: value,
      });
    } else if (value !== undefined && typeof value !== 'boolean') {
      errors.push({
        field: `checklist.${key}`,
        message: 'true·false여야 합니다.',
        rejectedValue: value,
      });
    }
  }
  throwIfFieldErrors(errors);
  const unchecked = G3_CHECKLIST_KEYS.filter((key) => checklist[key] !== true);
  if (unchecked.length > 0) {
    throw httpError(422, 'CHECKLIST_INCOMPLETE', '체크리스트를 모두 확인해 주세요.', {
      details: { uncheckedKeys: unchecked },
    });
  }
}

/**
 * `POST …/gates/G3/pass`(201, 같은 선택으로 이미 통과했으면 200): 대표 1장 + 추가 0~9장과 체크 7개로 ⑤를 끝낸다.
 * 검사 순서(BE): 본문 모양 422 → 잠긴·제외 409 → ② 실행 중 409 → 현재 버전이 아님 409 → ⑤가 입력 대기·완료가 아님 409 →
 * 체크리스트 422 → 추가 10장 이상 422 → 없는 이미지 404 → 이 ⑤에서 만든 AI 후보가 아님 422 → 생성 중 409.
 * ⑤가 입력 대기면 그 실행을 끝내고, 이미 완료면 다시 고르는 것이라 오너 수정 새 버전(OWNER_EDIT)을 연다.
 */
export function passG3(
  w: DemoWorld,
  rawBody: Record<string, unknown>,
): Schema<'GatePassResult'> | Response {
  const body = parseG3Body(rawBody);
  const candidate = w.candidate();
  assertMutable(w);
  if (w.s.steps.SOURCING.status === 'RUNNING') throw stepLocked('SOURCING');
  const run = currentRun(w, 'THUMBNAIL');
  if (!run || run.id !== body.basisStepRunId) throw versionNotCurrent('THUMBNAIL', run?.id ?? null);
  const status = w.s.steps.THUMBNAIL.status;
  if (status !== 'WAITING_INPUT' && status !== 'COMPLETED') {
    throw stepNotCompleted('THUMBNAIL', status);
  }

  checkChecklist(body.checklist);
  if (body.additionalImageAssetIds.length > ADDITIONAL_MAX) {
    throw httpError(
      422,
      'IMAGE_COUNT_INVALID',
      '고른 이미지 수가 맞지 않습니다(레퍼런스 1~3장, 추가이미지 9장까지).',
      {
        details: { additionalCount: body.additionalImageAssetIds.length, max: ADDITIONAL_MAX },
      },
    );
  }
  const s = w.s.thumbnail;
  const images = [body.representativeImageAssetId, ...body.additionalImageAssetIds];
  for (const id of images) if (!KNOWN_IMAGE_IDS.has(id)) throw imageNotFound(id);
  for (const id of images) {
    if (SOURCE_IMAGE_IDS.includes(id)) {
      throw imageNotAllowed('라쿠텐 원본·참조 전용 이미지는 대표·추가이미지로 고를 수 없습니다', {
        imageAssetId: id,
        reason: 'NOT_GENERATED',
      });
    }
    if (!isOurResult(s, id)) {
      throw imageNotAllowed('이 ⑤ 버전에서 만든 AI 생성 후보가 아닙니다', {
        imageAssetId: id,
        reason: 'OTHER_RUN',
      });
    }
  }
  const running = generationRunning(s);
  if (running.length > 0) throw generationInProgress({ runningCount: running.length });

  const fingerprint = fakeSha256(
    `g3:${s.references.map((r) => r.imageAssetId).join(',')}:${images.join(',')}`,
  );
  const known = w.s.gates.G3;
  const current = s.selection;
  const sameSelection =
    current !== null &&
    current.representativeImageAssetId === body.representativeImageAssetId &&
    current.additionalImageAssetIds.length === body.additionalImageAssetIds.length &&
    current.additionalImageAssetIds.every((id, i) => id === body.additionalImageAssetIds[i]);
  if (known && status === 'COMPLETED' && sameSelection) {
    // 같은 선택이면 새 기록 없이 기존 통과(200)
    return Response.json(
      gateResult(
        known.gatePassId,
        'G3',
        fingerprint,
        known.basisStepRunId,
        known.passedAt,
        candidate.status,
        false,
      ),
      { status: 200 },
    );
  }

  const before = candidate.status;
  const now = w.now();
  let basis = run;
  if (status === 'COMPLETED') {
    // 완료된 ⑤를 다시 고르면 오너 수정 새 버전을 연다(레퍼런스·생성본은 그대로, 새 선택으로 닫는다)
    basis = openStepRun(w, 'THUMBNAIL', 'OWNER_EDIT');
  }
  s.selection = {
    id: SELECTION_ID,
    representativeImageAssetId: body.representativeImageAssetId,
    additionalImageAssetIds: [...body.additionalImageAssetIds],
    sameProductColorConfirmedAt: body.sameProductColorConfirmed ? now : null,
    selectedAt: now,
  };
  const record = { gatePassId: w.s.next.gatePass++, passedAt: now, basisStepRunId: basis.id };
  w.s.gates.G3 = record;
  if (status === 'COMPLETED') {
    closeStepRun(w, 'THUMBNAIL', basis);
    reevaluate(w);
  } else {
    // 입력 대기였던 ⑤를 같은 실행·같은 버전으로 끝낸다(여정 상태 재평가·연속 실행 이어 가기 포함)
    resumeToComplete(w, 'THUMBNAIL');
  }
  return gateResult(
    record.gatePassId,
    'G3',
    fingerprint,
    basis.id,
    now,
    candidate.status,
    candidate.status !== before,
    { thumbnailSelectionId: SELECTION_ID, thumbnailStepRunId: basis.id },
  );
}

// ── 라우트 ─────────────────────────────────────────────────────────────────

export const thumbnailRoutes: DemoRoute[] = [
  get('/candidates/{candidateId}/source-images', ({ world, query }) =>
    sourceImageList(world, query),
  ),
  get('/candidates/{candidateId}/thumbnail', ({ world, query }) => thumbnailView(world, query)),
  put('/step-runs/{stepRunId}/thumbnail-references', 200, async ({ world, params, json }) =>
    putReferences(
      world,
      params.stepRunId,
      (await json<Record<string, unknown>>()) as Record<string, unknown>,
    ),
  ),
  read('/thumbnail-prompt-previews', async ({ world, json }) =>
    promptPreview(world, (await json<Record<string, unknown>>()) as Record<string, unknown>),
  ),
  post('/step-runs/{stepRunId}/generation-runs', 202, async ({ world, params, json }) =>
    createGenerationRuns(
      world,
      params.stepRunId,
      (await json<Record<string, unknown>>()) as Record<string, unknown>,
    ),
  ),
  get('/generation-runs/{generationRunId}', ({ world, params }) =>
    generationRunView(world, params.generationRunId),
  ),
];
