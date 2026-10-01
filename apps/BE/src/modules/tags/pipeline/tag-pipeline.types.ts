/** ⑦ 태그 파이프라인 타입(P3-05). ERD `tag_candidate`·`tag_owner_edit` 열과 1:1(순서 정보만 더 있다) */

/** tag_candidate.outcome(M1 — BELOW_SCORE는 M2 점수화) */
export const TAG_OUTCOMES = [
  'SELECTED',
  'NOT_SELECTED',
  'FILTERED',
  'RESTRICTED',
  'OWNER_REMOVED',
] as const;
export type TagOutcome = (typeof TAG_OUTCOMES)[number];

/** tag_candidate.filter_reason(ck_tag_cand_filter_reason) */
export const TAG_FILTER_REASONS = [
  'CATEGORY_TOKEN',
  'BRAND_NAME',
  'STORE_NAME',
  'PROMOTION',
  'ATTRIBUTE_MISMATCH',
] as const;
export type TagFilterReason = (typeof TAG_FILTER_REASONS)[number];

/** 최종 태그 상한(PRD §8.6 6, ck_tag_cand_order 1~10) */
export const FINAL_TAG_LIMIT = 10;

/** 후보 하나(정규화 키로 합친 뒤, 판정 전) */
export interface TagPoolEntry {
  text: string;
  textKey: string;
  /** recommend-tags 태그 ID(추천과 정규화 키가 같을 때만) */
  code: string | null;
  inRecommend: boolean;
  inCompetitor: boolean;
  ownerAdded: boolean;
  competitorBestRank: number | null;
  competitorFrequency: number | null;
  /** 경쟁 입력 전체에서 처음 나온 순서(1부터) */
  inputOrder: number | null;
  /** 추천 응답 순서(키워드 순 → 응답 순, 0부터). 추천이 아니면 null — 저장하지 않고 행 순서로 남는다 */
  recommendOrder: number | null;
}

/** 판정까지 끝난 후보(= tag_candidate 한 행) */
export interface TagDraft extends TagPoolEntry {
  outcome: TagOutcome;
  filterReason: TagFilterReason | null;
  filterDetail: string | null;
  /** restricted-tags 결과. null = 조회 안 함(규칙에서 빠짐·오너가 뺌·응답에 없음) */
  restricted: boolean | null;
  finalOrder: number | null;
}

/** 오너 편집 한 줄(= tag_owner_edit 한 행) */
export interface TagEdit {
  action: 'ADD' | 'REMOVE';
  text: string;
  textKey: string;
  /** 오너가 처음 편집한 시각(ISO). 버전을 복사할 때도 그대로 */
  editedAt: string;
}

/** 경쟁 태그 한 줄(tag_competitor_item + 입력 순서) */
export interface CompetitorTagRow {
  tagText: string;
  sourceRank: number | null;
  frequency: number | null;
}
