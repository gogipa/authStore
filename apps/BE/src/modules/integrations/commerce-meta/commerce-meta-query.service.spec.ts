import { createMetaKit, type MetaKit } from '../../../../test/support/commerce-meta-kit.js';
import { categoryBlockReason, isGenderShoeLeaf } from './category-rules.js';

describe('카테고리 거르기(규칙 11)', () => {
  it('CHILD_CERTIFICATION·아동 말·CON-08 제외 품목 말이면 고를 수 없다', () => {
    const base = { name: '러닝화', wholeCategoryName: '패션잡화>남성신발>운동화>러닝화' };
    expect(
      categoryBlockReason({ ...base, exceptionalCategories: ['KC_CERTIFICATION'] }),
    ).toBeNull();
    expect(categoryBlockReason({ ...base, exceptionalCategories: ['CHILD_CERTIFICATION'] })).toBe(
      'CHILD_CERTIFICATION',
    );
    expect(
      categoryBlockReason({
        name: '운동화',
        wholeCategoryName: '패션잡화>아동신발>운동화',
        exceptionalCategories: [],
      }),
    ).toBe('CHILD_CATEGORY');
    expect(
      categoryBlockReason({
        name: '바퀴운동화',
        wholeCategoryName: '패션잡화>남성신발>운동화>바퀴운동화',
        exceptionalCategories: [],
      }),
    ).toBe('CON08_EXCLUDED');
    expect(
      categoryBlockReason({
        name: '효도화',
        wholeCategoryName: '패션잡화>여성신발>기능화>효도화',
        exceptionalCategories: [],
      }),
    ).toBe('CON08_EXCLUDED');
  });

  it('성별 신발 경로는 접두사로 판단한다', () => {
    expect(isGenderShoeLeaf('패션잡화>남성신발>운동화', 'MALE')).toBe(true);
    expect(isGenderShoeLeaf('패션잡화>남성신발>운동화', 'FEMALE')).toBe(false);
    expect(isGenderShoeLeaf('패션잡화>남성가방>백팩')).toBe(false);
    expect(isGenderShoeLeaf('스포츠>남성신발>운동화')).toBe(false);
  });
});

describe('CommerceMetaQueryService.listCategories(메모리 DB)', () => {
  let k: MetaKit;

  beforeEach(() => {
    k = createMetaKit();
  });

  it('캐시가 비면 409 COMMERCE_META_NOT_SYNCED(details.target=CATEGORY)', async () => {
    await expect(k.query.listCategories({ gender: 'MALE' })).rejects.toMatchObject({
      code: 'COMMERCE_META_NOT_SYNCED',
      message: "네이버 카테고리 정보가 아직 없습니다. 시스템 상태에서 '지금 동기화'를 눌러 주세요.",
      details: { target: 'CATEGORY' },
    });
  });

  it('MALE → 남성 리프 3개(아동 인증·사라진 행·신발 밖 제외), FEMALE → 3개', async () => {
    await k.syncAll(['CATEGORY', 'CATEGORY_DETAIL']);
    const male = await k.query.listCategories({ gender: 'MALE' });
    expect(male.content.map((c) => c.categoryId)).toEqual(['50000793', '50000791', '50000792']);
    expect(male.page).toEqual({ number: 0, size: 20, totalElements: 3, totalPages: 1 });
    const female = await k.query.listCategories({ gender: 'FEMALE' });
    expect(female.content).toHaveLength(3);
    expect(female.content.every((c) => c.wholeCategoryName.startsWith('패션잡화>여성신발>'))).toBe(
      true,
    );

    // v2: 로퍼가 사라지고 보트슈즈가 생긴다 → 여전히 3개, 사라진 행은 없다
    k.server.categories = 'categories-last-v2';
    await k.syncAll(['CATEGORY', 'CATEGORY_DETAIL']);
    const after = await k.query.listCategories({ gender: 'MALE' });
    expect(after.content.map((c) => c.categoryId).sort()).toEqual([
      '50000791',
      '50000792',
      '50000795',
    ]);
    // P2-06용 읽기: 막힌 리프도 이유와 함께 준다
    const leaves = await k.cache.listShoeLeaves('MALE');
    expect(leaves.find((l) => l.categoryId === '50000794')!.blockReason).toBe(
      'CHILD_CERTIFICATION',
    );
    expect(leaves.some((l) => l.categoryId === '50000793')).toBe(false);
    expect((await k.cache.findCategory('50000793'))!.removedAt).toBeInstanceOf(Date);
  });

  it('wholeCategoryName 내림차순, 페이지 자르기', async () => {
    await k.syncAll(['CATEGORY', 'CATEGORY_DETAIL']);
    const desc = await k.query.listCategories({
      gender: 'MALE',
      sort: 'wholeCategoryName,desc',
      size: '2',
      page: '1',
    });
    expect(desc.content.map((c) => c.categoryId)).toEqual(['50000793']);
    expect(desc.page).toEqual({ number: 1, size: 2, totalElements: 3, totalPages: 2 });
    await expect(
      k.query.listCategories({ gender: 'MALE', sort: 'name,asc' }),
    ).rejects.toMatchObject({ code: 'INVALID_QUERY_PARAMETER' });
  });
});
