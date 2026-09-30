import {
  categoryPathGender,
  genderPathMatches,
  type CategoryGender,
} from '../../../common/rules/category-gender.js';
import { findCategoryWord } from '../../../common/rules/category-words.js';

/**
 * 카테고리 예외 판단(F-CA-06·07·08·09, PRD §8.7 카테고리 확정 3, P2-06 규칙 8~11). 순수 함수만 둔다.
 * 예외 유형(카테고리 상세 `exceptionalCategories`)·경로·이름·후보 성별 → `PASS`·`KC_EXEMPT`·`BLOCKED` + 사유.
 *
 * 검사 순서(Proposed — 고르기 API 오류 순서 규칙 7과 같다): 아동(어린이 인증·아동 카테고리 말) → 판매 제외 품목(CON-08 말)
 * → 성별 불일치 → KC 인증(성인 카테고리의 KC_CERTIFICATION — 'KC 면제 성인용 확인'이 있어야 통과) → 통과.
 */

/** 어린이 인증 예외 유형(R04 C2, F-CA-07). 있으면 무조건 막는다 */
export const CHILD_CERTIFICATION = 'CHILD_CERTIFICATION';
/** KC 인증 예외 유형(F-CA-08). 성인 카테고리면 'KC 면제 성인용 확인'으로만 통과 */
export const KC_CERTIFICATION = 'KC_CERTIFICATION';

/**
 * KC 면제로 채우는 요청 조각 `certificationTargetExcludeContent`(PRD §8.7 3, ERD `category_decision.certification_exclude_content`
 * — ck_cd_kc_exempt). 등록(P4-03)이 이 값을 그대로 요청 JSON에 넣는다.
 */
export const KC_EXEMPT_CERTIFICATION_CONTENT = {
  kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
  kcExemptionType: 'OVERSEAS',
} as const;
export type KcExemptCertificationContent = typeof KC_EXEMPT_CERTIFICATION_CONTENT;

/** 막힌 이유(05-2 CategoryOption.blockReason, P2-06 Proposed). 앞 셋은 P1-08 메타 캐시 `CategoryBlockReason`과 같은 이름 */
export type CategoryBlockReason =
  'CHILD_CERTIFICATION' | 'CHILD_CATEGORY' | 'CON08_EXCLUDED' | 'GENDER_MISMATCH';

/** 고르기를 막을 때의 409 코드(05-3) */
export const BLOCK_ERROR_CODE = {
  CHILD_CERTIFICATION: 'CATEGORY_CHILD_BLOCKED',
  CHILD_CATEGORY: 'CATEGORY_CHILD_BLOCKED',
  CON08_EXCLUDED: 'CATEGORY_EXCLUDED_ITEM',
  GENDER_MISMATCH: 'CATEGORY_GENDER_MISMATCH',
} as const satisfies Record<CategoryBlockReason, string>;

/** 판단할 카테고리 한 개(메타 캐시 값) */
export interface CategoryForException {
  name?: string | null;
  wholeCategoryName: string;
  exceptionalCategories: readonly string[];
}

/** 아동·제외 품목 말(설정 `safety.childCategoryWords`·`excludedCategoryWords`) */
export interface CategoryWordRules {
  childCategoryWords: readonly string[];
  excludedCategoryWords: readonly string[];
}

export type CategoryException =
  | { decision: 'PASS'; kcExemptionRequired: false }
  | {
      decision: 'KC_EXEMPT';
      kcExemptionRequired: true;
      certificationExcludeContent: KcExemptCertificationContent;
    }
  | {
      decision: 'BLOCKED';
      blockReason: CategoryBlockReason;
      /** `category_decision.block_reason`·감사 기록에 남기는 글(500자 이하) */
      reasonText: string;
      /** 걸린 말(아동·제외 품목 말일 때) */
      word: string | null;
      kcExemptionRequired: boolean;
    };

const GENDER_LABEL: Record<CategoryGender, string> = { MALE: '남성', FEMALE: '여성' };

/** 아동 카테고리인가(어린이 인증 예외 유형이거나 이름·경로에 아동 카테고리 말) — 아니면 null */
export function childCategoryReason(
  category: CategoryForException,
  childCategoryWords: readonly string[],
): { blockReason: 'CHILD_CERTIFICATION' | 'CHILD_CATEGORY'; word: string | null } | null {
  if (category.exceptionalCategories.includes(CHILD_CERTIFICATION)) {
    return { blockReason: 'CHILD_CERTIFICATION', word: null };
  }
  const word = findCategoryWord([category.wholeCategoryName, category.name], childCategoryWords);
  return word ? { blockReason: 'CHILD_CATEGORY', word } : null;
}

/** 막힌 이유 글(`block_reason`, 감사 기록 detail.reason) */
export function blockReasonText(
  blockReason: CategoryBlockReason,
  input: { word?: string | null; gender?: CategoryGender | null; wholeCategoryName?: string },
): string {
  switch (blockReason) {
    case 'CHILD_CERTIFICATION':
      return '어린이 인증(CHILD_CERTIFICATION) 카테고리라 고를 수 없습니다(F-CA-07).';
    case 'CHILD_CATEGORY':
      return `아동 카테고리('${input.word ?? ''}')라 고를 수 없습니다(F-CA-07).`;
    case 'CON08_EXCLUDED':
      return `판매 제외 품목(CON-08) 카테고리('${input.word ?? ''}')라 고를 수 없습니다(F-CA-09).`;
    case 'GENDER_MISMATCH': {
      const pathGender = input.wholeCategoryName
        ? categoryPathGender(input.wholeCategoryName)
        : null;
      const candidate = input.gender ? GENDER_LABEL[input.gender] : '없음';
      const path = pathGender ? `${GENDER_LABEL[pathGender]}신발` : '성별 신발 경로 아님';
      return `후보 성별(${candidate})과 카테고리 경로(${path})가 맞지 않습니다(F-CA-06).`;
    }
  }
}

/**
 * 예외 판단(규칙 8~11). `gender`를 주면 성별 경로 일치도 본다(고르기 검사), 주지 않으면 보지 않는다(목록 표시).
 * 막히면 `BLOCKED` + 사유, KC 인증이면 `KC_EXEMPT` + 요청 조각(확인 체크는 부르는 쪽이 본다), 그 밖은 `PASS`.
 */
export function judgeCategoryException(
  category: CategoryForException,
  rules: CategoryWordRules,
  gender?: CategoryGender | null,
): CategoryException {
  const kcExemptionRequired = category.exceptionalCategories.includes(KC_CERTIFICATION);
  const child = childCategoryReason(category, rules.childCategoryWords);
  if (child) {
    return {
      decision: 'BLOCKED',
      blockReason: child.blockReason,
      reasonText: blockReasonText(child.blockReason, { word: child.word }),
      word: child.word,
      kcExemptionRequired,
    };
  }
  const excluded = findCategoryWord(
    [category.wholeCategoryName, category.name],
    rules.excludedCategoryWords,
  );
  if (excluded) {
    return {
      decision: 'BLOCKED',
      blockReason: 'CON08_EXCLUDED',
      reasonText: blockReasonText('CON08_EXCLUDED', { word: excluded }),
      word: excluded,
      kcExemptionRequired,
    };
  }
  if (gender !== undefined && !genderPathMatches(gender, category.wholeCategoryName)) {
    return {
      decision: 'BLOCKED',
      blockReason: 'GENDER_MISMATCH',
      reasonText: blockReasonText('GENDER_MISMATCH', {
        gender: gender ?? null,
        wholeCategoryName: category.wholeCategoryName,
      }),
      word: null,
      kcExemptionRequired,
    };
  }
  if (kcExemptionRequired) {
    return {
      decision: 'KC_EXEMPT',
      kcExemptionRequired: true,
      certificationExcludeContent: KC_EXEMPT_CERTIFICATION_CONTENT,
    };
  }
  return { decision: 'PASS', kcExemptionRequired: false };
}
