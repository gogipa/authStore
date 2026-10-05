import type { components } from '@/shared/api/schema';

export type CategoryDecisionDetail = components['schemas']['CategoryDecisionDetail'];
export type CategoryOption = components['schemas']['CategoryOption'];
export type CategoryOptionBlockReason = NonNullable<CategoryOption['blockReason']>;
export type CategorySelectionRequest = components['schemas']['CategorySelectionRequest'];
export type CategorySelectionResult = components['schemas']['CategorySelectionResult'];
export type CategoryGender = CategoryDecisionDetail['gender'];

/**
 * ④ 카테고리 화면(SCR-04 `#category`) 표시 규칙(P2-06). 막힘·KC 판단은 서버가 한다(조회 응답 `blocked`·`blockReason`·
 * `kcExemptionRequired`) — 여기서는 보드 문구로 바꾸고 고르기 단추의 켜짐을 정한다.
 */

/** 성별 → 신발 경로 이름(보드 '남성신발 전체 목록에서 고르기') */
export const GENDER_SHOE_LABEL: Record<CategoryGender, string> = {
  MALE: '남성신발',
  FEMALE: '여성신발',
};

export const GENDER_LABEL: Record<CategoryGender, string> = { MALE: '남성', FEMALE: '여성' };

/** 성별 재확인 안내(보드 그대로) */
export const GENDER_RECHECK_NOTE =
  '바꾸면 카테고리 후보를 다시 뽑고 ③·⑥-3·⑦을 다시 실행해야 합니다.';

/** 전체 목록 단추 옆 캡션(보드 그대로) */
export const GENDER_PATH_ALL_CAPTION = '장르 없는 URL 여정용';

/** 'KC 면제 성인용 확인' 캡션: 확정 뒤(보드) · 확정 전 · KC 예외가 아닌 리프 */
export const KC_FILLED_TEXT = 'KC 면제(해외 구매대행)로 채웠습니다';
export const KC_WILL_FILL_TEXT = '체크하면 KC 면제(해외 구매대행)로 채웁니다';
export const KC_NOT_NEEDED_TEXT = 'KC 인증 예외가 없는 카테고리입니다';

/** 고르기 단추 꺼진 이유 */
export const PICK_LEAF_REASON = '리프 카테고리를 골라 주세요.';
export const KC_CONFIRM_REASON =
  "KC 인증 예외 카테고리입니다. 'KC 면제 성인용 확인'을 체크해 주세요.";
export const NOT_WAITING_REASON =
  '④가 입력 대기일 때 고를 수 있습니다. 다시 실행하면 새로 고릅니다.';

/** 성별 재확인 꺼진 이유(④ 입력 대기가 아닐 때) */
export const GENDER_RECHECK_DISABLED_REASON =
  '④가 입력 대기일 때 바꿀 수 있습니다. ④를 다시 실행한 뒤 바꿔 주세요.';

/** 완료된 ④의 성별과 여정 성별이 다를 때 경고 띠(Proposed) */
export const GENDER_CHANGED_AFTER_DECISION =
  '여정 성별이 바뀌어 고른 카테고리와 맞지 않을 수 있습니다. ④를 다시 실행해 카테고리를 다시 골라 주세요.';

/** 전체 경로 표시: `패션잡화>남성신발>운동화>러닝화` → `패션잡화 > 남성신발 > 운동화 > 러닝화`(보드) */
export function formatCategoryPath(wholeCategoryName: string): string {
  return wholeCategoryName
    .split('>')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' > ');
}

/** 막힌 후보 옆 이유 글(DisabledReason) */
export function blockReasonText(reason: CategoryOptionBlockReason): string {
  switch (reason) {
    case 'CHILD_CERTIFICATION':
      return '어린이 인증 카테고리라 고를 수 없습니다.';
    case 'CHILD_CATEGORY':
      return '아동 카테고리라 고를 수 없습니다.';
    case 'CON08_EXCLUDED':
      return '판매 제외 품목(바퀴 달린 운동화·고령자용 신발) 카테고리라 고를 수 없습니다.';
    case 'GENDER_MISMATCH':
      return '여정 성별과 카테고리(남성·여성)가 맞지 않습니다.';
    case 'REMOVED':
      return '네이버 카테고리 목록에서 사라졌습니다. 메타데이터를 다시 동기화해 주세요.';
  }
}

/** 카테고리 경로의 신발 성별(성별 신발 경로가 아니면 null) — BE common/rules/category-gender.ts와 같은 규칙 */
export function categoryPathGender(wholeCategoryName: string): CategoryGender | null {
  const path = wholeCategoryName.replace(/\s*>\s*/g, '>').trim();
  if (path.startsWith('패션잡화>남성신발>')) return 'MALE';
  if (path.startsWith('패션잡화>여성신발>')) return 'FEMALE';
  return null;
}

/** 아동으로 막힌 후보인가 */
export function isChildBlocked(option: CategoryOption): boolean {
  return option.blockReason === 'CHILD_CERTIFICATION' || option.blockReason === 'CHILD_CATEGORY';
}

/** 확인 줄 3개(보드: '성별·카테고리 일치' · 'KC 면제 성인용 확인' · '아동 카테고리 아님')의 지금 값 */
export interface CategoryChecks {
  /** 성별·카테고리 일치(고른 리프가 없으면 null) */
  genderMatch: boolean | null;
  /** 아동 카테고리 아님(고른 리프가 없으면 null) */
  notChild: boolean | null;
  /** 고른 리프가 KC 인증 예외인가 */
  kcRequired: boolean;
}

export function categoryChecks(
  gender: CategoryGender,
  option: CategoryOption | null,
): CategoryChecks {
  if (!option) return { genderMatch: null, notChild: null, kcRequired: false };
  return {
    genderMatch:
      option.blockReason !== 'GENDER_MISMATCH' &&
      categoryPathGender(option.wholeCategoryName) === gender,
    notChild: !isChildBlocked(option),
    kcRequired: option.kcExemptionRequired,
  };
}

/**
 * 고르기 단추 꺼진 이유(없으면 켜짐): 입력 대기 아님 → 고른 리프 없음 → 막힌 리프 → KC 확인 없음 → 밖에서 막힘(잠금 등)
 */
export function selectDisabledReason(input: {
  waiting: boolean;
  option: CategoryOption | null;
  kcConfirmed: boolean;
  blockedReason?: string | null;
}): string | null {
  if (!input.waiting) return NOT_WAITING_REASON;
  if (input.blockedReason) return input.blockedReason;
  if (!input.option) return PICK_LEAF_REASON;
  if (input.option.blocked && input.option.blockReason) {
    return blockReasonText(input.option.blockReason);
  }
  if (input.option.kcExemptionRequired && !input.kcConfirmed) return KC_CONFIRM_REASON;
  return null;
}

/** 고르기 오류 가운데 막힘 띠(Banner blocked)로 보일 코드(409 — 05-3 문구 그대로) */
export const CATEGORY_BLOCK_ERROR_CODES: readonly string[] = [
  'CATEGORY_GENDER_MISMATCH',
  'CATEGORY_CHILD_BLOCKED',
  'CATEGORY_EXCLUDED_ITEM',
  'KC_EXEMPT_CONFIRMATION_REQUIRED',
  'STEP_RUN_NOT_WAITING_INPUT',
  'CANDIDATE_LOCKED',
  'CANDIDATE_EXCLUDED',
  'CATEGORY_NOT_IN_OPTIONS',
];
