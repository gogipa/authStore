import { tagCandidate, tagSetOutput } from '@/test/fixtures/tags';
import type { DemoWorld } from '../demoWorld';
import type { RunRec } from '../world/state';
import { DEMO_IDS, STORY } from './story';
import type { Ok, Schema } from './types';

type TagCandidateItem = Schema<'TagCandidateItem'>;

/**
 * ⑦ 후보표(화면시안_명세 §4 태그 예 — 최종 10 · 순위 밖 1 · 뺌 5). 따라 하기에서는 경쟁 태그를 넣지 않으므로 모두 추천 태그다
 * (실제 BE도 경쟁 태그가 없으면 추천 태그만으로 고른다). 추천 태그 ID(`code`)는 가짜 번호다.
 */
const FINAL_TAGS: readonly [text: string, code: string][] = [
  ['젤카야노14', '10010001'],
  ['아식스운동화', '10010002'],
  ['조깅화', '10010003'],
  ['남자운동화', '10010004'],
  ['데일리운동화', '10010008'],
  ['레트로운동화', '10010009'],
  ['크림운동화', '10010010'],
  ['쿠션운동화', '10010011'],
  ['가벼운운동화', '10010012'],
  ['커플운동화', '10010006'],
];

function candidates(run: RunRec): TagCandidateItem[] {
  const base = run.id * 100;
  const recommended = { inRecommend: true } as const;
  const rows: (Partial<TagCandidateItem> & { text: string })[] = [
    ...FINAL_TAGS.map(([text, code], index) => ({
      text,
      ...recommended,
      code,
      outcome: 'SELECTED' as const,
      finalOrder: index + 1,
      restricted: false,
    })),
    { text: '데일리룩', ...recommended, code: '10010007', restricted: false },
    {
      text: '나이키운동화',
      ...recommended,
      code: '10010013',
      outcome: 'FILTERED',
      filterReason: 'BRAND_NAME',
      filterDetail: '다른 브랜드명(나이키)',
    },
    {
      text: '무료배송',
      ...recommended,
      code: '10010014',
      outcome: 'FILTERED',
      filterReason: 'PROMOTION',
      filterDetail: '홍보·배송 문구(무료배송)',
    },
    {
      text: '키즈운동화',
      ...recommended,
      code: '10010015',
      outcome: 'FILTERED',
      filterReason: 'ATTRIBUTE_MISMATCH',
      filterDetail: '아동 단어(키즈) · 성별·용도 불일치',
    },
    {
      text: '정품운동화',
      ...recommended,
      code: '10010016',
      outcome: 'RESTRICTED',
      restricted: true,
    },
    {
      text: '러닝화',
      ...recommended,
      code: '10010005',
      outcome: 'FILTERED',
      filterReason: 'CATEGORY_TOKEN',
      filterDetail: '카테고리 이름(러닝화)과 같음',
    },
  ];
  return rows.map((row, index) => tagCandidate({ ...row, id: base + index + 1 }));
}

/** ⑦ 태그 한 버전(경쟁 태그 입력 없음 — `competitorInputIds: []`) */
export function tagSet(
  w: DemoWorld,
  run: RunRec,
  isCurrent: boolean,
): Ok<'/candidates/{candidateId}/tag-set'> {
  const at = new Date(run.endedAt ?? w.now()).toISOString();
  return tagSetOutput({
    stepRunId: run.id,
    candidateId: w.candidate().id,
    version: run.version,
    stepRunStatus: run.status,
    isCurrent,
    tagSetId: DEMO_IDS.tagSet + run.version - 1,
    recommendKeywords: [STORY.sourceKeyword, '1201A019-108', '러닝화', '데일리'],
    leafCategoryId: w.candidate().leafCategoryId,
    restrictedCheckedAt: at,
    createdAt: at,
    competitorInputIds: [],
    candidates: candidates(run),
    ownerEdits: [],
  });
}

/** 최종 태그(승인 미리보기가 같은 값을 보인다) */
export function finalTags(w: DemoWorld, run: RunRec): Schema<'FinalTagItem'>[] {
  return tagSet(w, run, true).finalTags;
}

/** 경쟁 태그 입력 목록: 따라 하기에서는 넣지 않는다(빈 목록) */
export function tagCompetitorInputs(): Ok<'/candidates/{candidateId}/tag-competitor-inputs'> {
  return { items: [] };
}
