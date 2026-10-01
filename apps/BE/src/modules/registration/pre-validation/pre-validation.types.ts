import type { StepCode } from '../../step-engine/domain/steps.js';
import type { ApprovalInputs } from '../draft/approval-inputs.js';
import type { RegistrationDraft } from '../draft/registration-draft.builder.js';

/**
 * 사전 검증 항목(P4-02 규칙 2, 05-3 §5.3, PRD §8.7 RG-08). M1 검사 코드는 15개이고 모두 BLOCK이다. 순서는 05-3 §5.3 그대로다.
 * `BRAND_POLICY`·`DIRECT_INPUT_JUDGEMENT`는 M2.
 */
export const PRE_VALIDATION_CHECK_CODES = [
  'REQUIRED_FIELDS',
  'IMAGES',
  'OPTIONS',
  'TAGS',
  'NOTICE_BLOCK',
  'ORIGIN',
  'JAPAN_WORDING',
  'MIN_BLOCK_WORDS',
  'NEGATIVE_MARGIN',
  'EXTRA_CHARGE_WORDING',
  'JUDGEMENT_FRESHNESS',
  'REPRESENTATIVE_IMAGE_SOURCE',
  'STEP_FRESHNESS',
  'CATEGORY',
  'DUPLICATE',
] as const;
export type PreValidationCheckCode = (typeof PRE_VALIDATION_CHECK_CODES)[number];

export type PreValidationSeverity = 'BLOCK' | 'WARN';
export type PreValidationGateCode = 'G1' | 'G2' | 'G3' | 'G4';

/** 항목 한 개(05-2 PreValidationCheck) */
export interface PreValidationCheck {
  checkCode: PreValidationCheckCode;
  passed: boolean;
  severity: PreValidationSeverity;
  /** 실패 사유(한국어). 통과면 null */
  reason: string | null;
  /** 고칠 단계(화면 링크). 없으면 null */
  stepCode: StepCode | null;
  /** 관련 게이트 */
  gateCode: PreValidationGateCode | null;
}

/**
 * restricted-tags 재검증 결과(외부 조회 — `PreValidationService`가 만들어 넣는다). 미리보기(외부 호출 없음)는 null이고, 조회가
 * 실패하면 `ok=false`와 사유(그 항목만 실패, 전체는 200 — 05-2 x-decision §7.5-37)
 */
export type RestrictedTagsLookup =
  { ok: true; restrictedTags: string[] } | { ok: false; reason: string };

/**
 * 검사 함수 하나의 입력(규칙: 검사 함수는 순수 — 외부 조회 결과와 현재 시각은 여기로 받는다. `new Date()`를 직접 부르지 않는다)
 */
export interface PreValidationContext {
  inputs: ApprovalInputs;
  draft: RegistrationDraft;
  now: Date;
  restrictedTags: RestrictedTagsLookup | null;
}

export type PreValidationCheckFn = (ctx: PreValidationContext) => PreValidationCheck;
