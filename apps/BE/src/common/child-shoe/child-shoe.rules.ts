/**
 * 아동화 공통 판별 규칙(F-BS-12, CON-08, US-02 AC1). 순수 함수만 둔다(DB·설정 파일을 읽지 않는다).
 *
 * - 키워드(① P2-01)·검색어·URL(② P2-02)·카테고리(④ P2-06)가 **같은 함수**를 부른다. 단계 모듈끼리는 서로 import할 수
 *   없어(03-ADR-003) 공용 위치 `common/child-shoe`에 둔다(Proposed, 03-2 C4 §3).
 * - 설정값(아동 단어·장르 루트·사이즈 기준·바퀴·고령자 단어)은 인자로 받는다. 부르는 쪽이 `SettingsService.current()`에서
 *   `childShoeRulesOf(settings)`로 꺼내 넘긴다.
 * - 끄는 옵션은 없다(F-BS-04). 기준을 느슨하게 바꾸는 설정 파일은 settings의 안전 기준 하한 검사가 거부한다.
 *
 * 단어 비교(Proposed, 05-1 §7.2 P2-01): 글자와 단어를 모두 NFKC → 소문자 → 앞뒤 공백 제거로 맞춘 뒤 '포함'으로 본다.
 * 반각 가타카나(ｷｯｽﾞ)·전각 영숫자(ＫＩＤＳ)·대소문자(Kids)가 같은 단어로 잡힌다.
 */

/** 아동화 의심 사이즈 기준의 하한(mm). 235는 통과, 234 이하는 설정 검증 오류(F-BS-05). settings가 이 값을 다시 쓴다 */
export const CHILD_SHOE_SIZE_FLOOR_MM = 235;

/** 기본 아동 단어(PRD §8.1 KW-01). 설정 `safety.childKeywords`에 모두 있어야 한다(더하기만 된다) */
export const BUILTIN_CHILD_TERMS: readonly string[] = [
  '키즈',
  '주니어',
  '아동',
  'キッズ',
  'ジュニア',
  'ベビー',
];

/**
 * 바퀴 달린 운동화 단어(F-BS-12, PRD §7 '바퀴 달린 운동화·고령자용 신발', Proposed — 문서에 목록 없음, 오너 검토).
 * 설정 `safety.wheeledShoeWords`에 모두 있어야 한다. 색 이름·흔한 낱말과 겹치지 않는 표기만 넣었다.
 */
export const BUILTIN_WHEELED_SHOE_WORDS: readonly string[] = [
  '바퀴',
  '롤러',
  '힐리스',
  'heelys',
  'ローラー',
  'ヒーリーズ',
  '車輪',
];

/**
 * 고령자용 신발 단어(Proposed, 오너 검토). 설정 `safety.seniorShoeWords`에 모두 있어야 한다.
 * '실버'만 쓰면 색 이름(실버 운동화)과 겹쳐 '실버화'처럼 신발 낱말이 붙은 표기만 넣었다.
 */
export const BUILTIN_SENIOR_SHOE_WORDS: readonly string[] = [
  '실버화',
  '효도화',
  '효도신발',
  '노인화',
  '介護',
  '高齢者',
  'シニア',
  'リハビリ',
];

/** 판별 규칙 값(설정에서 꺼낸다) */
export interface ChildShoeRules {
  /** 아동 단어(기본 6개 + 오너가 더한 단어) */
  childTerms: readonly string[];
  /** 라쿠텐 장르 루트(설정 `sourcing.genreId`, 기본 558885 靴). 상품 장르 경로에 이 id가 없으면 대상 밖 */
  rootGenreId: number;
  /** 상품 전체 사이즈 최댓값이 이 값 이하면 아동화 의심(설정 `safety.childShoeMaxSizeMm`, 기본 235) */
  sizeMaxMm: number;
  wheeledShoeWords: readonly string[];
  seniorShoeWords: readonly string[];
}

/** `childShoeRulesOf`가 읽는 설정 모양(settings 타입을 import하지 않으려고 구조만 적는다) */
export interface ChildShoeRuleSettings {
  sourcing: { genreId: number };
  safety: {
    childShoeMaxSizeMm: number;
    childKeywords: readonly string[];
    wheeledShoeWords: readonly string[];
    seniorShoeWords: readonly string[];
  };
}

/** 현재 설정에서 판별 규칙 값을 꺼낸다 */
export function childShoeRulesOf(settings: ChildShoeRuleSettings): ChildShoeRules {
  return {
    childTerms: settings.safety.childKeywords,
    rootGenreId: settings.sourcing.genreId,
    sizeMaxMm: settings.safety.childShoeMaxSizeMm,
    wheeledShoeWords: settings.safety.wheeledShoeWords,
    seniorShoeWords: settings.safety.seniorShoeWords,
  };
}

/** 단어 비교용 정규화: NFKC → 소문자 → 앞뒤 공백 제거(Proposed) */
export function normalizeChildTerm(text: string): string {
  return text.normalize('NFKC').toLowerCase().trim();
}

/** 글자에 든 첫 단어(목록 순서). 없으면 null. 빈 단어는 건너뛴다 */
export function findTerm(text: string, words: readonly string[]): string | null {
  const haystack = normalizeChildTerm(text);
  if (haystack === '') return null;
  for (const word of words) {
    const needle = normalizeChildTerm(word);
    if (needle !== '' && haystack.includes(needle)) return word;
  }
  return null;
}

/** 아동 단어가 든 첫 단어(없으면 null) */
export function findChildTerm(text: string, childTerms: readonly string[]): string | null {
  return findTerm(text, childTerms);
}

/** 키워드·상품명에 아동 단어가 들었나(F-KW-07, F-BS-12) */
export function hasChildTerm(text: string, childTerms: readonly string[]): boolean {
  return findChildTerm(text, childTerms) !== null;
}

/** 같은 단어인가(정규화 뒤 같음). 아동 단어 더하기의 중복 검사(409 CHILD_TERM_ALREADY_EXISTS)가 쓴다 */
export function isSameTerm(a: string, b: string): boolean {
  return normalizeChildTerm(a) === normalizeChildTerm(b);
}

/**
 * 상품 장르가 대상 장르(靴 558885) 아래인가. `idPath`는 루트부터 리프까지의 장르 id(라쿠텐 genreIdPath).
 * 경로가 비었으면 판단할 수 없어 false(대상 밖으로 본다 — 보수적).
 */
export function isGenreInScope(idPath: readonly number[], rootGenreId: number): boolean {
  return idPath.includes(rootGenreId);
}

/**
 * 상품 전체 사이즈의 최댓값이 기준 이하면 아동화 의심(F-BS-12). 사이즈를 모르면(빈 목록) 판단하지 않는다(false).
 * 예: 기준 235 → 최댓값 235는 의심, 240은 아님.
 */
export function isChildSizeSuspect(sizesMm: readonly number[], maxMm: number): boolean {
  const known = sizesMm.filter((n) => Number.isFinite(n) && n > 0);
  if (known.length === 0) return false;
  return Math.max(...known) <= maxMm;
}

/** 바퀴 달린 운동화 단어(없으면 null) */
export function findWheeledShoeWord(text: string, words: readonly string[]): string | null {
  return findTerm(text, words);
}

/** 고령자용 신발 단어(없으면 null) */
export function findSeniorShoeWord(text: string, words: readonly string[]): string | null {
  return findTerm(text, words);
}

/** 판별 사유(Proposed 코드). 하나라도 있으면 제외 */
export type ChildShoeReason =
  'CHILD_TERM' | 'GENRE_OUT_OF_SCOPE' | 'CHILD_SIZE' | 'WHEELED_SHOE' | 'SENIOR_SHOE';

export interface ChildShoeInput {
  /** 키워드·검색어·상품명 등 단어를 볼 글자들 */
  texts?: readonly string[];
  /** 상품 장르 경로(모르면 주지 않는다 — 장르 검사를 하지 않는다) */
  genreIdPath?: readonly number[];
  /** 상품 전체 사이즈(mm). 모르면 주지 않는다 */
  sizesMm?: readonly number[];
}

export interface ChildShoeHit {
  reason: ChildShoeReason;
  /** 걸린 단어(단어 사유일 때) */
  word?: string;
}

export interface ChildShoeVerdict {
  excluded: boolean;
  hits: ChildShoeHit[];
}

/**
 * 아동화 공통 판별(F-BS-12). 받은 신호만 본다: 글자(아동·바퀴·고령자 단어) · 장르 경로 · 사이즈.
 * 키워드 경로는 글자만 있고, 상품(②·④)은 셋 다 넘긴다. 결과가 excluded면 부르는 쪽이 막는다.
 */
export function judgeChildShoe(input: ChildShoeInput, rules: ChildShoeRules): ChildShoeVerdict {
  const hits: ChildShoeHit[] = [];
  const texts = input.texts ?? [];
  const firstWord = (words: readonly string[]): string | null => {
    for (const text of texts) {
      const word = findTerm(text, words);
      if (word !== null) return word;
    }
    return null;
  };
  const child = firstWord(rules.childTerms);
  if (child !== null) hits.push({ reason: 'CHILD_TERM', word: child });
  const wheeled = firstWord(rules.wheeledShoeWords);
  if (wheeled !== null) hits.push({ reason: 'WHEELED_SHOE', word: wheeled });
  const senior = firstWord(rules.seniorShoeWords);
  if (senior !== null) hits.push({ reason: 'SENIOR_SHOE', word: senior });
  if (input.genreIdPath !== undefined && !isGenreInScope(input.genreIdPath, rules.rootGenreId)) {
    hits.push({ reason: 'GENRE_OUT_OF_SCOPE' });
  }
  if (input.sizesMm !== undefined && isChildSizeSuspect(input.sizesMm, rules.sizeMaxMm)) {
    hits.push({ reason: 'CHILD_SIZE' });
  }
  return { excluded: hits.length > 0, hits };
}

/** 판별 규칙 값 검사(설정 검증과 같은 기준): 사이즈 기준 235 미만·빠진 기본 단어는 오류 문구 */
export function checkChildShoeRules(rules: ChildShoeRules): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(rules.sizeMaxMm) || rules.sizeMaxMm < CHILD_SHOE_SIZE_FLOOR_MM) {
    errors.push(`아동화 의심 기준은 ${CHILD_SHOE_SIZE_FLOOR_MM}mm보다 낮출 수 없습니다.`);
  }
  const missing = (builtin: readonly string[], actual: readonly string[]) =>
    builtin.filter((w) => !actual.some((a) => isSameTerm(a, w)));
  for (const w of missing(BUILTIN_CHILD_TERMS, rules.childTerms)) {
    errors.push(`기본 아동 단어 '${w}'는 뺄 수 없습니다.`);
  }
  for (const w of missing(BUILTIN_WHEELED_SHOE_WORDS, rules.wheeledShoeWords)) {
    errors.push(`기본 바퀴 신발 단어 '${w}'는 뺄 수 없습니다.`);
  }
  for (const w of missing(BUILTIN_SENIOR_SHOE_WORDS, rules.seniorShoeWords)) {
    errors.push(`기본 고령자 신발 단어 '${w}'는 뺄 수 없습니다.`);
  }
  return errors;
}
