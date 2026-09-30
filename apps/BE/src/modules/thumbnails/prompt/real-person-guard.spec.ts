import { BUILTIN_PERSON_BLOCK_WORDS } from '../../settings/safety/builtin-safety-lists.js';
import { REAL_PERSON_BUILTIN_TERMS } from './real-person-builtin.js';
import {
  blockTermPattern,
  findBlockedTerms,
  normalizeForGuard,
  personBlockDictionary,
} from './real-person-guard.js';

const SETTINGS_EXTRA = ['가상아이돌테스트', 'Fixture Star'];
const DICTIONARY = personBlockDictionary([...BUILTIN_PERSON_BLOCK_WORDS, ...SETTINGS_EXTRA]);

describe('findBlockedTerms(P3-01 규칙 13·14, F-TH-10, US-13 AC1)', () => {
  it('내장 목록은 설정 안전 기준 목록 하나를 쓴다(원본이 둘로 갈라지지 않는다)', () => {
    expect(REAL_PERSON_BUILTIN_TERMS).toBe(BUILTIN_PERSON_BLOCK_WORDS);
    expect(REAL_PERSON_BUILTIN_TERMS.length).toBeGreaterThan(0);
  });

  it('내장 단어와 설정 추가 단어 모두 걸리고, 걸린 단어가 사전 표기 그대로 나온다', () => {
    expect(findBlockedTerms('A model who looks like BTS member', DICTIONARY)).toEqual(['BTS']);
    expect(findBlockedTerms('뉴진스 느낌으로', DICTIONARY)).toEqual(['뉴진스']);
    expect(findBlockedTerms('styled like 가상아이돌테스트 and fixture star', DICTIONARY)).toEqual([
      '가상아이돌테스트',
      'Fixture Star',
    ]);
  });

  it('설정 추가분이 비어도 내장 단어는 늘 검사한다(내장 ∪ 설정)', () => {
    const builtinOnly = personBlockDictionary([]);
    expect(builtinOnly).toEqual([...BUILTIN_PERSON_BLOCK_WORDS]);
    expect(findBlockedTerms('aespa style', builtinOnly)).toEqual(['aespa']);
  });

  it('정규화: 대소문자·전각(NFKC)·공백을 무시한다', () => {
    expect(findBlockedTerms('like blackpink', DICTIONARY)).toEqual(['BLACKPINK']);
    expect(findBlockedTerms('ＢＴＳ風', DICTIONARY)).toEqual(['BTS']);
    expect(findBlockedTerms('STRAYKIDS vibe', DICTIONARY)).toEqual(['Stray Kids']);
    expect(findBlockedTerms('stray   kids', DICTIONARY)).toEqual(['Stray Kids']);
    expect(findBlockedTerms('스트레이키즈 스타일', DICTIONARY)).toEqual(['스트레이 키즈']);
    expect(findBlockedTerms('le sserafim', DICTIONARY)).toEqual(['LE SSERAFIM']);
    expect(normalizeForGuard('ＡＢＣ')).toBe('abc');
  });

  it('영문 차단어는 단어 경계를 본다(붙은 영문자·숫자는 다른 낱말), 한글은 붙여 써도 걸린다', () => {
    expect(findBlockedTerms('pay the debts', DICTIONARY)).toEqual([]);
    expect(findBlockedTerms('btsx', DICTIONARY)).toEqual([]);
    expect(findBlockedTerms('(bts)-style', DICTIONARY)).toEqual(['BTS']);
    expect(findBlockedTerms('BTS2', DICTIONARY)).toEqual([]);
    expect(findBlockedTerms('뉴진스스타일', DICTIONARY)).toEqual(['뉴진스']);
  });

  it('여러 단어가 걸리면 사전 순서대로 한 번씩', () => {
    expect(findBlockedTerms('BTS, bts and 카리나 with BTS', DICTIONARY)).toEqual(['BTS', '카리나']);
  });

  it('사전은 정규화해 같은 단어를 한 번만 둔다(설정에 내장 단어가 다시 있어도)', () => {
    const dict = personBlockDictionary(['bts', 'Ｂ Ｔ Ｓ', '새이름', '  ']);
    expect(dict.filter((t) => normalizeForGuard(t).replace(/\s+/g, '') === 'bts')).toEqual(['BTS']);
    expect(dict).toContain('새이름');
    expect(blockTermPattern('   ')).toBeNull();
  });
});
