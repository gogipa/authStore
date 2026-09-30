import {
  CATEGORY_MAPPING,
  fixtureLeaves,
  LEAF,
  RUNNING_GENRE_ID,
} from '../../../../test/fixtures/category/fixture-data.js';
import { BUILTIN_CHILD_CATEGORY_WORDS } from '../../../common/rules/category-words.js';
import {
  categoryOptionsOf,
  mappedLeafIds,
  parseCategoryOptions,
  type CategoryOptionsInput,
} from './category-options.js';

const RUNNING_PATH = [558885, 110983, RUNNING_GENRE_ID];

function input(patch: Partial<CategoryOptionsInput>): CategoryOptionsInput {
  return {
    gender: 'MALE',
    genreIdPath: RUNNING_PATH,
    productType: null,
    mapping: CATEGORY_MAPPING,
    leaves: fixtureLeaves(),
    childCategoryWords: BUILTIN_CHILD_CATEGORY_WORDS,
    ...patch,
  };
}

const ids = (result: ReturnType<typeof categoryOptionsOf>) =>
  result.options.map((o) => o.leafCategoryId);

describe('category-options: 리프 후보 뽑기(F-CA-02·04, P2-06 규칙 3~5)', () => {
  it('러닝화 장르 · MALE → MAPPING, 남성 경로 리프 2개만(여성·아동·removed_at·신발 밖 행 없음)', () => {
    const result = categoryOptionsOf(input({}));
    expect(result.candidateSource).toBe('MAPPING');
    expect(result.mappedGenreId).toBe(RUNNING_GENRE_ID);
    expect(result.options).toEqual([
      { leafCategoryId: LEAF.MALE_RUNNING, wholeCategoryName: '패션잡화>남성신발>운동화>러닝화' },
      {
        leafCategoryId: LEAF.MALE_WALKING_KC,
        wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
      },
    ]);
  });

  it('러닝화 장르 · FEMALE → MAPPING, 여성 경로 리프 2개', () => {
    const result = categoryOptionsOf(input({ gender: 'FEMALE' }));
    expect(result.candidateSource).toBe('MAPPING');
    expect(ids(result)).toEqual([LEAF.FEMALE_RUNNING, LEAF.FEMALE_WALKING]);
  });

  it('장르 없음 · FEMALE → GENDER_PATH_ALL, 여성 경로 신발 리프 전체(아동 경로 없음, 전체 경로 순)', () => {
    const result = categoryOptionsOf(input({ gender: 'FEMALE', genreIdPath: [] }));
    expect(result.candidateSource).toBe('GENDER_PATH_ALL');
    expect(result.mappedGenreId).toBeNull();
    expect(ids(result)).toEqual([LEAF.FEMALE_RUNNING, LEAF.FEMALE_SNEAKERS, LEAF.FEMALE_WALKING]);
    expect(ids(result)).not.toContain(LEAF.FEMALE_KIDS_CHILD_PATH);
  });

  it('매핑표에 없는 장르 → GENDER_PATH_ALL(남성: 아동 경로·어린이 인증·사라진 리프 없음, CON-08 리프는 남아 조회 때 막힘)', () => {
    const result = categoryOptionsOf(input({ genreIdPath: [558885, 999999] }));
    expect(result.candidateSource).toBe('GENDER_PATH_ALL');
    expect(ids(result).sort()).toEqual(
      [
        LEAF.MALE_RUNNING,
        LEAF.MALE_WALKING_KC,
        LEAF.MALE_SNEAKERS,
        LEAF.MALE_WHEELED_EXCLUDED,
      ].sort(),
    );
    expect(ids(result)).not.toContain(LEAF.MALE_JUNIOR_CHILD_PATH);
    expect(ids(result)).not.toContain(LEAF.MALE_CHILD_CERTIFICATION);
    expect(ids(result)).not.toContain(LEAF.MALE_REMOVED);
  });

  it('매핑 리프가 캐시에서 모두 사라졌으면 성별 경로 전체로 물러난다(Proposed)', () => {
    const leaves = fixtureLeaves().map((leaf) =>
      [LEAF.MALE_RUNNING, LEAF.MALE_WALKING_KC].includes(leaf.categoryId as never)
        ? { ...leaf, removedAt: new Date('2026-09-29T00:00:00Z') }
        : leaf,
    );
    const result = categoryOptionsOf(input({ leaves }));
    expect(result.candidateSource).toBe('GENDER_PATH_ALL');
    // 전체 경로 순(기능화 < 운동화)
    expect(ids(result)).toEqual([LEAF.MALE_WHEELED_EXCLUDED, LEAF.MALE_SNEAKERS]);
  });

  it('설정에 더한 아동 카테고리 말도 뺀다', () => {
    const result = categoryOptionsOf(
      input({ genreIdPath: [], childCategoryWords: [...BUILTIN_CHILD_CATEGORY_WORDS, '스니커즈'] }),
    );
    expect(ids(result)).not.toContain(LEAF.MALE_SNEAKERS);
  });

  it('매핑표: 가장 깊은 장르 우선, 같은 장르면 상품유형이 같은 줄 → 없으면 상품유형 없는 줄', () => {
    const mapping = [
      { genreId: 110983, leafCategoryIds: ['1'] },
      { genreId: RUNNING_GENRE_ID, productType: null, leafCategoryIds: ['2', '3'] },
      { genreId: RUNNING_GENRE_ID, productType: '러닝화', leafCategoryIds: ['4', '2'] },
    ];
    expect(mappedLeafIds(mapping, RUNNING_PATH, '러닝화')).toEqual({
      genreId: RUNNING_GENRE_ID,
      leafCategoryIds: ['4', '2'],
    });
    expect(mappedLeafIds(mapping, RUNNING_PATH, null)).toEqual({
      genreId: RUNNING_GENRE_ID,
      leafCategoryIds: ['2', '3'],
    });
    expect(mappedLeafIds(mapping, [558885, 110983], null)).toEqual({
      genreId: 110983,
      leafCategoryIds: ['1'],
    });
    expect(mappedLeafIds(mapping, [], null)).toBeNull();
  });

  it('jsonb 목록 읽기: 모양이 어긋난 항목은 버린다', () => {
    expect(
      parseCategoryOptions([
        { leafCategoryId: '1', wholeCategoryName: 'a' },
        { leafCategoryId: 2 },
        null,
      ]),
    ).toEqual([{ leafCategoryId: '1', wholeCategoryName: 'a' }]);
    expect(parseCategoryOptions(null)).toEqual([]);
  });
});
