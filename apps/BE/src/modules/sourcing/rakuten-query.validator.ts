import {
  halfWidthLength,
  RAKUTEN_QUERY_MAX_HALF_WIDTH,
  rakutenQueryViolations,
  type RakutenQueryViolation,
} from './domain/rakuten-query.rules.js';

/** 05-2 RakutenQueryValidation(저장 없는 계산) */
export interface RakutenQueryValidationResult {
  rakutenQuery: string;
  valid: boolean;
  halfWidthLength: number;
  maxHalfWidthLength: typeof RAKUTEN_QUERY_MAX_HALF_WIDTH;
  violations: RakutenQueryViolation[];
  /** 검색에 붙는 설정 장르(靴 558885) */
  genreId: number;
  /** 검색에 붙는 제외어(NGKeyword) */
  ngKeywords: string[];
}

/**
 * 라쿠텐 검색어 형식 검사(F-SO-02, P2-02 규칙 4). 순수 함수. `POST /rakuten-query-validations`(200, 규칙 위반도 200
 * `valid=false`)·후보 만들기(422 RAKUTEN_QUERY_INVALID)·② 시작(422)이 같은 규칙(domain/rakuten-query.rules.ts)을 쓴다.
 * 앞뒤 공백은 떼고 검사한다(후보 만들기와 같다).
 */
export function validateRakutenQuery(
  rawQuery: string,
  filters: { genreId: number; ngKeywords: readonly string[] },
): RakutenQueryValidationResult {
  const rakutenQuery = rawQuery.trim();
  const violations = rakutenQueryViolations(rakutenQuery);
  return {
    rakutenQuery,
    valid: rakutenQuery !== '' && violations.length === 0,
    halfWidthLength: halfWidthLength(rakutenQuery),
    maxHalfWidthLength: RAKUTEN_QUERY_MAX_HALF_WIDTH,
    violations,
    genreId: filters.genreId,
    ngKeywords: [...filters.ngKeywords],
  };
}
