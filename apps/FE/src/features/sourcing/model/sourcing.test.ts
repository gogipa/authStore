import { describe, expect, it } from 'vitest';
import {
  entryChecks,
  queryValidation,
  rakutenItemSnapshot,
  sourcingComparison,
} from '@/test/fixtures/sourcing';
import {
  adultConfirmationOf,
  colorOptionsOf,
  comparisonSummaryText,
  entryCheckNotice,
  excludedWordsText,
  existingCandidateIdOf,
  hasHangul,
  HANGUL_QUERY_HINT,
  queryCheckSummary,
  queryViolationText,
} from './sourcing';

describe('sourcing 모델(P2-02)', () => {
  it("검사 요약: '길이 n/128 · 사용 가능' 조각, 위반은 첫 위반 요약, 검사 전은 null", () => {
    expect(queryCheckSummary(undefined)).toBeNull();
    expect(queryCheckSummary(queryValidation('靴', { halfWidthLength: 2 }))).toEqual({
      valid: true,
      count: '2/128',
      text: '사용 가능',
    });
    const tooLong = queryValidation('x', {
      valid: false,
      halfWidthLength: 130,
      violations: [{ rule: 'TOO_LONG', word: null, message: '길다' }],
    });
    expect(queryCheckSummary(tooLong)?.text).toBe('너무 깁니다');
    const short = queryValidation('a', {
      valid: false,
      violations: [
        { rule: 'WORD_TOO_SHORT', word: 'a', message: "'a'이(가) 너무 짧습니다." },
        { rule: 'WORD_TOO_SHORT', word: 'b', message: "'b'이(가) 너무 짧습니다." },
      ],
    });
    expect(queryCheckSummary(short)?.text).toBe('짧은 단어가 있습니다');
    expect(queryViolationText(short)).toBe("'a'이(가) 너무 짧습니다. 'b'이(가) 너무 짧습니다.");
    expect(queryViolationText(queryValidation('ok'))).toBeUndefined();
  });

  it('제외어·입구 검사 문구', () => {
    expect(excludedWordsText(['中古', 'キッズ'])).toBe(
      '상품명에 제외어(中古·キッズ)가 있어 쓸 수 없습니다.',
    );
    expect(entryCheckNotice(entryChecks())).toBeNull();
    expect(
      entryCheckNotice(
        entryChecks({ genreScope: 'OUT_OF_SCOPE', adultConfirmationRequired: true }),
      ),
    ).toBe("대상 외 장르 상품입니다. 여정을 만든 뒤 '성인용 상품 확인'을 체크해야 ②가 끝납니다.");
  });

  it('색상 목록: SKU 색상 라벨(순서·중복 없이), 없으면 variantSelectors 색상 축', () => {
    expect(colorOptionsOf(rakutenItemSnapshot())).toEqual([
      'クリーム×ブラック(108)',
      'ホワイト(100)',
    ]);
    const noSkuColor = rakutenItemSnapshot({
      skus: [],
      variantSelectors: [
        { key: 'サイズ', values: [{ value: '25.0cm' }] },
        { key: 'カラー', label: 'カラー', values: [{ value: 'レッド' }, 'ブルー'] },
      ],
    });
    expect(colorOptionsOf(noSkuColor)).toEqual(['レッド', 'ブルー']);
    expect(colorOptionsOf(undefined)).toEqual([]);
  });

  it('성인용 확인 상태: 아동화 의심·대상 외·장르 모름 + 입력 대기 + 현재 버전일 때만 체크할 수 있다', () => {
    expect(adultConfirmationOf(undefined)).toMatchObject({
      required: false,
      canConfirm: false,
      maxMm: 235,
    });
    const base = { candidateId: 1 };
    expect(adultConfirmationOf(sourcingComparison(base))).toMatchObject({
      required: false,
      canConfirm: false,
    });
    expect(
      adultConfirmationOf(
        sourcingComparison({ ...base, childSizeSuspect: true, stepStatus: 'WAITING_INPUT' }),
      ),
    ).toMatchObject({ required: true, canConfirm: true });
    expect(
      adultConfirmationOf(
        sourcingComparison({ ...base, genreScope: 'NOT_FOUND', stepStatus: 'COMPLETED' }),
      ),
    ).toMatchObject({ required: true, canConfirm: false });
    expect(
      adultConfirmationOf(
        sourcingComparison({
          ...base,
          genreScope: 'OUT_OF_SCOPE',
          stepStatus: 'WAITING_INPUT',
          adultProductConfirmedAt: '2026-09-28T05:10:00.000Z',
          params: { childShoeMaxSizeMm: 240 },
        }),
      ),
    ).toEqual({
      required: true,
      confirmedAt: '2026-09-28T05:10:00.000Z',
      canConfirm: false,
      maxMm: 240,
    });
  });

  it('비교 칸 요약·중복 여정 id', () => {
    expect(comparisonSummaryText(undefined)).toBe(
      '② 소싱을 실행하면 라쿠텐 검색 결과가 여기에 나옵니다.',
    );
    expect(comparisonSummaryText(sourcingComparison({ candidateId: 1 }))).toMatch(
      /^URL로 만든 여정이라/,
    );
    expect(
      comparisonSummaryText(
        sourcingComparison({
          candidateId: 1,
          comparisonPerformed: true,
          exploreMode: true,
          rows: [],
        }),
      ),
    ).toBe(
      '검색 결과 0건 · 상품명에 아동용 단어가 있는 상품은 뺐습니다. 기준 상품을 정하면 같은 상품을 파는 샵을 모아 비교한 표가 여기에 나옵니다.',
    );
    expect(
      existingCandidateIdOf({
        code: 'CANDIDATE_DUPLICATE',
        envelope: { details: { existingCandidateId: 9 } },
      }),
    ).toBe(9);
    expect(existingCandidateIdOf({ code: 'RAKUTEN_ITEM_EXCLUDED_WORD', envelope: {} })).toBeNull();
    expect(existingCandidateIdOf(null)).toBeNull();
  });

  it('한글이 든 검색어를 알아본다(라쿠텐은 한글로 거의 검색되지 않는다)', () => {
    expect(hasHangul('여성로퍼')).toBe(true);
    expect(hasHangul('asics 젤카야노14')).toBe(true);
    expect(hasHangul('ㅋㅋ')).toBe(true);
    expect(hasHangul('ローファー レディース')).toBe(false);
    expect(hasHangul('New Balance 530 靴')).toBe(false);
    expect(hasHangul('')).toBe(false);
    expect(HANGUL_QUERY_HINT).toContain('일본어');
  });
});
