import { describe, expect, it } from 'vitest';
import { boardCandidates, competitorInput, tagSetOutput } from '@/test/fixtures/tags';
import {
  addTagDisabledReason,
  candidateCounts,
  candidateRows,
  candidatesSummaryText,
  excludedReasonText,
  excludedSourceText,
  excludedTags,
  FINAL_FULL_REASON,
  inputSummaryText,
  normalizeTag,
  sourceText,
  tagsSourceText,
} from './tags';

describe('⑦ 태그 표시 규칙(model/tags, P3-05)', () => {
  it('정규화는 서버와 같다(#·공백·소문자·NFKC)', () => {
    expect(normalizeTag(' #Gel  Kayano14 ')).toBe('gel kayano14');
    expect(normalizeTag('ＧＥＬ')).toBe('gel');
  });

  it('출처 글·뺀 태그 출처(빈도)·사유 글', () => {
    const [first] = boardCandidates();
    expect(sourceText(first!)).toBe('추천·경쟁');
    expect(sourceText({ inRecommend: false, inCompetitor: false, ownerAdded: true })).toBe('직접');
    const excluded = excludedTags(boardCandidates());
    expect(excluded.map((c) => c.text)).toEqual([
      '나이키운동화',
      '무료배송',
      '키즈운동화',
      '정품운동화',
      '러닝화',
    ]);
    expect(excludedSourceText(excluded[0]!)).toBe('경쟁 11');
    expect(excludedReasonText(excluded[3]!)).toBe('제한 태그 · 네이버 확인');
    expect(excludedReasonText(excluded[4]!)).toBe('카테고리 이름(러닝화)과 같음');
  });

  it('후보 수(전체 16 · 최종 10 · 순위 밖 1 · 뺌 5)와 표 줄 순서(최종 순 → 순위 밖 → 뺌)', () => {
    const candidates = boardCandidates();
    expect(candidateCounts(candidates)).toEqual({
      ALL: 16,
      FINAL: 10,
      OUT_OF_RANK: 1,
      EXCLUDED: 5,
    });
    const rows = candidateRows(candidates, 'ALL');
    expect(rows.slice(0, 3).map((c) => c.text)).toEqual(['젤카야노14', '아식스운동화', '조깅화']);
    expect(rows[10]!.text).toBe('데일리룩');
    expect(candidateRows(candidates, 'EXCLUDED')).toHaveLength(5);
  });

  it("요약('추천 n(시각 받음) · 경쟁 n · 직접 n · 카테고리 러닝화 기준 필터')과 상태 줄 입력 출처", () => {
    const set = tagSetOutput();
    expect(
      candidatesSummaryText(set, {
        leafCategoryId: '50000830',
        wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
      }),
    ).toBe('추천 7(14:40 받음) · 경쟁 13 · 직접 1 · 카테고리 러닝화 기준 필터');
    expect(candidatesSummaryText({ ...set, leafCategoryId: null }, null)).toMatch(
      /카테고리 미확정 · 카테고리 필터 없이 뽑음$/,
    );
    expect(tagsSourceText(set, [competitorInput({ id: 1 })])).toBe(
      "시드 키워드 '아식스 젤카야노14' · 경쟁 태그 셀라파인더",
    );
    expect(tagsSourceText(set, [])).toBe("시드 키워드 '아식스 젤카야노14' · 경쟁 태그 없음");
    expect(inputSummaryText(competitorInput({ id: 1, hasFrequency: false, itemCount: 4 }))).toBe(
      '14:38 · 4개 읽음 · 입력 순서',
    );
  });

  it("'태그 추가' 꺼진 이유: 10개면 보드 문구, 빈 값·이미 있음·실행 중", () => {
    const base = {
      editable: true,
      running: false,
      finalCount: 9,
      text: '새태그',
      finalKeys: ['조깅화'],
    };
    expect(addTagDisabledReason(base)).toBeNull();
    expect(addTagDisabledReason({ ...base, finalCount: 10 })).toBe(FINAL_FULL_REASON);
    expect(addTagDisabledReason({ ...base, text: ' # ' })).toBe('넣을 태그를 입력해 주세요.');
    expect(addTagDisabledReason({ ...base, text: '#조깅화' })).toBe('이미 최종 태그에 있습니다.');
    expect(addTagDisabledReason({ ...base, running: true })).toBe(
      '⑦이 실행 중입니다. 끝난 뒤 바꿀 수 있습니다.',
    );
  });
});
