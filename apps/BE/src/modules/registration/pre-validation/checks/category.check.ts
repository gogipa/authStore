import { genderPathMatches } from '../../../../common/rules/category-gender.js';
import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/**
 * `CATEGORY`(F-AP-24, US-22 AC1, PRD §8.7 카테고리 행, P4-02 규칙 13): ④ 현재 버전 결정의 리프가 정해졌고 후보 리프와 같으며, 메타
 * 캐시(`commerce_category` — 리프만 받는다, 사라지지 않음)에 있다. 성별 일치는 ④ 기록(`gender_path_match=true`)과 지금 후보 성별로
 * 다시 본 경로(공용 `genderPathMatches` — ④ 뒤 성별이 바뀐 경우, P2-06)를 둘 다 본다. KC 유형별 처리: `exception_decision`이 `PASS`
 * 이거나 `KC_EXEMPT`(+ 오너 'KC 면제 성인용' 확인·면제 조각)다. `BLOCKED`·결정 없음은 실패다.
 */
export function categoryCheck(ctx: PreValidationContext): PreValidationCheck {
  const { category, candidate, categoryLeaf } = ctx.inputs;
  if (!category || !category.leafCategoryId) {
    return resultOf('CATEGORY', [
      { message: '④ 리프 카테고리가 정해지지 않았습니다', stepCode: 'CATEGORY' },
    ]);
  }
  const problems: CheckProblem[] = [];
  if (candidate.leafCategoryId !== category.leafCategoryId) {
    problems.push({ message: '여정의 카테고리가 ④ 결정과 다릅니다', stepCode: 'CATEGORY' });
  }
  if (!categoryLeaf.exists || categoryLeaf.removed) {
    problems.push({
      message: categoryLeaf.exists
        ? '최신 메타 동기화에서 사라진 카테고리입니다'
        : '리프 카테고리가 아닙니다(메타 캐시에 없음)',
      stepCode: 'CATEGORY',
    });
  }
  const gender = candidate.gender;
  const whole = category.wholeCategoryName ?? '';
  if (category.genderPathMatch !== true || !gender || !genderPathMatches(gender, whole)) {
    problems.push({
      message: `여정 성별(${gender === 'MALE' ? '남성' : gender === 'FEMALE' ? '여성' : '정보 없음'})과 카테고리 경로가 맞지 않습니다`,
      stepCode: 'CATEGORY',
    });
  }
  switch (category.exceptionDecision) {
    case 'PASS':
      break;
    case 'KC_EXEMPT':
      if (!category.kcExemptAdultConfirmedAt || !category.certificationExcludeContent) {
        problems.push({
          message: "'KC 면제 성인용' 확인이 끝나지 않았습니다",
          stepCode: 'CATEGORY',
        });
      }
      break;
    case 'BLOCKED':
      problems.push({ message: '판매할 수 없는 카테고리입니다(차단)', stepCode: 'CATEGORY' });
      break;
    default:
      problems.push({
        message: '카테고리 예외(KC) 판단이 끝나지 않았습니다',
        stepCode: 'CATEGORY',
      });
  }
  return resultOf('CATEGORY', problems);
}
