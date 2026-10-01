import { DEFAULT_SETTINGS } from '../../settings/defaults/default-settings.js';
import type { TagRuleSettings } from '../../settings/schema/settings.types.js';
import { evaluatePool } from './evaluate.js';
import { compactOf, dedupeTags, normalizeTagText, tagKeyOf } from './normalize.js';
import { isDictionaryUnregistered, sellerTagsOf, toSellerTag } from './request-format.js';
import { chunk, checkRestricted } from './restricted-check.js';
import { filterTag, resolveOwnBrand, type TagRuleContext } from './rule-filter.js';
import { judgeTag, selectFinal, selectOwnerEdit } from './select-final.js';
import { applyEdits, buildTagPool, mergeEdits, type RecommendGroup } from './tag-pool.js';
import type { TagEdit, TagPoolEntry } from './tag-pipeline.types.js';

const RULES: TagRuleSettings = DEFAULT_SETTINGS.tags.rules;
const LEAF = '패션잡화>남성신발>운동화>러닝화';

function ctx(over: Partial<TagRuleContext> = {}): TagRuleContext {
  return {
    categoryPath: LEAF,
    gender: 'MALE',
    ownBrand: '아식스',
    productContext: `아식스 젤카야노14 러닝화 ${LEAF}`,
    rules: RULES,
    ...over,
  };
}

function entry(text: string, over: Partial<TagPoolEntry> = {}): TagPoolEntry {
  return {
    text,
    textKey: tagKeyOf(text),
    code: null,
    inRecommend: false,
    inCompetitor: false,
    ownerAdded: false,
    competitorBestRank: null,
    competitorFrequency: null,
    inputOrder: null,
    recommendOrder: null,
    ...over,
  };
}

function recommended(texts: string[]): RecommendGroup[] {
  return [
    { keyword: '아식스 젤카야노14', tags: texts.map((text, i) => ({ code: `${1000 + i}`, text })) },
  ];
}

describe('normalize(규칙 7, F-TG-07)', () => {
  it("' #Gel Kayano14 ' → 'gel kayano14'", () => {
    expect(normalizeTagText(' #Gel Kayano14 ')).toBe('gel kayano14');
  });

  it('#젤카야노14와 젤카야노14는 한 후보(같은 정규화 키)', () => {
    expect(tagKeyOf('#젤카야노14')).toBe(tagKeyOf('젤카야노14'));
    expect(dedupeTags(['#젤카야노14', '젤카야노14', ' 젤카야노14 ', '', '#'])).toEqual([
      '젤카야노14',
    ]);
  });

  it('공백 정리·전각 문자(NFKC)·영문 소문자', () => {
    expect(normalizeTagText('  GEL\t  KAYANO  ')).toBe('gel kayano');
    expect(normalizeTagText('ＧＥＬ１４')).toBe('gel14');
    expect(compactOf('아식스 운동화')).toBe('아식스운동화');
  });

  it('추천과 키가 같은 경쟁 태그는 추천의 text·code를 그대로 쓴다', () => {
    const pool = buildTagPool(
      [{ keyword: 'k', tags: [{ code: '77', text: 'GEL-KAYANO14' }] }],
      [{ tagText: '#gel-kayano14', sourceRank: 3, frequency: 5 }],
    );
    expect(pool).toHaveLength(1);
    expect(pool[0]).toMatchObject({
      text: 'GEL-KAYANO14',
      textKey: 'gel-kayano14',
      code: '77',
      inRecommend: true,
      inCompetitor: true,
      competitorBestRank: 3,
      competitorFrequency: 5,
      inputOrder: 1,
    });
  });
});

describe('rule-filter(규칙 8, F-TG-08)', () => {
  it("'러닝화'(리프 러닝화) → CATEGORY_TOKEN, 사유에 카테고리 이름", () => {
    expect(filterTag(entry('러닝화'), ctx())).toEqual({
      reason: 'CATEGORY_TOKEN',
      detail: '카테고리 이름(러닝화)과 같음',
    });
  });

  it('리프가 없으면(④ 전) CATEGORY_TOKEN으로 빼지 않는다', () => {
    expect(filterTag(entry('러닝화'), ctx({ categoryPath: null }))).toBeNull();
  });

  it("'나이키운동화' → BRAND_NAME(다른 브랜드명)", () => {
    expect(filterTag(entry('나이키운동화'), ctx())).toEqual({
      reason: 'BRAND_NAME',
      detail: '다른 브랜드명(나이키)',
    });
  });

  it("상품 자체 브랜드: 추천 태그 '아식스운동화'는 남기고(시안), 추천이 아니면 뺀다(Proposed)", () => {
    expect(filterTag(entry('아식스운동화', { inRecommend: true }), ctx())).toBeNull();
    expect(filterTag(entry('아식스정품', { inCompetitor: true }), ctx())).toMatchObject({
      reason: 'BRAND_NAME',
    });
    const strict = ctx({ rules: { ...RULES, keepOwnBrandRecommended: false } });
    expect(filterTag(entry('아식스운동화', { inRecommend: true }), strict)).toMatchObject({
      reason: 'BRAND_NAME',
      detail: '상품 브랜드명(아식스)',
    });
  });

  it("'무료배송' → PROMOTION, 판매처명 → STORE_NAME", () => {
    expect(filterTag(entry('무료배송'), ctx())).toEqual({
      reason: 'PROMOTION',
      detail: '홍보·배송 문구(무료배송)',
    });
    expect(filterTag(entry('무신사운동화'), ctx())).toMatchObject({ reason: 'STORE_NAME' });
  });

  it("'키즈운동화'(남성 성인화) → ATTRIBUTE_MISMATCH, 반대 성별·맞지 않는 용도도", () => {
    expect(filterTag(entry('키즈운동화'), ctx())).toEqual({
      reason: 'ATTRIBUTE_MISMATCH',
      detail: '아동 단어(키즈) · 성별·용도 불일치',
    });
    expect(filterTag(entry('여자운동화'), ctx())).toMatchObject({
      reason: 'ATTRIBUTE_MISMATCH',
      detail: '성별 불일치(여자)',
    });
    expect(filterTag(entry('남자운동화'), ctx())).toBeNull();
    expect(filterTag(entry('등산화'), ctx())).toMatchObject({
      reason: 'ATTRIBUTE_MISMATCH',
      detail: '용도·시즌 불일치(등산)',
    });
    expect(filterTag(entry('조깅화'), ctx())).toBeNull();
  });

  it('상품 자체 브랜드: 사전 순서대로 시드 키워드·브랜드 속성·상품명에서 찾는다', () => {
    expect(resolveOwnBrand(['아식스 젤카야노14'], RULES.brands)).toBe('아식스');
    expect(resolveOwnBrand([null, 'ASICS', 'x'], RULES.brands)).toBe('아식스');
    expect(resolveOwnBrand(['1201A019-108', null, 'アシックス ゲルカヤノ14'], RULES.brands)).toBe(
      '아식스',
    );
    expect(resolveOwnBrand(['무명 운동화'], RULES.brands)).toBeNull();
  });
});

function judgeAll(pool: TagPoolEntry[], restricted: string[] = [], removed: string[] = []) {
  return pool.map((e) =>
    judgeTag({
      entry: e,
      filter: removed.includes(e.textKey) ? null : filterTag(e, ctx()),
      restricted: restricted.includes(e.textKey) ? true : false,
      removed: removed.includes(e.textKey),
    }),
  );
}

describe('select-final(규칙 11, F-TG-11)', () => {
  it('추천∩경쟁 → 경쟁(빈도순) → 추천 순, 최대 10개', () => {
    const pool = buildTagPool(recommended(['젤카야노14', '조깅화', '커플운동화', '데일리룩']), [
      { tagText: '레트로운동화', sourceRank: null, frequency: 13 },
      { tagText: '젤카야노14', sourceRank: null, frequency: 18 },
      { tagText: '데일리운동화', sourceRank: null, frequency: 14 },
      { tagText: '조깅화', sourceRank: null, frequency: 15 },
      ...Array.from({ length: 9 }, (_, i) => ({
        tagText: `경쟁태그${i}`,
        sourceRank: null,
        frequency: 5 - (i % 3),
      })),
    ]);
    const result = selectFinal(judgeAll(pool), []);
    const finals = result
      .filter((d) => d.outcome === 'SELECTED')
      .sort((a, b) => a.finalOrder! - b.finalOrder!)
      .map((d) => d.textKey);
    expect(finals).toHaveLength(10);
    expect(finals.slice(0, 4)).toEqual(['젤카야노14', '조깅화', '데일리운동화', '레트로운동화']);
    expect(finals).not.toContain('커플운동화');
    expect(result.filter((d) => d.outcome === 'NOT_SELECTED').map((d) => d.textKey)).toEqual(
      expect.arrayContaining(['커플운동화', '데일리룩']),
    );
  });

  it('빈도가 없으면 입력 순서로 고른다', () => {
    const pool = buildTagPool(
      [],
      ['다', '가', '나'].map((t) => ({ tagText: `${t}운동화`, sourceRank: null, frequency: null })),
    );
    const result = selectFinal(judgeAll(pool), []);
    expect(result.map((d) => [d.textKey, d.finalOrder])).toEqual([
      ['다운동화', 1],
      ['가운동화', 2],
      ['나운동화', 3],
    ]);
  });

  it('경쟁 입력이 없고 추천이 7개면 최종 7개(10개를 억지로 채우지 않는다)', () => {
    const pool = buildTagPool(
      recommended([
        '젤카야노14',
        '조깅화',
        '커플운동화',
        '데일리룩',
        '가벼운운동화',
        '쿠션운동화',
        '남자운동화',
      ]),
      [],
    );
    const result = selectFinal(judgeAll(pool), []);
    expect(result.filter((d) => d.outcome === 'SELECTED')).toHaveLength(7);
    expect(result.map((d) => d.finalOrder)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('RESTRICTED는 뽑히지 않는다', () => {
    const pool = buildTagPool(recommended(['정품운동화', '조깅화']), []);
    const result = selectFinal(judgeAll(pool, ['정품운동화']), []);
    expect(result.find((d) => d.textKey === '정품운동화')).toMatchObject({
      outcome: 'RESTRICTED',
      restricted: true,
      finalOrder: null,
    });
    expect(result.find((d) => d.textKey === '조깅화')).toMatchObject({
      outcome: 'SELECTED',
      finalOrder: 1,
      restricted: false,
    });
  });

  it('오너가 더한 태그는 먼저 넣고(다시 실행해도 남는다) 순서는 경쟁 뒤·추천 앞', () => {
    const base = buildTagPool(recommended(Array.from({ length: 12 }, (_, i) => `추천${i}`)), [
      { tagText: '경쟁하나', sourceRank: 1, frequency: null },
    ]);
    const { pool, addedKeys } = applyEdits(base, [
      {
        action: 'ADD',
        text: '직접태그',
        textKey: '직접태그',
        editedAt: '2026-09-28T00:00:00.000Z',
      },
    ]);
    const result = selectFinal(judgeAll(pool), addedKeys);
    const finals = result
      .filter((d) => d.outcome === 'SELECTED')
      .sort((a, b) => a.finalOrder! - b.finalOrder!)
      .map((d) => d.textKey);
    expect(finals).toHaveLength(10);
    expect(finals[0]).toBe('경쟁하나');
    expect(finals[1]).toBe('직접태그');
    expect(finals[2]).toBe('추천0');
  });
});

describe('request-format(규칙 12, F-TG-12)', () => {
  it('추천과 같은 태그 → {code, text}, 오너가 넣은 사전 밖 태그 → {text}', () => {
    expect(toSellerTag({ text: '젤카야노14', code: '10010001' })).toEqual({
      code: '10010001',
      text: '젤카야노14',
    });
    expect(toSellerTag({ text: '가벼운운동화', code: null })).toEqual({ text: '가벼운운동화' });
    expect(
      sellerTagsOf([
        { text: 'b', code: null, finalOrder: 2 },
        { text: 'a', code: '1', finalOrder: 1 },
        { text: 'x', code: '2', finalOrder: null },
      ]),
    ).toEqual([{ code: '1', text: 'a' }, { text: 'b' }]);
    expect(isDictionaryUnregistered({ ownerAdded: true, code: null })).toBe(true);
    expect(isDictionaryUnregistered({ ownerAdded: true, code: '9' })).toBe(false);
    expect(isDictionaryUnregistered({ ownerAdded: false, code: null })).toBe(false);
  });
});

describe('restricted 1차 검증(규칙 10)', () => {
  it('설정 개수씩 나눠 부르고, 응답은 보낸 글자·정규화 키로 맞춘다', async () => {
    const calls: string[][] = [];
    const tags = ['A1', 'b2', 'c3', 'd4', 'e5'].map((t) => ({ text: t, textKey: tagKeyOf(t) }));
    const result = await checkRestricted(tags, 2, (batch) => {
      calls.push(batch);
      return Promise.resolve(
        batch
          .filter((t) => t !== 'e5')
          .map((t) => ({ tag: t.toLowerCase(), restricted: t === 'b2' })),
      );
    });
    expect(calls).toEqual([['A1', 'b2'], ['c3', 'd4'], ['e5']]);
    expect(result.calls).toBe(3);
    expect(result.byKey.get('a1')).toBe(false);
    expect(result.byKey.get('b2')).toBe(true);
    expect(result.byKey.get('e5')).toBeNull();
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('규칙에서 빠진 태그는 조회하지 않고 restricted=NULL', async () => {
    const pool = buildTagPool(recommended(['무료배송', '조깅화']), []);
    const sent: string[] = [];
    const { judged } = await evaluatePool({
      pool,
      removedKeys: new Set(),
      ruleContext: ctx(),
      batchSize: 10,
      restricted: (batch) => {
        sent.push(...batch);
        return Promise.resolve(batch.map((tag) => ({ tag, restricted: false })));
      },
    });
    expect(sent).toEqual(['조깅화']);
    expect(judged.find((j) => j.textKey === '무료배송')).toMatchObject({
      outcome: 'FILTERED',
      filterReason: 'PROMOTION',
      restricted: null,
    });
  });
});

describe('편집 다시 적용(규칙 13·14)', () => {
  const at = (s: string) => `2026-09-28T00:00:0${s}.000Z`;

  it("이전 편집(add 'x', remove 'y')이 새 결과에 적용되고, 제한 태그를 추가하면 RESTRICTED로 빠진다", async () => {
    const previous: TagEdit[] = [
      { action: 'ADD', text: 'x', textKey: 'x', editedAt: at('1') },
      { action: 'REMOVE', text: '조깅화', textKey: '조깅화', editedAt: at('2') },
    ];
    // 새 결과(다시 실행): 추천에 조깅화·커플운동화
    const fresh = buildTagPool(recommended(['조깅화', '커플운동화']), []);
    const edits = mergeEdits(previous, ['#정품운동화'], [], new Date('2026-09-28T01:00:00Z'));
    expect(edits.map((e) => [e.action, e.textKey])).toEqual([
      ['ADD', 'x'],
      ['REMOVE', '조깅화'],
      ['ADD', '정품운동화'],
    ]);
    const applied = applyEdits(fresh, edits);
    const { judged } = await evaluatePool({
      pool: applied.pool,
      removedKeys: applied.removedKeys,
      ruleContext: ctx(),
      batchSize: 10,
      restricted: (batch) =>
        Promise.resolve(batch.map((tag) => ({ tag, restricted: tag === '정품운동화' }))),
    });
    const result = selectFinal(judged, applied.addedKeys);
    const byKey = new Map(result.map((d) => [d.textKey, d]));
    expect(byKey.get('x')).toMatchObject({ outcome: 'SELECTED', ownerAdded: true, code: null });
    expect(byKey.get('조깅화')).toMatchObject({ outcome: 'OWNER_REMOVED', restricted: null });
    expect(byKey.get('정품운동화')).toMatchObject({
      outcome: 'RESTRICTED',
      ownerAdded: true,
      restricted: true,
    });
    expect(byKey.get('커플운동화')).toMatchObject({ outcome: 'SELECTED' });
  });

  it('같은 동작은 처음 시각을 지키고(edited_at 유지), 반대 동작이면 바꾼다', () => {
    const previous: TagEdit[] = [{ action: 'ADD', text: 'x', textKey: 'x', editedAt: at('1') }];
    expect(mergeEdits(previous, ['X'], [], new Date('2026-09-29T00:00:00Z'))).toEqual(previous);
    const flipped = mergeEdits(previous, [], ['x'], new Date('2026-09-29T00:00:00Z'));
    expect(flipped).toEqual([
      { action: 'REMOVE', text: 'x', textKey: 'x', editedAt: '2026-09-29T00:00:00.000Z' },
    ]);
  });

  it('오너 수정 버전은 뺀 자리를 순위 밖 태그로 채우지 않고, 더한 태그를 뒤에 붙인다(Proposed)', () => {
    const pool = buildTagPool(recommended(Array.from({ length: 11 }, (_, i) => `추천${i}`)), []);
    const baseFinal = Array.from({ length: 10 }, (_, i) => `추천${i}`);
    const applied = applyEdits(pool, [
      { action: 'REMOVE', text: '추천3', textKey: '추천3', editedAt: at('1') },
      { action: 'ADD', text: '새태그', textKey: '새태그', editedAt: at('2') },
    ]);
    const result = selectOwnerEdit(judgeAll(applied.pool, [], ['추천3']), baseFinal, ['새태그']);
    const finals = result
      .filter((d) => d.outcome === 'SELECTED')
      .sort((a, b) => a.finalOrder! - b.finalOrder!)
      .map((d) => d.textKey);
    expect(finals).toEqual([...baseFinal.filter((k) => k !== '추천3'), '새태그']);
    expect(result.find((d) => d.textKey === '추천10')?.outcome).toBe('NOT_SELECTED');
    expect(result.find((d) => d.textKey === '추천3')?.outcome).toBe('OWNER_REMOVED');
  });
});
