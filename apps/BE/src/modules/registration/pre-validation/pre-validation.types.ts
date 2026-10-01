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

/** 검사 항목 한국어 이름(P4-03 — 422 PRE_VALIDATION_FAILED 문구의 {항목}) */
export const PRE_VALIDATION_CHECK_LABEL: Record<PreValidationCheckCode, string> = {
  REQUIRED_FIELDS: '필수 항목',
  IMAGES: '이미지',
  OPTIONS: '사이즈 옵션',
  TAGS: '태그',
  NOTICE_BLOCK: '구매대행 고지',
  ORIGIN: '원산지',
  JAPAN_WORDING: "'일본산' 표현",
  MIN_BLOCK_WORDS: '최소 차단어',
  NEGATIVE_MARGIN: '역마진',
  EXTRA_CHARGE_WORDING: '추가 청구 표현',
  JUDGEMENT_FRESHNESS: '판정 유효 시간',
  REPRESENTATIVE_IMAGE_SOURCE: '대표이미지 출처',
  STEP_FRESHNESS: '단계 최신성',
  CATEGORY: '카테고리',
  DUPLICATE: '중복',
};

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
 * 판매자관리코드(SELLER_CODE) 커머스API 교차 조회 결과(P4-03 F-AP-36 — `DuplicateService`가 만들어 넣는다). 미리보기(외부 호출
 * 없음)는 null이고, 조회가 실패하면 `ok=false`와 사유(DUPLICATE 항목만 실패, 전체는 200 — restricted-tags와 같은 방식, §7.5-37)
 */
export type SellerCodeLookup =
  | { ok: true; product: { originProductNo: string; channelProductNo: string | null } | null }
  | { ok: false; reason: string };

/**
 * 검사 함수 하나의 입력(규칙: 검사 함수는 순수 — 외부 조회 결과와 현재 시각은 여기로 받는다. `new Date()`를 직접 부르지 않는다)
 */
export interface PreValidationContext {
  inputs: ApprovalInputs;
  draft: RegistrationDraft;
  now: Date;
  restrictedTags: RestrictedTagsLookup | null;
  /** SELLER_CODE 교차 조회(P4-03). 주지 않으면(미리보기) 로컬 기록만 본다 */
  sellerCode?: SellerCodeLookup | null;
}

export type PreValidationCheckFn = (ctx: PreValidationContext) => PreValidationCheck;
