/**
 * category 도메인(OpenAPI 태그 `category`)의 공개 API. 밖에서는 `@/features/category`로만 가져온다.
 * P2-06: ④ 카테고리 결정 조회(getCategoryDecision)·리프 고르기(selectCategoryDecisionLeaf) 훅, 표시 규칙(model/category),
 * '리프 카테고리' 패널(`CategoryPanel`)·'성별 재확인'(`GenderRecheck` — step-engine 성별 훅을 부른다).
 */
export { CATEGORY_TAG_KEY, categoryKeys } from './api/queryKeys';
export { useCategoryDecisionQuery, useSelectCategoryLeafMutation } from './api/categoryDecision';
export {
  blockReasonText,
  CATEGORY_BLOCK_ERROR_CODES,
  categoryChecks,
  categoryPathGender,
  formatCategoryPath,
  GENDER_CHANGED_AFTER_DECISION,
  GENDER_LABEL,
  GENDER_PATH_ALL_CAPTION,
  GENDER_RECHECK_DISABLED_REASON,
  GENDER_RECHECK_NOTE,
  GENDER_SHOE_LABEL,
  isChildBlocked,
  KC_CONFIRM_REASON,
  KC_FILLED_TEXT,
  KC_NOT_NEEDED_TEXT,
  KC_WILL_FILL_TEXT,
  NOT_WAITING_REASON,
  PICK_LEAF_REASON,
  selectDisabledReason,
} from './model/category';
export type {
  CategoryChecks,
  CategoryDecisionDetail,
  CategoryGender,
  CategoryOption,
  CategoryOptionBlockReason,
  CategorySelectionRequest,
  CategorySelectionResult,
} from './model/category';
export { CategoryPanel } from './components/CategoryPanel/CategoryPanel';
export type { CategoryPanelProps } from './components/CategoryPanel/CategoryPanel';
export { GenderRecheck } from './components/GenderRecheck/GenderRecheck';
export type { GenderRecheckProps } from './components/GenderRecheck/GenderRecheck';
