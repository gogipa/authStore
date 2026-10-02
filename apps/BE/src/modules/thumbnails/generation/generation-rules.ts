import { ApiException } from '../../../common/errors/api.exception.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { THUMBNAIL_GENERATION_TIMEOUT_MAX_SECONDS } from '../../settings/schema/settings.types.js';
import {
  isThumbnailFaceOption,
  PROMPT_ADJUSTMENT_MAX,
  type ThumbnailFaceOption,
} from '../prompt/prompt-builder.js';
import { referenceSetSha256 } from '../references/reference-set-hash.js';

/**
 * ⑤ 썸네일 생성 규칙(P3-02 규칙 2·4·5·6) — 순수 함수. 생성 요청(`GenerationRunsService`)·생성 작업(`GenerationWorker`)·
 * 재시작 정리(`GenerationRecovery`)가 쓴다.
 */

export type GenerationTriggerType = 'INITIAL' | 'OWNER_RETRY' | 'AUTO_RETRY';
export type GenerationStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'REFUSED';

/** 검사한 생성 요청(05-2 GenerationRunCreateRequest) */
export interface ParsedGenerationRequest {
  /** 오름차순·중복 없음, 1..N */
  slotNos: number[];
  faceOption: ThumbnailFaceOption;
  /** 오너 조정 문구 원문(비었으면 null — 공백 정리는 `buildPrompt`가 한다) */
  promptAdjustment: string | null;
}

/**
 * 생성 요청 값 검사(규칙 2, 05-2 GenerationRunCreateRequest): `slotNos`는 1..N(N = 설정 `thumbnail.candidateCount`, 기본 2)
 * 안의 중복 없는 정수 1개 이상, `faceOption`은 3종, `promptAdjustment`는 2000자 이하 글(또는 null). 어기면 422
 * VALIDATION_FAILED(fieldErrors — 모두 모은다).
 */
export function parseGenerationRequest(
  body: Readonly<Record<string, unknown>>,
  candidateCount: number,
): ParsedGenerationRequest {
  const errors: FieldError[] = [];
  const slots = body.slotNos;
  if (
    !Array.isArray(slots) ||
    slots.length === 0 ||
    !slots.every(
      (n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= candidateCount,
    ) ||
    new Set(slots).size !== slots.length
  ) {
    errors.push({
      field: 'slotNos',
      message: `후보 번호는 1~${candidateCount} 안의 서로 다른 정수 1개 이상이어야 합니다.`,
      rejectedValue: slots,
    });
  }
  if (!isThumbnailFaceOption(body.faceOption)) {
    errors.push({
      field: 'faceOption',
      message: 'FULL_FACE·CHIN_CROP·HANDS_UPPER_BODY 중 하나여야 합니다.',
      rejectedValue: body.faceOption,
    });
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
  if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
  return {
    slotNos: [...(slots as number[])].sort((a, b) => a - b),
    faceOption: body.faceOption as ThumbnailFaceOption,
    promptAdjustment: typeof adjustment === 'string' ? adjustment : null,
  };
}

/**
 * 회차(규칙 4): 그 번호의 최대 `attempt_no` + 1. 그 번호의 첫 시도면 INITIAL, 아니면 OWNER_RETRY(M1은 AUTO_RETRY를 쓰지 않는다).
 * 번호마다 따로 센다.
 */
export function nextAttempt(
  existing: readonly { slotNo: number; attemptNo: number }[],
  slotNo: number,
): { attemptNo: number; triggerType: Exclude<GenerationTriggerType, 'AUTO_RETRY'> } {
  const max = existing
    .filter((row) => row.slotNo === slotNo)
    .reduce((acc, row) => Math.max(acc, row.attemptNo), 0);
  return { attemptNo: max + 1, triggerType: max === 0 ? 'INITIAL' : 'OWNER_RETRY' };
}

/** 얼굴 노출 한 단계 낮추기(규칙 6, PRD §8.4): 전체 → 턱 아래 크롭 → 손·상반신만 → 더 없음(null) */
export function lowerFaceOption(face: ThumbnailFaceOption): ThumbnailFaceOption | null {
  if (face === 'FULL_FACE') return 'CHIN_CROP';
  if (face === 'CHIN_CROP') return 'HANDS_UPPER_BODY';
  return null;
}

/** 이 시도의 레퍼런스 해시(ERD `generation_run.reference_set_sha256`) = P3-01 `referenceSetSha256`(순서 무관) */
export function generationReferenceSetSha256(refs: readonly { sha256: string }[]): string {
  return referenceSetSha256(refs.map((ref) => ref.sha256));
}

/** 하드 타임아웃 상한(ms, 규칙 5 — 15분) */
export const GENERATION_TIMEOUT_MAX_MS = THUMBNAIL_GENERATION_TIMEOUT_MAX_SECONDS * 1000;

/** 설정 초 → 타임아웃 ms(15분을 넘지 않는다) */
export function generationTimeoutMs(settingSeconds: number): number {
  const seconds = Number.isFinite(settingSeconds) && settingSeconds > 0 ? settingSeconds : 900;
  return Math.min(Math.round(seconds * 1000), GENERATION_TIMEOUT_MAX_MS);
}

/** '15분'·'30초' 같은 시간 글 */
export function durationText(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest === 0 ? `${minutes}분` : `${minutes}분 ${rest}초`;
}

/** 생성 실패 문구(`generation_run.error_message` — 한국어, 비밀정보·로컬 경로 없음, P3-02 Proposed) */
export const GENERATION_ERROR_MESSAGES = {
  timeout: (ms: number) =>
    `이미지 생성이 ${durationText(ms)} 안에 끝나지 않아 멈췄습니다. 다시 만들어 주세요.`,
  empty: '이미지 생성 결과가 비어 있습니다. 다시 만들어 주세요.',
  unsupported: '생성 결과를 이미지로 읽을 수 없습니다(형식 판별 실패). 다시 만들어 주세요.',
  referenceMissing: '레퍼런스 이미지 파일을 찾을 수 없습니다. ⑤를 다시 실행해 원본을 받아 주세요.',
  internal: '이미지를 만들지 못했습니다(앱 오류). 다시 만들어 주세요.',
  appRestart: '앱이 꺼져 이미지 생성이 중단되었습니다. 다시 만들어 주세요.',
} as const;

/** 공급자가 사유 없이 거부했을 때(`ck_gen_refused` — 사유는 필수) */
export const REFUSAL_REASON_UNKNOWN = '이미지 모델이 사유를 밝히지 않고 생성을 거부했습니다.';

/** 저장할 글 길이 상한(공급자 글이 너무 길 때 자른다) */
export const GENERATION_TEXT_MAX = 2000;

export function clipText(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > GENERATION_TEXT_MAX
    ? `${trimmed.slice(0, GENERATION_TEXT_MAX)}…`
    : trimmed;
}

/**
 * 시간 제한 결과. TIMEOUT의 `settled`는 끊긴 `fn`이 실제로 끝났을 때(성공·실패 무관) 풀린다 — 부르는 쪽이 자식 프로세스가
 * 끝날 때까지 다음 작업을 미루는 데 쓴다(`settleWithin`)
 */
export type TimedResult<T> =
  { kind: 'DONE'; value: T } | { kind: 'TIMEOUT'; settled: Promise<void> };

/**
 * 하드 타임아웃 뒤 끊긴 공급자가 끝나기를 기다리는 최대 시간(ms, Proposed). 실행기는 SIGTERM 뒤 여유 5초(`AI_PROCESS_KILL_GRACE_MS`)
 * 가 지나면 SIGKILL한다 — 그보다 조금 길게 둔다. 공급자가 끊김을 무시해도 이보다 오래 기다리지 않는다
 */
export const GENERATION_ABORT_SETTLE_MS = 10_000;

/**
 * `fn`을 `timeoutMs` 안에 끝내게 한다. 넘으면 `signal`을 끊고(공급자가 프로세스·요청을 멈춘다) 곧바로 TIMEOUT을 돌려준다 —
 * 시도 행은 바로 마감할 수 있다. 끊긴 `fn`이 끝나는 것은 TIMEOUT의 `settled`로 따로 기다린다. `fn`의 오류는 그대로 던진다.
 */
export async function runWithTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<TimedResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: 'TIMEOUT' }>((resolve) => {
    timer = setTimeout(() => {
      controller.abort(new Error('image generation timeout'));
      resolve({ kind: 'TIMEOUT' });
    }, timeoutMs);
  });
  const work = fn(controller.signal).then((value) => ({ kind: 'DONE' as const, value }));
  // 시간 제한이 먼저 끝나면 뒤늦은 거절을 삼킨다(처리하지 않은 거절 경고 방지)
  const settled = work.then(
    () => undefined,
    () => undefined,
  );
  try {
    const first = await Promise.race([work, timeout]);
    return first.kind === 'TIMEOUT' ? { kind: 'TIMEOUT', settled } : first;
  } finally {
    clearTimeout(timer);
  }
}

/** `settled`가 풀리거나 `maxMs`가 지날 때까지 기다린다(먼저 오는 쪽). 던지지 않는다 */
export async function settleWithin(settled: Promise<void>, maxMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxMs);
    timer.unref();
  });
  try {
    await Promise.race([settled, limit]);
  } finally {
    clearTimeout(timer);
  }
}
