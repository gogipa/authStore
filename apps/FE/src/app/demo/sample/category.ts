import { BOARD_OPTIONS, categoryDecision } from '@/test/fixtures/category';
import { DEMO_IDS, STORY } from './story';
import type { Ok, Schema } from './types';

type Option = Schema<'CategoryOption'>;

/** ② 장르가 매핑표에 맞는 리프 후보 2개: 남성 러닝화(예시 여정의 카테고리) · 남성 워킹화(KC 인증 예외 — 고르면 'KC 면제 성인용 확인' 필요) */
export const CATEGORY_OPTIONS: readonly Option[] = BOARD_OPTIONS;

/** 후보 id → 후보(고르기 검사가 쓴다) */
export const categoryOptionOf = (leafCategoryId: string): Option | undefined =>
  CATEGORY_OPTIONS.find((option) => option.leafCategoryId === leafCategoryId);

/** KC 면제로 채우는 요청 조각(BE `KC_EXEMPT_CERTIFICATION_CONTENT`) */
export const KC_EXEMPT_CONTENT = {
  kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
  kcExemptionType: 'OVERSEAS',
} as const;

/** ④ 결정 기록 하나(실행 한 번의 결과) */
export interface CategoryDecisionRec {
  id: number;
  stepRunId: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** 고른 리프(확정 전 null) */
  leafCategoryId: string | null;
  wholeCategoryName: string | null;
  exceptionDecision: 'PASS' | 'KC_EXEMPT' | null;
  kcExemptAdultConfirmedAt: number | null;
  decidedAt: number | null;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** ④ 카테고리 결정: 입력 대기(후보 2개를 보여 줌) 또는 완료(고른 리프 + 예외 판단) */
export function categoryDecisionOf(
  rec: CategoryDecisionRec,
  view: { stepStatus: Schema<'StepStatus'>; isCurrent: boolean; candidateId: number },
): Ok<'/candidates/{candidateId}/category-decision'> {
  const decided = rec.leafCategoryId !== null;
  const kc = rec.exceptionDecision === 'KC_EXEMPT';
  return categoryDecision({
    id: rec.id,
    stepRunId: rec.stepRunId,
    candidateId: view.candidateId,
    version: rec.version,
    stepStatus: view.stepStatus,
    isCurrent: view.isCurrent,
    inputGenreId: 208025,
    inputProductType: null,
    gender: 'MALE',
    genderChangedInRun: false,
    candidateSource: 'MAPPING',
    categoryOptions: CATEGORY_OPTIONS.map((option) => ({ ...option })),
    leafCategoryId: rec.leafCategoryId,
    wholeCategoryName: rec.wholeCategoryName,
    genderPathMatch: decided ? true : null,
    exceptionalCategories: decided ? (kc ? ['KC_CERTIFICATION'] : []) : null,
    exceptionDecision: rec.exceptionDecision,
    kcExemptAdultConfirmedAt: iso(rec.kcExemptAdultConfirmedAt),
    certificationExcludeContent: kc ? { ...KC_EXEMPT_CONTENT } : null,
    decidedAt: iso(rec.decidedAt),
    createdAt: new Date(rec.createdAt).toISOString(),
    updatedAt: new Date(rec.updatedAt).toISOString(),
  });
}

/** 예시 여정(러닝화)이 처음 가리키는 결정 id */
export const FIRST_DECISION_ID = DEMO_IDS.categoryDecision;

/** 예시 여정의 카테고리 경로(이야기 값) */
export const SAMPLE_LEAF = {
  leafCategoryId: STORY.leafCategoryId,
  wholeCategoryName: STORY.wholeCategoryName,
} as const;
