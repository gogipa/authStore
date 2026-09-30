import { DEFAULT_SETTINGS } from '../../modules/settings/defaults/default-settings.js';
import { validateSafetyFloor } from '../../modules/settings/safety/safety-floor.validator.js';
import {
  BUILTIN_CHILD_TERMS,
  BUILTIN_SENIOR_SHOE_WORDS,
  BUILTIN_WHEELED_SHOE_WORDS,
  CHILD_SHOE_SIZE_FLOOR_MM,
  checkChildShoeRules,
  childShoeRulesOf,
  type ChildShoeRules,
  findChildTerm,
  hasChildTerm,
  isChildSizeSuspect,
  isGenreInScope,
  isSameTerm,
  judgeChildShoe,
  normalizeChildTerm,
} from './child-shoe.rules.js';

const rules: ChildShoeRules = {
  childTerms: BUILTIN_CHILD_TERMS,
  rootGenreId: 558885,
  sizeMaxMm: 235,
  wheeledShoeWords: BUILTIN_WHEELED_SHOE_WORDS,
  seniorShoeWords: BUILTIN_SENIOR_SHOE_WORDS,
};

describe('아동화 공통 판별 규칙(F-BS-12, P2-01 규칙 12)', () => {
  it.each(['키즈 운동화', '주니어 샌들', '아동화', 'キッズ', 'ジュニア', 'ベビー'])(
    "'%s'는 아동 단어가 든 키워드다",
    (keyword) => {
      expect(hasChildTerm(keyword, BUILTIN_CHILD_TERMS)).toBe(true);
    },
  );

  it.each(['뉴발란스 530', '아식스 젤카야노14', '나이키 코르테즈'])("'%s'는 아니다", (keyword) => {
    expect(hasChildTerm(keyword, BUILTIN_CHILD_TERMS)).toBe(false);
  });

  it('정규화(NFKC·소문자): 반각 가타카나·대소문자·앞뒤 공백을 같은 단어로 본다', () => {
    expect(findChildTerm('ｷｯｽﾞ スニーカー', BUILTIN_CHILD_TERMS)).toBe('キッズ');
    expect(hasChildTerm('HEELYS 운동화', ['heelys'])).toBe(true);
    expect(hasChildTerm('Kids 샌들', ['kids'])).toBe(true);
    expect(normalizeChildTerm('  ＫＩＤＳ  ')).toBe('kids');
    expect(isSameTerm(' 유아 ', '유아')).toBe(true);
    expect(isSameTerm('Kids', 'KIDS')).toBe(true);
  });

  it('빈 단어는 무시한다(빈 글자는 아무 단어도 들어 있지 않다)', () => {
    expect(hasChildTerm('뉴발란스', ['', '  '])).toBe(false);
    expect(hasChildTerm('', BUILTIN_CHILD_TERMS)).toBe(false);
  });

  it('사이즈: 전체 사이즈 최댓값 235 이하면 아동화 의심, 240이면 아니다. 모르면 판단하지 않는다', () => {
    expect(isChildSizeSuspect([200, 220, 235], 235)).toBe(true);
    expect(isChildSizeSuspect([230, 240], 235)).toBe(false);
    expect(isChildSizeSuspect([], 235)).toBe(false);
  });

  it('장르: 장르 경로에 靴(558885)가 있어야 대상이다. 경로가 비면 대상 밖(보수적)', () => {
    expect(isGenreInScope([100433, 558885, 208025], 558885)).toBe(true);
    expect(isGenreInScope([100533, 200822], 558885)).toBe(false);
    expect(isGenreInScope([], 558885)).toBe(false);
  });

  it('판별 하나로 글자·장르·사이즈·바퀴·고령자 신호를 모두 본다', () => {
    expect(judgeChildShoe({ texts: ['뉴발란스 530'] }, rules)).toEqual({
      excluded: false,
      hits: [],
    });
    const verdict = judgeChildShoe(
      {
        texts: ['힐리스 키즈 운동화', '실버화'],
        genreIdPath: [100533],
        sizesMm: [180, 200],
      },
      rules,
    );
    expect(verdict.excluded).toBe(true);
    expect(verdict.hits.map((h) => h.reason)).toEqual([
      'CHILD_TERM',
      'WHEELED_SHOE',
      'SENIOR_SHOE',
      'GENRE_OUT_OF_SCOPE',
      'CHILD_SIZE',
    ]);
    expect(verdict.hits[0]).toEqual({ reason: 'CHILD_TERM', word: '키즈' });
  });

  it('설정에서 규칙 값을 꺼낸다(기본 설정은 검사를 통과한다)', () => {
    const fromDefaults = childShoeRulesOf(DEFAULT_SETTINGS);
    expect(fromDefaults.rootGenreId).toBe(558885);
    expect(fromDefaults.sizeMaxMm).toBe(235);
    expect(checkChildShoeRules(fromDefaults)).toEqual([]);
  });

  it('sizeMaxMm 230 설정 → 설정 검증 오류(규칙 검사와 설정 안전 기준 하한 모두)', () => {
    expect(CHILD_SHOE_SIZE_FLOOR_MM).toBe(235);
    expect(checkChildShoeRules({ ...rules, sizeMaxMm: 230 })).toEqual([
      '아동화 의심 기준은 235mm보다 낮출 수 없습니다.',
    ]);
    const relaxed = structuredClone(DEFAULT_SETTINGS);
    relaxed.safety.childShoeMaxSizeMm = 230;
    expect(validateSafetyFloor(relaxed).map((v) => v.item)).toEqual(['CHILD_SHOE_SIZE_LOWERED']);
  });

  it('기본 단어는 뺄 수 없다(더하기만) — 빠지면 규칙 검사·안전 기준 하한 모두 오류', () => {
    const relaxed = structuredClone(DEFAULT_SETTINGS);
    relaxed.safety.childKeywords = relaxed.safety.childKeywords.filter((w) => w !== 'ベビー');
    relaxed.safety.wheeledShoeWords = relaxed.safety.wheeledShoeWords.filter((w) => w !== '롤러');
    relaxed.safety.seniorShoeWords = relaxed.safety.seniorShoeWords.filter((w) => w !== '介護');
    expect(checkChildShoeRules(childShoeRulesOf(relaxed))).toHaveLength(3);
    expect(validateSafetyFloor(relaxed).map((v) => v.item)).toEqual([
      'CHILD_KEYWORD_REMOVED',
      'WHEELED_SHOE_WORD_REMOVED',
      'SENIOR_SHOE_WORD_REMOVED',
    ]);
  });
});
