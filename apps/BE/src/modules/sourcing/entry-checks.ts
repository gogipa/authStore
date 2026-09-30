import {
  type ChildShoeRules,
  findTerm,
  isChildSizeSuspect,
  isGenreInScope,
  normalizeChildTerm,
} from '../../common/child-shoe/child-shoe.rules.js';

/** 장르 범위(05-2 RakutenItemEntryChecks.genreScope = sourcing_comparison.genre_scope) */
export type GenreScope = 'IN_SCOPE' | 'OUT_OF_SCOPE' | 'NOT_FOUND';

/** 05-2 RakutenItemEntryChecks */
export interface RakutenItemEntryChecks {
  /** 상품명에서 찾은 제외어(있으면 후보·행을 만들지 않는다 — 422 RAKUTEN_ITEM_EXCLUDED_WORD) */
  excludedWords: string[];
  genreScope: GenreScope;
  /** 전체 사이즈 최댓값 ≤ 설정값(기본 235mm) */
  childSizeSuspect: boolean;
  /** 아동화 의심이거나 장르가 IN_SCOPE가 아니면 true → ②가 '성인용 상품 확인' 입력 대기로 멈춘다 */
  adultConfirmationRequired: boolean;
}

export interface EntryCheckInput {
  itemName: string;
  /**
   * 상품 장르 경로(루트 → 리프 genreId). 장르를 얻지 못했거나(genre_source NOT_FOUND) 장르는 있는데 경로를 받지 못했으면
   * null → NOT_FOUND(판단할 수 없어 성인용 확인을 받는다 — 보수적, Proposed)
   */
  genreIdPath: readonly number[] | null;
  /** 상품 전체 SKU의 사이즈(mm). cm가 아닌 라벨(null)은 뺀다 */
  sizesMm: readonly (number | null)[];
}

export interface EntryCheckRules {
  /** 제외어(설정 `sourcing.ngKeywords` — 검색 NGKeyword와 같은 목록, F-SO-33) */
  excludedWords: readonly string[];
  /** 아동화 공통 판별 값(P2-01 common/child-shoe) */
  childShoe: ChildShoeRules;
}

/** 글자에 든 단어 모두(목록 순서, 정규화 비교 — NFKC·소문자) */
function allTerms(text: string, words: readonly string[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const word of words) {
    const key = normalizeChildTerm(word);
    if (key === '' || seen.has(key)) continue;
    if (findTerm(text, [word]) !== null) {
      seen.add(key);
      found.push(word);
    }
  }
  return found;
}

/**
 * URL 입구 아동화 신호(F-SO-05·F-SO-07·F-SO-33, P2-02 규칙 12). 순수 함수 — 막지 않고 알리며, 후보·행을 만들 때 다시 부른다.
 * - 제외어: 설정 제외어(中古·インソール·靴紐·シューレース·箱のみ·キッズ·ジュニア·ベビー) + 아동 단어(P2-01 공통 규칙)가
 *   상품명에 있으면 모두 모은다(중복 없이)
 * - 장르: 경로에 설정 장르(靴 558885)가 있으면 IN_SCOPE, 없으면 OUT_OF_SCOPE, 경로를 모르면 NOT_FOUND
 * - 사이즈: 전체 사이즈 최댓값 ≤ 기준(기본 235, 235 미만 설정은 settings가 막는다)이면 아동화 의심(모르면 false)
 */
export function entryChecksOf(
  input: EntryCheckInput,
  rules: EntryCheckRules,
): RakutenItemEntryChecks {
  const excludedWords = allTerms(input.itemName, [
    ...rules.excludedWords,
    ...rules.childShoe.childTerms,
  ]);
  const genreScope: GenreScope =
    input.genreIdPath === null || input.genreIdPath.length === 0
      ? 'NOT_FOUND'
      : isGenreInScope(input.genreIdPath, rules.childShoe.rootGenreId)
        ? 'IN_SCOPE'
        : 'OUT_OF_SCOPE';
  const sizes = input.sizesMm.filter((n): n is number => n !== null);
  const childSizeSuspect = isChildSizeSuspect(sizes, rules.childShoe.sizeMaxMm);
  return {
    excludedWords,
    genreScope,
    childSizeSuspect,
    adultConfirmationRequired: childSizeSuspect || genreScope !== 'IN_SCOPE',
  };
}

/** 성인용 확인이 필요한 신호인가(sourcing_comparison 머리 행 값으로) — 05-3 CONFIRMATION_NOT_APPLICABLE 판정 */
export function needsAdultConfirmation(head: {
  childSizeSuspect: boolean | null;
  genreScope: string | null;
}): boolean {
  return (
    head.childSizeSuspect === true ||
    head.genreScope === 'OUT_OF_SCOPE' ||
    head.genreScope === 'NOT_FOUND'
  );
}
