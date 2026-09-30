import type { CategoryGender } from '../../common/rules/category-gender.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommerceCategoryView } from '../integrations/commerce-meta/commerce-meta-cache.service.js';
import type { CommerceMetaCacheService } from '../integrations/commerce-meta/commerce-meta-cache.service.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import { INPUT_KEYS } from '../step-engine/domain/input-keys.js';
import type { CategorySelectionWrite } from './category-decision.repository.js';
import {
  judgeCategoryException,
  type CategoryBlockReason,
  type CategoryWordRules,
} from './rules/category-exception.js';
import {
  mappedLeafIds,
  type CategoryLeaf,
  type CategoryOptionEntry,
} from './rules/category-options.js';

/**
 * ④ 카테고리 원천 읽기(P2-06): 설정 → 규칙 값, 메타 캐시(P1-08 `CommerceMetaCacheService` — ID는 여기서만 얻는다, RG-03)
 * → 순수 규칙 입력, 조회 응답의 후보 표시(예외는 캐시의 **지금** 값으로 계산 — 규칙 5).
 */

/** 입력 대기 이유(Proposed): 리프 후보가 여럿이거나 KC 확인이 필요하다 → PUT /category-decisions/{id}/selection */
export const CATEGORY_WAITING_REASON = 'CATEGORY_SELECTION_REQUIRED';
/** 입력 대기의 기다리는 입력(화면 이름 '리프 카테고리 선택') */
export const CATEGORY_PENDING_INPUT = INPUT_KEYS.ownerCategorySelection;
/** 고를 수 있는 후보가 하나도 없을 때 실행 실패 코드(Proposed — step_run.error_code, HTTP 오류 아님) */
export const CATEGORY_NO_SELECTABLE_OPTION = 'CATEGORY_NO_SELECTABLE_OPTION';
export const CATEGORY_NO_SELECTABLE_MESSAGE =
  '고를 수 있는 네이버 리프 카테고리가 없습니다. 시스템 상태에서 메타데이터를 다시 동기화하거나 설정의 매핑표를 확인한 뒤 ④를 다시 실행해 주세요.';

/** 조회 응답의 후보 한 개(05-2 CategoryOption + blockReason, P2-06 Proposed) */
export interface CategoryOptionView extends CategoryOptionEntry {
  kcExemptionRequired: boolean;
  blocked: boolean;
  /** 막힌 이유(없으면 null). REMOVED = 메타 캐시에서 사라졌거나 없는 리프 */
  blockReason: CategoryBlockReason | 'REMOVED' | null;
}

/** 설정 → 아동·제외 품목 카테고리 말 */
export function categoryWordRulesOf(settings: Readonly<AppSettings>): CategoryWordRules {
  return {
    childCategoryWords: settings.safety.childCategoryWords,
    excludedCategoryWords: settings.safety.excludedCategoryWords,
  };
}

export function toCategoryLeaf(view: CommerceCategoryView): CategoryLeaf {
  return {
    categoryId: view.categoryId,
    name: view.name,
    wholeCategoryName: view.wholeCategoryName,
    exceptionalCategories: view.exceptionalCategories,
    removedAt: view.removedAt,
  };
}

/** 후보 뽑기에 넣을 캐시 리프: 그 성별 경로의 리프 전체 + 매핑표가 가리키는 리프(다른 성별·사라진 행은 규칙이 거른다) */
export async function leavesForOptions(
  cache: CommerceMetaCacheService,
  input: {
    gender: CategoryGender;
    genreIdPath: readonly number[];
    productType: string | null;
    settings: Readonly<AppSettings>;
  },
): Promise<CategoryLeaf[]> {
  const mapped = mappedLeafIds(
    input.settings.category.leafMapping,
    input.genreIdPath,
    input.productType,
  );
  const [shoeLeaves, mappedLeaves] = await Promise.all([
    cache.listShoeLeaves(input.gender),
    cache.findCategories(mapped?.leafCategoryIds ?? []),
  ]);
  return [...shoeLeaves, ...mappedLeaves].map(toCategoryLeaf);
}

/** 조회 응답 후보 표시(규칙 5): 캐시의 지금 예외 유형·경로로 KC 필요·막힘을 계산한다 */
export function optionViewOf(
  entry: CategoryOptionEntry,
  leaf: CommerceCategoryView | null,
  rules: CategoryWordRules,
  gender: CategoryGender | null,
): CategoryOptionView {
  if (!leaf || leaf.removedAt !== null) {
    return { ...entry, kcExemptionRequired: false, blocked: true, blockReason: 'REMOVED' };
  }
  const judged = judgeCategoryException(leaf, rules, gender);
  if (judged.decision === 'BLOCKED') {
    return {
      ...entry,
      kcExemptionRequired: judged.kcExemptionRequired,
      blocked: true,
      blockReason: judged.blockReason,
    };
  }
  return {
    ...entry,
    kcExemptionRequired: judged.kcExemptionRequired,
    blocked: false,
    blockReason: null,
  };
}

/**
 * 결정에 남길 예외 유형 원문(값 복사, ERD `category_decision.exceptional_categories`): 카테고리 상세 문서(P1-08
 * CATEGORY_DETAIL)의 `exceptionalCategories` 원문, 문서가 없으면 캐시 행의 예외 유형 목록
 */
export async function exceptionalCategoriesRaw(
  cache: CommerceMetaCacheService,
  leaf: CommerceCategoryView,
): Promise<Prisma.InputJsonValue> {
  const doc = await cache.getDocument('CATEGORY_DETAIL', leaf.categoryId);
  const payload = doc?.payload as { exceptionalCategories?: unknown } | null | undefined;
  const raw = payload?.exceptionalCategories;
  if (raw !== undefined && raw !== null) return raw;
  return [...leaf.exceptionalCategories];
}

/** 통과한 판단(PASS·KC_EXEMPT) → 결정 쓰기 값 */
export function selectionWriteOf(input: {
  leaf: CommerceCategoryView;
  exceptionalCategories: Prisma.InputJsonValue;
  decision: 'PASS' | 'KC_EXEMPT';
  certificationExcludeContent: Prisma.InputJsonObject | null;
  now: Date;
}): CategorySelectionWrite {
  return {
    leafCategoryId: input.leaf.categoryId,
    wholeCategoryName: input.leaf.wholeCategoryName,
    genderPathMatch: true,
    exceptionalCategories: input.exceptionalCategories,
    exceptionDecision: input.decision,
    kcExemptAdultConfirmedAt: input.decision === 'KC_EXEMPT' ? input.now : null,
    certificationExcludeContent:
      input.decision === 'KC_EXEMPT' ? input.certificationExcludeContent : null,
    decidedAt: input.now,
  };
}
