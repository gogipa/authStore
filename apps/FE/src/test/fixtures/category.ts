import type {
  CategoryDecisionDetail,
  CategoryOption,
  CategorySelectionResult,
} from '@/features/category';

const AT = '2026-09-28T05:07:00.000Z';

/** 리프 후보 한 개(05-2 CategoryOption). 기본: 남성 러닝화(막힘·KC 없음) */
export function categoryOption(patch: Partial<CategoryOption> = {}): CategoryOption {
  return {
    leafCategoryId: '50000830',
    wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
    kcExemptionRequired: false,
    blocked: false,
    blockReason: null,
    ...patch,
  };
}

/** 보드 예시 두 줄: 러닝화 · 워킹화(KC 인증 예외) */
export const BOARD_OPTIONS: CategoryOption[] = [
  categoryOption(),
  categoryOption({
    leafCategoryId: '50000831',
    wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
    kcExemptionRequired: true,
  }),
];

/** ④ 결정(05-2 CategoryDecisionDetail). 기본: 매핑표 후보 2개로 입력 대기 */
export function categoryDecision(
  patch: Partial<CategoryDecisionDetail> = {},
): CategoryDecisionDetail {
  return {
    id: 21,
    stepRunId: 120,
    candidateId: 1,
    version: 1,
    stepStatus: 'WAITING_INPUT',
    isCurrent: true,
    inputGenreId: 208025,
    inputProductType: null,
    gender: 'MALE',
    genderChangedInRun: false,
    candidateSource: 'MAPPING',
    categoryOptions: BOARD_OPTIONS,
    leafCategoryId: null,
    wholeCategoryName: null,
    genderPathMatch: null,
    exceptionalCategories: null,
    exceptionDecision: null,
    blockReason: null,
    kcExemptAdultConfirmedAt: null,
    certificationExcludeContent: null,
    decidedAt: null,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

/** 고르기 결과(05-2 CategorySelectionResult) */
export function categorySelectionResult(
  patch: Partial<CategorySelectionResult> = {},
): CategorySelectionResult {
  return {
    categoryDecisionId: 21,
    stepRunId: 120,
    candidateId: 1,
    stepStatus: 'COMPLETED',
    leafCategoryId: '50000830',
    wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
    exceptionDecision: 'PASS',
    kcExemptAdultConfirmedAt: null,
    decidedAt: AT,
    staleDownstreamSteps: [],
    ...patch,
  };
}
