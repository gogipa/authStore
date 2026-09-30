import { CATEGORY_FIXTURE, LEAF } from '../../../../test/fixtures/category/fixture-data.js';
import {
  BUILTIN_CHILD_CATEGORY_WORDS,
  BUILTIN_EXCLUDED_CATEGORY_WORDS,
} from '../../../common/rules/category-words.js';
import {
  BLOCK_ERROR_CODE,
  judgeCategoryException,
  KC_EXEMPT_CERTIFICATION_CONTENT,
} from './category-exception.js';

const RULES = {
  childCategoryWords: BUILTIN_CHILD_CATEGORY_WORDS,
  excludedCategoryWords: BUILTIN_EXCLUDED_CATEGORY_WORDS,
};

function leaf(id: string) {
  const row = CATEGORY_FIXTURE.find((r) => r.categoryId === id)!;
  return {
    name: row.name,
    wholeCategoryName: row.wholeCategoryName,
    exceptionalCategories: row.exceptionalCategories,
  };
}

describe('category-exception: 예외 판단(F-CA-06~09, P2-06 규칙 8~11)', () => {
  it('예외 없음 → PASS', () => {
    expect(judgeCategoryException(leaf(LEAF.MALE_RUNNING), RULES, 'MALE')).toEqual({
      decision: 'PASS',
      kcExemptionRequired: false,
    });
  });

  it('KC_CERTIFICATION → KC 면제 필요 + 요청 조각 { KC_EXEMPTION_OBJECT, OVERSEAS }', () => {
    const judged = judgeCategoryException(leaf(LEAF.MALE_WALKING_KC), RULES, 'MALE');
    expect(judged).toEqual({
      decision: 'KC_EXEMPT',
      kcExemptionRequired: true,
      certificationExcludeContent: {
        kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
        kcExemptionType: 'OVERSEAS',
      },
    });
    expect(KC_EXEMPT_CERTIFICATION_CONTENT).toEqual({
      kcCertifiedProductExclusionYn: 'KC_EXEMPTION_OBJECT',
      kcExemptionType: 'OVERSEAS',
    });
  });

  it('CHILD_CERTIFICATION → BLOCKED + 사유(409 CATEGORY_CHILD_BLOCKED)', () => {
    const judged = judgeCategoryException(leaf(LEAF.MALE_CHILD_CERTIFICATION), RULES, 'MALE');
    expect(judged).toMatchObject({ decision: 'BLOCKED', blockReason: 'CHILD_CERTIFICATION' });
    if (judged.decision !== 'BLOCKED') return;
    expect(judged.reasonText).toContain('CHILD_CERTIFICATION');
    expect(BLOCK_ERROR_CODE[judged.blockReason]).toBe('CATEGORY_CHILD_BLOCKED');
  });

  it('아동 경로(주니어) → BLOCKED + 사유(걸린 말)', () => {
    const judged = judgeCategoryException(leaf(LEAF.MALE_JUNIOR_CHILD_PATH), RULES, 'MALE');
    expect(judged).toMatchObject({
      decision: 'BLOCKED',
      blockReason: 'CHILD_CATEGORY',
      word: '주니어',
    });
    if (judged.decision === 'BLOCKED') expect(judged.reasonText).toContain("'주니어'");
  });

  it('제외 품목 리프(바퀴) → BLOCKED + CON-08 사유(409 CATEGORY_EXCLUDED_ITEM)', () => {
    const judged = judgeCategoryException(leaf(LEAF.MALE_WHEELED_EXCLUDED), RULES, 'MALE');
    expect(judged).toMatchObject({ decision: 'BLOCKED', blockReason: 'CON08_EXCLUDED' });
    if (judged.decision !== 'BLOCKED') return;
    expect(judged.reasonText).toContain('CON-08');
    expect(BLOCK_ERROR_CODE[judged.blockReason]).toBe('CATEGORY_EXCLUDED_ITEM');
  });

  it('성별 불일치(MALE + 여성신발) → BLOCKED GENDER_MISMATCH. 성별을 주지 않으면(목록 표시) 보지 않는다', () => {
    const judged = judgeCategoryException(leaf(LEAF.FEMALE_RUNNING), RULES, 'MALE');
    expect(judged).toMatchObject({ decision: 'BLOCKED', blockReason: 'GENDER_MISMATCH' });
    if (judged.decision === 'BLOCKED') {
      expect(judged.reasonText).toBe(
        '후보 성별(남성)과 카테고리 경로(여성신발)가 맞지 않습니다(F-CA-06).',
      );
      expect(BLOCK_ERROR_CODE[judged.blockReason]).toBe('CATEGORY_GENDER_MISMATCH');
    }
    expect(judgeCategoryException(leaf(LEAF.FEMALE_RUNNING), RULES).decision).toBe('PASS');
  });

  it('검사 순서: 아동 → 제외 품목 → 성별 → KC(아동이면서 KC·반대 성별이어도 아동으로 막는다)', () => {
    const judged = judgeCategoryException(
      {
        name: '키즈 바퀴운동화',
        wholeCategoryName: '패션잡화>여성신발>키즈 바퀴운동화',
        exceptionalCategories: ['KC_CERTIFICATION'],
      },
      RULES,
      'MALE',
    );
    expect(judged).toMatchObject({
      decision: 'BLOCKED',
      blockReason: 'CHILD_CATEGORY',
      kcExemptionRequired: true,
    });
  });
});
