/**
 * 앱에 내장한 안전 기준(F-BS-05, F-BS-39, GEN-01, US-36 AC4). 설정 파일은 이 목록에 **더할 수만** 있고,
 * 내장 항목을 빼거나 아래 하한·상한을 넘게 풀면 앱이 그 파일을 거부한다(safety-floor.validator.ts).
 * 목록을 늘리는 것은 앱 업데이트(코드)로만 한다.
 */
import {
  BUILTIN_CHILD_TERMS,
  BUILTIN_SENIOR_SHOE_WORDS as COMMON_SENIOR_SHOE_WORDS,
  BUILTIN_WHEELED_SHOE_WORDS as COMMON_WHEELED_SHOE_WORDS,
  CHILD_SHOE_SIZE_FLOOR_MM,
} from '../../../common/child-shoe/child-shoe.rules.js';
import {
  BUILTIN_CHILD_CATEGORY_WORDS as COMMON_CHILD_CATEGORY_WORDS,
  BUILTIN_EXCLUDED_CATEGORY_WORDS as COMMON_EXCLUDED_CATEGORY_WORDS,
} from '../../../common/rules/category-words.js';
import type { NoticeBlockCondition } from '../schema/settings.types.js';

/**
 * 아동화 의심 사이즈 기준의 하한(mm). 235는 통과, 234 이하는 거부.
 * P2-01: 아동화 공통 판별 규칙(`common/child-shoe`)과 같은 값 하나를 쓴다.
 */
export const CHILD_SHOE_MAX_MM_FLOOR = CHILD_SHOE_SIZE_FLOOR_MM;

/** 판정 유효 시간의 상한(시간). 6은 통과, 6보다 길면 거부 */
export const JUDGEMENT_VALIDITY_HOURS_CEIL = 6;

/** KW-01 아동 키워드(PRD §8.1). `safety.childKeywords`에 모두 있어야 한다(원본은 common/child-shoe, P2-01) */
export const BUILTIN_CHILD_KEYWORDS: readonly string[] = BUILTIN_CHILD_TERMS;

/** 바퀴 달린 운동화 단어(F-BS-12, P2-01 Proposed). `safety.wheeledShoeWords`에 모두 있어야 한다 */
export const BUILTIN_WHEELED_SHOE_WORDS: readonly string[] = COMMON_WHEELED_SHOE_WORDS;

/** 고령자용 신발 단어(F-BS-12, P2-01 Proposed). `safety.seniorShoeWords`에 모두 있어야 한다 */
export const BUILTIN_SENIOR_SHOE_WORDS: readonly string[] = COMMON_SENIOR_SHOE_WORDS;

/** 아동 카테고리 말(F-CA-07, P2-06 Proposed). `safety.childCategoryWords`에 모두 있어야 한다(원본 common/rules) */
export const BUILTIN_CHILD_CATEGORY_WORDS: readonly string[] = COMMON_CHILD_CATEGORY_WORDS;

/** CON-08 판매 제외 품목 카테고리 말(F-CA-09, P2-06 Proposed). `safety.excludedCategoryWords`에 모두 있어야 한다 */
export const BUILTIN_EXCLUDED_CATEGORY_WORDS: readonly string[] = COMMON_EXCLUDED_CATEGORY_WORDS;

/** 라쿠텐 검색 NGKeyword의 아동 단어(PRD §8.2). `sourcing.ngKeywords`에 모두 있어야 한다 */
export const BUILTIN_NG_KEYWORD_CHILD_WORDS: readonly string[] = ['キッズ', 'ジュニア', 'ベビー'];

/**
 * 실존 인물·그룹·연예인 차단어(IM-07, F-TH-10). `safety.personBlockWords`에 모두 있어야 한다.
 * Proposed(문서에 목록 없음, ERD §7.4-1·06-4 §2.2 — 오너 검토): 프롬프트에 흔히 들어갈 만한 K-pop 그룹·인물 이름.
 * 'IVE'·'TWICE'·'Red Velvet'·'있지'처럼 흔한 낱말·색 이름과 겹치는 표기는 뺐다(오탐으로 생성이 막히지 않게).
 * 오너가 설정 파일에 더한다.
 */
export const BUILTIN_PERSON_BLOCK_WORDS: readonly string[] = [
  '방탄소년단',
  'BTS',
  '블랙핑크',
  'BLACKPINK',
  '트와이스',
  '세븐틴',
  '스트레이 키즈',
  'Stray Kids',
  '에스파',
  'aespa',
  '뉴진스',
  'NewJeans',
  '르세라핌',
  'LE SSERAFIM',
  '아이브',
  '엔하이픈',
  'ENHYPEN',
  '에이티즈',
  'ATEEZ',
  'ITZY',
  '차은우',
  '장원영',
  '카리나',
];

/** 구매대행 고지 필수 블록 하나: 블록 ID, 넣는 조건, 문장(NFC 정규화·앞뒤 공백 제거)의 SHA-256 */
export interface RequiredNoticeBlock {
  id: string;
  when: NoticeBlockCondition | null;
  sha256: string;
}

/**
 * 구매대행 고지 필수 블록(CT-04, PRD §8.5 템플릿 초안). `notice.blocks`에 같은 ID·같은 조건·같은 문장으로
 * 있어야 한다. 문장은 앱에 넣지 않고 해시만 둔다(F-BS-05 '앱에 내장한 해시와 비교').
 * Proposed(ERD §7.4-1·06-4 §2.2 — 오너 검토): 법·통관·청약철회 안내가 담긴 줄을 필수로 했다.
 * 머리글(HEADER)·교환(EXCHANGE, 문장 전체가 자리표시자)·A/S(AFTER_SERVICE)·판매가 구성(PRICE_BREAKDOWN, 선택)·
 * 기준일(BASIS_DATE)은 필수가 아니다. 법률 검토(E-3)로 문장이 바뀌면 이 해시도 앱 업데이트로 바꾼다.
 */
export const REQUIRED_NOTICE_BLOCKS: readonly RequiredNoticeBlock[] = [
  {
    id: 'AGENCY',
    when: null,
    sha256: '296e0f78f272130d1715f20ab8cc5b758283f5ccb3b4255008287bf2bd2e3952',
  },
  {
    id: 'DELIVERY',
    when: null,
    sha256: '35de7ee8c7e0b65ca4a604599c05408e98b4731b385634d720240571f031779c',
  },
  {
    id: 'CUSTOMS_DUTY',
    when: null,
    sha256: '0a0668c16d08a6cd7ac4c5d663703903acf80ff5f16093993d151fa3d531a642',
  },
  {
    id: 'COMBINED_TAX',
    when: null,
    sha256: 'c2f19285de7ebf0cfa9d1133a575e64eb927576b33d3be6d419811d8b97c6ddc',
  },
  {
    id: 'PERSONAL_CUSTOMS_CODE',
    when: null,
    sha256: '2e9da876086b66483871260f0210c60b100c3dd163369b1a10b662e05760794c',
  },
  {
    id: 'WITHDRAWAL',
    when: null,
    sha256: '49e0a9777eb5e056d989f1ed4b6fa99ac2cff96afb022a23b983a22420806ebd',
  },
  {
    id: 'ORIGIN',
    when: null,
    sha256: '2abc16d3935d0bad2b164abbb08f86a072ca17d2459ec72d3fc315b1812c2342',
  },
  {
    id: 'LEATHER_SAFETY',
    when: 'LEATHER_OR_UNKNOWN_MATERIAL',
    sha256: '9a27bbb8dff6b0b268984135e2169be523dadda551b42ca0ae25f92c03424337',
  },
  {
    id: 'AI_IMAGE',
    when: 'AI_IMAGE_LABEL',
    sha256: 'cfc6dad9806924a2fee3bf4b3a346cb1b3ea88b4bbf4ca48b2180c3c72bbb7b8',
  },
];
