import { categoryPathGender, genderPathMatches, normalizeCategoryPath } from './category-gender.js';
import { findCategoryWord } from './category-words.js';

describe('genderPathMatches(F-CA-06·F-AP-24 공용 규칙, P2-06)', () => {
  it('MALE + 패션잡화>남성신발>운동화>러닝화 → true', () => {
    expect(genderPathMatches('MALE', '패션잡화>남성신발>운동화>러닝화')).toBe(true);
  });

  it('MALE + 패션잡화>여성신발>… → false', () => {
    expect(genderPathMatches('MALE', '패션잡화>여성신발>운동화>러닝화')).toBe(false);
  });

  it('FEMALE + 여성신발 → true, 성별 신발 경로 밖·성별 없음·경로 없음 → false', () => {
    expect(genderPathMatches('FEMALE', '패션잡화>여성신발>운동화>워킹화')).toBe(true);
    expect(genderPathMatches('FEMALE', '패션잡화>여성가방>숄더백')).toBe(false);
    expect(genderPathMatches(null, '패션잡화>남성신발>운동화>러닝화')).toBe(false);
    expect(genderPathMatches('MALE', null)).toBe(false);
  });

  it('`>` 앞뒤 공백은 같은 경로로 본다', () => {
    expect(normalizeCategoryPath(' 패션잡화 > 남성신발 > 운동화 ')).toBe(
      '패션잡화>남성신발>운동화',
    );
    expect(categoryPathGender('패션잡화 > 남성신발 > 운동화 > 러닝화')).toBe('MALE');
    expect(categoryPathGender('패션잡화>남성의류>셔츠')).toBeNull();
  });

  it('카테고리 말 찾기: NFKC·대소문자를 맞추고 목록 순서로 첫 말', () => {
    expect(findCategoryWord(['패션잡화>남성신발>운동화>주니어러닝화'], ['아동', '주니어'])).toBe(
      '주니어',
    );
    expect(findCategoryWord(['Heelys 운동화'], ['heelys'])).toBe('heelys');
    expect(findCategoryWord(['러닝화', null], ['아동', ''])).toBeNull();
  });
});
