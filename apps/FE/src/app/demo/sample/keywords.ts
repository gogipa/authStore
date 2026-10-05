import { childTermList } from '@/test/fixtures/keywords';
import type { Ok } from './types';
import { STORY } from './story';

/** 데이터랩 cid(PRD §8.1): 여성신발 · 남성신발. 버튼 수집은 여성신발 → 남성신발 순서다 */
export const WOMEN_CID = '50000173';
export const MEN_CID = '50000174';
export const COLLECT_CIDS: readonly string[] = [WOMEN_CID, MEN_CID];

/** 한 페이지 20개(PRD §8.1)를 100위까지 받는다 — 체험은 한 분야당 20줄(페이지 5개 × 4줄)을 예시로 둔다 */
export const ROWS_PER_PAGE = 4;

/** 예시 순위(여성신발) */
const WOMEN_KEYWORDS = [
  '나이키 에어포스1',
  '뉴발란스 530',
  '아디다스 삼바',
  '크록스 클래식',
  '반스 올드스쿨',
  '나이키 덩크로우',
  '호카 클리프톤',
  '뉴발란스 327',
  '아디다스 가젤',
  '컨버스 척70',
  '살로몬 XT-6',
  '오니츠카타이거 멕시코66',
  '아식스 젤1130',
  '푸마 스피드캣',
  '닥터마틴 1460',
  '버켄스탁 보스턴',
  '나이키 에어맥스 97',
  '뉴발란스 9060',
  '아디다스 스탠스미스',
  '리복 클럽C',
];

/** 예시 순위(남성신발, 화면시안_명세 §4 남성신발 순위 + 흐름 테스트의 '키즈 운동화') */
const MEN_KEYWORDS = [
  '뉴발란스 530',
  STORY.sourceKeyword,
  '아디다스 삼바',
  '오니츠카타이거 멕시코66',
  '나이키 코르테즈',
  '살로몬 XT-6',
  '반스 올드스쿨',
  '뉴발란스 2002R',
  '호카 클리프톤',
  '컨버스 척70',
  '아식스 젤1130',
  '뉴발란스 993',
  '나이키 에어포스1',
  '아디다스 가젤',
  '미즈노 웨이브라이더',
  '키즈 운동화',
  '푸마 스피드캣',
  '아식스 GT2160',
  '리복 클럽C',
  '살로몬 스피드크로스',
];

/** 아동 단어(키즈)가 든 키워드는 아동화로 빠진다 */
const CHILD_KEYWORD = '키즈 운동화';

export interface KeywordSpec {
  id: number;
  cid: string;
  rank: number;
  keyword: string;
  childExcluded: boolean;
}

/** 묶음 안 키워드 전부(분야별 순위순). 남성신발 id 100~119(G1로 고르는 '아식스 젤카야노14' = 101), 여성신발 id 200~219 */
export const KEYWORD_SPECS: readonly KeywordSpec[] = [
  ...WOMEN_KEYWORDS.map((keyword, index) => ({
    id: 200 + index,
    cid: WOMEN_CID,
    rank: index + 1,
    keyword,
    childExcluded: false,
  })),
  ...MEN_KEYWORDS.map((keyword, index) => ({
    id: 100 + index,
    cid: MEN_CID,
    rank: index + 1,
    keyword,
    childExcluded: keyword === CHILD_KEYWORD,
  })),
];

/** 소싱을 누를 때 자동으로 바꾸는 일본어 검색어(F-BS-70)의 예시 답: 키워드 원문 → 일본어·영문 검색어. 모르는 키워드는 신발 일반어로 답한다 */
const RAKUTEN_QUERIES: Readonly<Record<string, string>> = {
  [STORY.sourceKeyword]: 'アシックス ゲルカヤノ14',
  '뉴발란스 530': 'ニューバランス 530',
  '나이키 에어포스1': 'ナイキ エアフォース1',
  '아디다스 삼바': 'アディダス サンバ',
  '크록스 클래식': 'クロックス クラシック',
  '반스 올드스쿨': 'バンズ オールドスクール',
  '호카 클리프톤': 'ホカ クリフトン',
  '살로몬 XT-6': 'サロモン XT-6',
};
const FALLBACK_RAKUTEN_QUERY = 'スニーカー';

export function rakutenQueryOf(keyword: string): string {
  return RAKUTEN_QUERIES[keyword] ?? FALLBACK_RAKUTEN_QUERY;
}

export function childKeywordTerms(): Ok<'/child-keyword-terms'> {
  return childTermList();
}
