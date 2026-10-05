import { get, type DemoRoute } from '../../router';
import { tagCompetitorInputs, tagSet } from '../../sample/tags';
import { currentRun } from '../engine';
import type { RunOutcome, StepRunner } from '../runner';
import { resolveOutputRun } from './outputs';

/**
 * ⑦ 태그: 시드 키워드·② 모델명·상품유형으로 추천 태그를 받아 규칙 필터·제한 태그 확인을 거쳐 최종 10개를 고른다. 눌러서 실행한 뒤
 * 지연 뒤 COMPLETED가 된다(입력 대기가 없다 — 경쟁 태그 입력은 선택).
 * - 따라 하기에서는 경쟁 태그를 넣지 않는다: 조회는 빈 목록이고, 경쟁 태그 입력(POST·DELETE)·태그 추가·삭제(owner-edits)는 만들지 않는다
 *   (체험에서는 403 안내)
 * - 산출물은 COMPLETED로 끝난 실행에만 있다. 새 실행이 RUNNING인 동안은 404 `STEP_OUTPUT_NOT_FOUND`다.
 */
export interface TagsState {
  /** 산출물(tag_set)을 낸 실행 id */
  outputs: number[];
}

export const initialTags = (): TagsState => ({ outputs: [] });

export const tagsRunner: StepRunner = {
  stepCode: 'TAGS',
  delay: 'medium',
  outcome: (): RunOutcome => ({ status: 'COMPLETED' }),
  onSettled(w, outcome) {
    const run = currentRun(w, 'TAGS');
    if (outcome.status !== 'COMPLETED' || !run) return;
    if (!w.s.tags.outputs.includes(run.id)) w.s.tags.outputs.push(run.id);
  },
};

export const tagsRoutes: DemoRoute[] = [
  get('/candidates/{candidateId}/tag-set', ({ world, query }) => {
    const { run, isCurrent } = resolveOutputRun(world, 'TAGS', query, world.s.tags.outputs);
    return tagSet(world, run, isCurrent);
  }),
  get('/candidates/{candidateId}/tag-competitor-inputs', () => tagCompetitorInputs()),
];
