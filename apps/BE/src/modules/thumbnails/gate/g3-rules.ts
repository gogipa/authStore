import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import type { GateBlocker } from '../../step-engine/contracts/gate-basis.js';
import { GENERATION_JOB } from '../thumbnail-sources.js';
import { G3_CHECKLIST_KEYS, type G3ChecklistKey } from '../selection/thumbnail-selection.js';

/**
 * G3 썸네일 선택 검사(P3-02 규칙 9~11, F-TH-14~17, 05-1 표 C) — 순수 함수. G3 공급자(`ThumbnailG3GateBasis.blockers`)가
 * DB에서 모은 사실로 부른다. 막힌 이유 순서(Proposed): 체크리스트 422 CHECKLIST_INCOMPLETE → 추가 9장 초과 422
 * IMAGE_COUNT_INVALID → 없는 이미지 404 IMAGE_ASSET_NOT_FOUND → 쓸 수 없는 이미지 422 IMAGE_NOT_ALLOWED → '같은 상품·색상' 확인
 * 없음 422 SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED → 생성 중 409 ALREADY_IN_PROGRESS(details.job=GENERATION). 통과 API는 첫
 * 이유를 던진다(`GateService`). 게이트 목록(본문 없음)은 생성 중만 본다.
 */

/** 추가이미지 최대 장수(RG-08 '추가 9장 이하', `ck_thumb_sel_img_order`) */
export const ADDITIONAL_IMAGE_MAX = 9;

/** G3 선택본으로 쓸 수 없는 이미지 이유(IMAGE_NOT_ALLOWED `details.reason`·`{이유}`, P3-02 Proposed 문구) */
export const G3_IMAGE_NOT_ALLOWED_REASONS = {
  NOT_GENERATED: '라쿠텐 원본·참조 전용 이미지는 대표·추가이미지로 고를 수 없습니다',
  OTHER_RUN: '이 ⑤ 버전에서 만든 AI 생성 후보가 아닙니다',
} as const;
export type G3ImageNotAllowedReason = keyof typeof G3_IMAGE_NOT_ALLOWED_REASONS;

/** 통과 요청 본문 중 G3 값(모양은 step-engine `parseGatePassBody`가 이미 봤다) */
export interface G3PassBody {
  basisStepRunId: number;
  representativeImageAssetId: number;
  additionalImageAssetIds: number[];
  checklist: Record<string, unknown>;
  sameProductColorConfirmed?: boolean;
}

/** 본문 → G3 값 */
export function g3BodyOf(body: unknown): G3PassBody {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    basisStepRunId: b.basisStepRunId as number,
    representativeImageAssetId: b.representativeImageAssetId as number,
    additionalImageAssetIds: (b.additionalImageAssetIds as number[] | undefined) ?? [],
    checklist: (b.checklist ?? {}) as Record<string, unknown>,
    sameProductColorConfirmed: b.sameProductColorConfirmed === true,
  };
}

/**
 * 체크리스트 모양(05-2 GateThumbnailChecklist `additionalProperties: false`, 값 boolean): 모르는 키·boolean 아닌 값은 422
 * VALIDATION_FAILED(fieldErrors `checklist.<키>`). 빠진 키·false는 모양이 아니라 CHECKLIST_INCOMPLETE다.
 */
export function assertChecklistShape(checklist: Record<string, unknown>): void {
  const errors: FieldError[] = [];
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
  if (errors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors: errors });
}

/** 체크하지 않은(빠졌거나 false인) 항목(보드 순서) */
export function uncheckedKeys(checklist: Record<string, unknown>): G3ChecklistKey[] {
  return G3_CHECKLIST_KEYS.filter((key) => checklist[key] !== true);
}

/** 고른 이미지 한 장의 사실(DB) */
export interface G3ImageFact {
  imageAssetId: number;
  /** image_asset 행이 없으면 null */
  kind: string | null;
  /** 이 이미지를 결과로 낸 SUCCEEDED 생성 시도가 **이 ⑤ 버전(생성 시도를 가진 버전)**의 것인가 */
  fromThisRun: boolean;
}

export interface G3CheckInput {
  body: G3PassBody;
  /** 고른 이미지(대표 + 추가)의 사실 */
  images: readonly G3ImageFact[];
  /** 레퍼런스에 앵커 키가 다르거나 색상 코드를 모르는 것이 있는가(`needsSameProductColorConfirmation`) */
  sameProductColorRequired: boolean;
  /** 이 ⑤ 버전에서 생성 중인 시도 수 */
  runningGenerations: number;
}

function imageNotAllowed(imageAssetId: number, reason: G3ImageNotAllowedReason): GateBlocker {
  return {
    code: 'IMAGE_NOT_ALLOWED',
    message: formatErrorMessage('IMAGE_NOT_ALLOWED', {
      이유: G3_IMAGE_NOT_ALLOWED_REASONS[reason],
    }),
    details: { imageAssetId, reason },
  };
}

/** 생성 중(409 ALREADY_IN_PROGRESS, details.job=GENERATION) */
export function generationInProgressBlocker(running: number): GateBlocker {
  return {
    code: 'ALREADY_IN_PROGRESS',
    message: formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: '썸네일 생성' }),
    details: { job: GENERATION_JOB, runningCount: running },
  };
}

/** G3 선택 검사 → 막힌 이유(순서대로, 없으면 빈 배열) */
export function checkG3Selection(input: G3CheckInput): GateBlocker[] {
  const out: GateBlocker[] = [];
  const unchecked = uncheckedKeys(input.body.checklist);
  if (unchecked.length > 0) {
    out.push({ code: 'CHECKLIST_INCOMPLETE', details: { uncheckedKeys: unchecked } });
  }
  const extra = input.body.additionalImageAssetIds.length;
  if (extra > ADDITIONAL_IMAGE_MAX) {
    out.push({
      code: 'IMAGE_COUNT_INVALID',
      details: { additionalCount: extra, max: ADDITIONAL_IMAGE_MAX },
    });
  }
  for (const image of input.images) {
    if (image.kind === null) {
      out.push({ code: 'IMAGE_ASSET_NOT_FOUND', details: { imageAssetId: image.imageAssetId } });
    }
  }
  for (const image of input.images) {
    if (image.kind === null) continue;
    if (image.kind !== 'GENERATED') out.push(imageNotAllowed(image.imageAssetId, 'NOT_GENERATED'));
    else if (!image.fromThisRun) out.push(imageNotAllowed(image.imageAssetId, 'OTHER_RUN'));
  }
  if (input.sameProductColorRequired && input.body.sameProductColorConfirmed !== true) {
    out.push({ code: 'SAME_PRODUCT_COLOR_CONFIRMATION_REQUIRED' });
  }
  if (input.runningGenerations > 0) out.push(generationInProgressBlocker(input.runningGenerations));
  return out;
}
