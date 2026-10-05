import type { components } from '@/shared/api/schema';
import { formatKstTime } from '@/shared/lib/format';

/** ⑦ 태그 화면 표시 규칙(SCR-07 Tags.dc.html, P3-05). 서버 값을 화면 글로 바꾸는 순수 함수와 문구 상수 */

export type TagSetOutput = components['schemas']['TagSetOutput'];
export type TagCandidateItem = components['schemas']['TagCandidateItem'];
export type FinalTagItem = components['schemas']['FinalTagItem'];
export type TagOwnerEditItem = components['schemas']['TagOwnerEditItem'];
export type TagCompetitorInputItem = components['schemas']['TagCompetitorInputItem'];
export type TagCompetitorInputCreated = components['schemas']['TagCompetitorInputCreated'];
export type TagCompetitorFileInputRequest = components['schemas']['TagCompetitorFileInputRequest'];
export type CompetitorSourceType = TagCompetitorInputItem['sourceType'];

/** 경쟁 태그 입력 하나 보내기(붙여 넣은 글 또는 파일) */
export type CompetitorInputSubmit =
  { kind: 'TEXT'; sourceType: CompetitorSourceType; text: string } | { kind: 'FILE'; file: File };

/** 최종 태그 상한(PRD §8.6 6) */
export const FINAL_TAG_LIMIT = 10;

// ── 문구(보드 그대로) ──
export const FINAL_TITLE = '최종 태그';
export const FINAL_NOTE =
  '고친 태그도 규칙 필터·제한 태그 확인을 다시 거치고, 다시 실행해도 유지됩니다';
export const NEXT_APPROVAL_LABEL = '다음: 최종 승인';
export const ADD_TAG_LABEL = '태그 추가';
export const ADD_TAG_PLACEHOLDER = '태그 입력';
export const ADD_BUTTON_LABEL = '추가';
export const FINAL_FULL_REASON = '10개가 다 찼습니다. 하나를 지운 뒤 넣어 주세요.';
export const DICTIONARY_NOTE = "사전에 없는 태그는 '사전 미등록'으로 표시";
export const DICTIONARY_UNREGISTERED_LABEL = '사전 미등록';
export const CANDIDATES_TITLE = '후보 태그';
export const SELECTION_ORDER_TEXT =
  '선정 순서: 추천과 같은 경쟁 태그 → 나머지 경쟁 태그 → 추천 태그 · 최대 10개';
export const CATEGORY_UNDECIDED_LABEL = '카테고리 미확정';
export const COMPETITOR_TITLE = '경쟁 태그 입력';
export const COMPETITOR_CAPTION = '원본은 저장하지 않습니다';
export const UPLOAD_LABEL = '엑셀 파일 올리기';
export const UPLOAD_CAPTION = "셀라파인더 '키워드정보'의 manu태그";
export const PASTE_LABEL = '붙여넣기';
export const PASTE_PLACEHOLDER = '태그 목록을 붙여 넣으세요. 빈도가 있으면 빈도순으로 씁니다.';
export const PASTE_BUTTON_LABEL = '읽기';
export const FREE_TEXT_LABEL = '자유 텍스트';
export const FREE_TEXT_PLACEHOLDER = '아는 경쟁 태그를 쉼표로 나눠 입력';
export const FREE_TEXT_BUTTON_LABEL = '더하기';
export const ADVANCED_TITLE = '(고급) 네이버쇼핑 검색 응답에서 태그 뽑기';
export const BLOCK_418_NOTICE =
  '브라우저 확장이나 F12로 응답을 복사하면 네이버쇼핑 접속이 차단(418)될 수 있습니다.';
export const BROWSER_LABEL = '검색 응답(JSON·HAR)';
export const BROWSER_BUTTON_LABEL = '태그 뽑기';
export const INPUTS_TITLE = '읽은 입력';
export const EXCLUDED_TITLE = '뺀 태그와 사유';
export const EXCLUDED_CAPTION = '규칙 사전 판정 · AI 판정 꺼짐';
export const EXCLUDED_EMPTY_TEXT = '뺀 태그가 없습니다.';
export const TAGS_EMPTY_TEXT =
  '⑦을 실행하면 시드 키워드·모델명·상품유형으로 추천 태그를 받고, 경쟁 태그와 합쳐 최종 태그 10개 이하를 고릅니다.';
export const TAGS_RUNNING_REASON = '⑦이 실행 중입니다. 끝난 뒤 바꿀 수 있습니다.';
export const TAGS_NOT_EDITABLE_REASON = '⑦을 실행한 뒤 태그를 고칠 수 있습니다.';
export const ADD_EMPTY_REASON = '넣을 태그를 입력해 주세요.';
export const ADD_DUPLICATE_REASON = '이미 최종 태그에 있습니다.';
export const ADD_TOO_LONG_REASON = '태그는 100자까지입니다.';

/** 태그 정규화(서버 F-TG-07과 같은 규칙 — 화면의 중복·빈 값 확인용) */
export function normalizeTag(raw: string): string {
  return raw.normalize('NFKC').replace(/#/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** 출처 글(시안 '추천·경쟁' · '경쟁' · '직접' · '추천') */
export function sourceText(
  c: Pick<TagCandidateItem, 'inRecommend' | 'inCompetitor' | 'ownerAdded'>,
): string {
  const parts: string[] = [];
  if (c.inRecommend) parts.push('추천');
  if (c.inCompetitor) parts.push('경쟁');
  if (c.ownerAdded) parts.push('직접');
  return parts.join('·');
}

/** 후보 상태 칸 */
export type CandidateState = 'FINAL' | 'OUT_OF_RANK' | 'EXCLUDED';

export function candidateState(c: Pick<TagCandidateItem, 'outcome'>): CandidateState {
  if (c.outcome === 'SELECTED') return 'FINAL';
  if (c.outcome === 'NOT_SELECTED' || c.outcome === 'BELOW_SCORE') return 'OUT_OF_RANK';
  return 'EXCLUDED';
}

export const CANDIDATE_STATE_LABEL: Record<CandidateState, string> = {
  FINAL: '최종',
  OUT_OF_RANK: '순위 밖',
  EXCLUDED: '뺌',
};

/** 후보 표 거르기 */
export type CandidateFilter = 'ALL' | 'FINAL' | 'OUT_OF_RANK' | 'EXCLUDED';

export function candidateCounts(candidates: readonly TagCandidateItem[]) {
  const states = candidates.map(candidateState);
  return {
    ALL: candidates.length,
    FINAL: states.filter((s) => s === 'FINAL').length,
    OUT_OF_RANK: states.filter((s) => s === 'OUT_OF_RANK').length,
    EXCLUDED: states.filter((s) => s === 'EXCLUDED').length,
  } satisfies Record<CandidateFilter, number>;
}

const STATE_ORDER: Record<CandidateState, number> = { FINAL: 0, OUT_OF_RANK: 1, EXCLUDED: 2 };

/** 표 줄: 최종(순서) → 순위 밖 → 뺌, 같은 무리는 서버 순서(후보 순) */
export function candidateRows(
  candidates: readonly TagCandidateItem[],
  filter: CandidateFilter,
): TagCandidateItem[] {
  return candidates
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => filter === 'ALL' || candidateState(c) === filter)
    .sort((a, b) => {
      const sa = STATE_ORDER[candidateState(a.c)];
      const sb = STATE_ORDER[candidateState(b.c)];
      if (sa !== sb) return sa - sb;
      if (sa === 0) return (a.c.finalOrder ?? 0) - (b.c.finalOrder ?? 0);
      return a.index - b.index;
    })
    .map(({ c }) => c);
}

/** 뺀 태그(규칙 필터·제한 태그·오너가 뺌) */
export function excludedTags(candidates: readonly TagCandidateItem[]): TagCandidateItem[] {
  return candidates.filter((c) => candidateState(c) === 'EXCLUDED');
}

const FILTER_REASON_TEXT: Record<NonNullable<TagCandidateItem['filterReason']>, string> = {
  CATEGORY_TOKEN: '카테고리 이름과 같음',
  BRAND_NAME: '브랜드명',
  STORE_NAME: '판매처·스토어명',
  PROMOTION: '홍보·배송 문구',
  ATTRIBUTE_MISMATCH: '성별·용도 불일치',
};

/** 뺀 사유 글(규칙 필터는 서버 사유 글, 제한 태그는 보드 문구 — 등록 성공을 약속하지 않는다) */
export function excludedReasonText(c: TagCandidateItem): string {
  if (c.outcome === 'RESTRICTED') return '제한 태그 · 네이버 확인';
  if (c.outcome === 'OWNER_REMOVED') return '직접 뺌';
  if (c.outcome === 'BELOW_SCORE') return '기준 점수 미만';
  if (c.filterDetail) return c.filterDetail;
  return c.filterReason ? FILTER_REASON_TEXT[c.filterReason] : '규칙에 걸림';
}

/** 뺀 태그 줄의 출처·빈도(시안 '경쟁 11', '추천·경쟁 15') */
export function excludedSourceText(c: TagCandidateItem): string {
  const source = sourceText(c);
  return c.competitorFrequency !== null && c.competitorFrequency !== undefined
    ? `${source} ${c.competitorFrequency}`
    : source;
}

/** 리프 경로 마지막 조각(카테고리 이름) */
export function leafName(wholeCategoryName: string | null | undefined): string | null {
  if (!wholeCategoryName) return null;
  const parts = wholeCategoryName
    .split('>')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.at(-1) ?? null;
}

/**
 * 후보 표 아래 요약(시안 '추천 7(14:40 받음) · 경쟁 13 · 직접 1 · 카테고리 러닝화 기준 필터'). 카테고리 이름은 여정의 지금 리프가
 * 이 버전의 리프와 같을 때만 쓴다(아니면 리프 id)
 */
export function candidatesSummaryText(
  set: TagSetOutput,
  candidateLeaf: { leafCategoryId: string | null; wholeCategoryName: string | null } | null,
): string {
  const recommend = set.candidates.filter((c) => c.inRecommend).length;
  const competitor = set.candidates.filter((c) => c.inCompetitor).length;
  const owner = set.candidates.filter((c) => c.ownerAdded).length;
  const parts = [`추천 ${recommend}(${formatKstTime(set.createdAt)} 받음)`, `경쟁 ${competitor}`];
  if (owner > 0) parts.push(`직접 ${owner}`);
  if (set.leafCategoryId === null) {
    parts.push('카테고리 미확정 · 카테고리 필터 없이 뽑음');
  } else {
    const name =
      candidateLeaf && candidateLeaf.leafCategoryId === set.leafCategoryId
        ? leafName(candidateLeaf.wholeCategoryName)
        : null;
    parts.push(`카테고리 ${name ?? set.leafCategoryId} 기준 필터`);
  }
  return parts.join(' · ');
}

const SOURCE_TYPE_TEXT: Record<CompetitorSourceType, string> = {
  SELLERFINDER: '셀라파인더',
  BROWSER_RESPONSE: '검색 응답',
  FREE_TEXT: '자유 텍스트',
};

export function sourceTypeText(sourceType: CompetitorSourceType): string {
  return SOURCE_TYPE_TEXT[sourceType];
}

/** 입력 한 줄(시안 '14:38 · 13개 읽음 · 빈도순') */
export function inputSummaryText(input: TagCompetitorInputItem): string {
  return `${formatKstTime(input.importedAt)} · ${input.itemCount}개 읽음 · ${
    input.hasFrequency ? '빈도순' : '입력 순서'
  }`;
}

/** 상태 줄 입력 출처(시안 "시드 키워드 '아식스 젤카야노14' · 경쟁 태그 붙여넣기") */
export function tagsSourceText(
  set: TagSetOutput | undefined,
  inputs: readonly TagCompetitorInputItem[],
): string {
  const seed = set?.recommendKeywords[0];
  const head = seed ? `시드 키워드 '${seed}'` : '시드 키워드 · ② 모델명·상품유형';
  const kinds = [...new Set(inputs.map((i) => sourceTypeText(i.sourceType)))];
  return `${head} · ${kinds.length > 0 ? `경쟁 태그 ${kinds.join('·')}` : '경쟁 태그 없음'}`;
}

/** '태그 추가'가 꺼진 이유(null이면 켜짐). 10개가 찼으면 보드 문구 */
export function addTagDisabledReason(input: {
  editable: boolean;
  running: boolean;
  finalCount: number;
  text: string;
  finalKeys: readonly string[];
}): string | null {
  if (input.running) return TAGS_RUNNING_REASON;
  if (!input.editable) return TAGS_NOT_EDITABLE_REASON;
  if (input.finalCount >= FINAL_TAG_LIMIT) return FINAL_FULL_REASON;
  const key = normalizeTag(input.text);
  if (key.length === 0) return ADD_EMPTY_REASON;
  if (key.length > 100) return ADD_TOO_LONG_REASON;
  if (input.finalKeys.includes(key)) return ADD_DUPLICATE_REASON;
  return null;
}

/** 최종 태그 수 글(시안 '10/10') */
export function finalCountText(count: number): string {
  return `${count}/${FINAL_TAG_LIMIT}`;
}
