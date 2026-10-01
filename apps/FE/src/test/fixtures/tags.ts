import type { components } from '@/shared/api/schema';

type TagSetOutput = components['schemas']['TagSetOutput'];
type TagCandidateItem = components['schemas']['TagCandidateItem'];
type TagCompetitorInputItem = components['schemas']['TagCompetitorInputItem'];

const AT = '2026-09-28T05:40:00.000Z';

let nextId = 1;

/** 후보 한 줄(기본: 최종이 아닌 추천 태그) */
export function tagCandidate(
  patch: Partial<TagCandidateItem> & { text: string },
): TagCandidateItem {
  return {
    id: nextId++,
    textKey: patch.text.toLowerCase(),
    code: null,
    inRecommend: false,
    inCompetitor: false,
    ownerAdded: false,
    competitorBestRank: null,
    competitorFrequency: null,
    inputOrder: null,
    outcome: 'NOT_SELECTED',
    filterReason: null,
    filterDetail: null,
    restricted: null,
    finalOrder: null,
    dictionaryUnregistered: false,
    score: null,
    ...patch,
  };
}

/** 시안 Tags.dc.html의 후보표(최종 10 · 순위 밖 1 · 뺌 5) — 화면시안_명세 §4 태그 예 */
export function boardCandidates(): TagCandidateItem[] {
  const final = (text: string, order: number, src: Partial<TagCandidateItem>): TagCandidateItem =>
    tagCandidate({ text, outcome: 'SELECTED', finalOrder: order, restricted: false, ...src });
  const both = (freq: number, code: string) => ({
    inRecommend: true,
    inCompetitor: true,
    competitorFrequency: freq,
    code,
  });
  const comp = (freq: number) => ({ inCompetitor: true, competitorFrequency: freq });
  return [
    final('젤카야노14', 1, both(18, '10010001')),
    final('아식스운동화', 2, both(16, '10010002')),
    final('조깅화', 3, both(15, '10010003')),
    final('남자운동화', 4, both(12, '10010004')),
    final('데일리운동화', 5, comp(14)),
    final('레트로운동화', 6, comp(13)),
    final('크림운동화', 7, comp(12)),
    final('쿠션운동화', 8, comp(11)),
    final('가벼운운동화', 9, { ownerAdded: true, dictionaryUnregistered: true }),
    final('커플운동화', 10, { inRecommend: true, code: '10010006' }),
    tagCandidate({ text: '데일리룩', inRecommend: true, code: '10010007' }),
    tagCandidate({
      text: '나이키운동화',
      ...comp(11),
      outcome: 'FILTERED',
      filterReason: 'BRAND_NAME',
      filterDetail: '다른 브랜드명(나이키)',
    }),
    tagCandidate({
      text: '무료배송',
      ...comp(15),
      outcome: 'FILTERED',
      filterReason: 'PROMOTION',
      filterDetail: '홍보·배송 문구(무료배송)',
    }),
    tagCandidate({
      text: '키즈운동화',
      ...comp(6),
      outcome: 'FILTERED',
      filterReason: 'ATTRIBUTE_MISMATCH',
      filterDetail: '아동 단어(키즈) · 성별·용도 불일치',
    }),
    tagCandidate({ text: '정품운동화', ...comp(9), outcome: 'RESTRICTED', restricted: true }),
    tagCandidate({
      text: '러닝화',
      ...both(15, '10010005'),
      outcome: 'FILTERED',
      filterReason: 'CATEGORY_TOKEN',
      filterDetail: '카테고리 이름(러닝화)과 같음',
    }),
  ];
}

export function tagSetOutput(patch: Partial<TagSetOutput> = {}): TagSetOutput {
  const candidates = patch.candidates ?? boardCandidates();
  const finalTags = candidates
    .filter((c) => c.outcome === 'SELECTED' && c.finalOrder != null)
    .sort((a, b) => (a.finalOrder ?? 0) - (b.finalOrder ?? 0))
    .map((c) => ({ ...(c.code ? { code: c.code } : {}), text: c.text, finalOrder: c.finalOrder! }));
  return {
    stepRunId: 120,
    candidateId: 1,
    version: 1,
    stepRunStatus: 'COMPLETED',
    isCurrent: true,
    tagSetId: 7,
    recommendKeywords: ['아식스 젤카야노14', '1201A019-108', '러닝화', '데일리'],
    leafCategoryId: '50000830',
    restrictedCheckedAt: AT,
    aiRelevanceEnabled: false,
    createdAt: AT,
    competitorInputIds: [31],
    candidates,
    finalTags,
    ownerEdits: [],
    ...patch,
  };
}

export function competitorInput(
  patch: Partial<TagCompetitorInputItem> & { id: number },
): TagCompetitorInputItem {
  return {
    candidateId: 1,
    sourceType: 'SELLERFINDER',
    hasFrequency: true,
    itemCount: 13,
    importedAt: '2026-09-28T05:38:00.000Z',
    removedAt: null,
    tags: [],
    ...patch,
  };
}
