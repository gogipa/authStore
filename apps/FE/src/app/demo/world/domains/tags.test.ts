import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../../demoApi';
import { reachSourcingSearch, reachThumbnailDone, startDemoKit } from '../testkit';

/** ⑦ 태그(D-32): 눌러서 실행 → 지연 뒤 COMPLETED. 경쟁 태그는 넣지 않는다(빈 목록 · 추천 태그만으로 최종 10개). */
let demo: DemoApi;
let off: () => void;

beforeEach(() => {
  ({ demo, off } = startDemoKit());
});

afterEach(() => {
  off();
  expect(demo.serverErrors).toEqual([]);
  expect(demo.unknownRequests).toEqual([]);
});

const candidateId = 1;
const path = { params: { path: { candidateId } } };

const tagItem = async () => {
  const res = await api.GET('/candidates/{candidateId}/steps', path);
  return res.data!.items.find((item) => item.stepCode === 'TAGS')!;
};
const tagSet = (query: { stepRunId?: number } = {}) =>
  api.GET('/candidates/{candidateId}/tag-set', { params: { path: { candidateId }, query } });
const runTags = () =>
  api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
    params: { path: { candidateId, stepCode: 'TAGS' } },
    body: {},
  });

const FINAL_TEXTS = [
  '젤카야노14',
  '아식스운동화',
  '조깅화',
  '남자운동화',
  '데일리운동화',
  '레트로운동화',
  '크림운동화',
  '쿠션운동화',
  '가벼운운동화',
  '커플운동화',
];

describe('⑦ 태그', () => {
  it('실행 전: tag-set은 404 STEP_OUTPUT_NOT_FOUND, 경쟁 태그 입력 목록은 빈 목록(200)', async () => {
    await reachThumbnailDone(demo);
    const res = await tagSet();
    expect(res.response.status).toBe(404);
    expect(res.error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ⑦ 태그를 실행하지 않았습니다.',
      details: { stepCode: 'TAGS' },
    });
    const inputs = await api.GET('/candidates/{candidateId}/tag-competitor-inputs', path);
    expect(inputs.response.status).toBe(200);
    expect(inputs.data).toEqual({ items: [] });
    // 입력 대기가 없고 [실행]이 켜져 있다
    expect((await tagItem()).actions.run.enabled).toBe(true);
  });

  it('[실행] 202 → 실행중(산출물 404) → 완료: 최종 10개, 레일 현재 실행과 같은 stepRunId', async () => {
    await reachThumbnailDone(demo);
    const started = await runTags();
    expect(started.response.status).toBe(202);
    expect(started.data).toMatchObject({
      stepCode: 'TAGS',
      version: 1,
      status: 'RUNNING',
      aiEngine: null,
    });
    expect(await tagItem()).toMatchObject({
      status: 'RUNNING',
      currentStepRunId: started.data!.stepRunId,
    });
    expect((await tagSet()).error).toMatchObject({ code: 'STEP_OUTPUT_NOT_FOUND' });
    // 실행 중에는 다시 누를 수 없다
    expect((await runTags()).error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 이미 실행 중입니다.',
    });

    demo.world.flush();
    const item = await tagItem();
    expect(item.status).toBe('COMPLETED');
    const out = (await tagSet()).data!;
    expect(out).toMatchObject({
      stepRunId: item.currentStepRunId,
      version: 1,
      stepRunStatus: 'COMPLETED',
      isCurrent: true,
      competitorInputIds: [],
      aiRelevanceEnabled: false,
      ownerEdits: [],
      recommendKeywords: ['아식스 젤카야노14', '1201A019-108', '러닝화', '데일리'],
    });
    expect(out.leafCategoryId).toBe(
      (await api.GET('/candidates/{candidateId}', path)).data!.leafCategoryId,
    );
    expect(out.finalTags.map((tag) => tag.text)).toEqual(FINAL_TEXTS);
    expect(out.finalTags.map((tag) => tag.finalOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // 경쟁 태그 입력이 없으니 후보는 모두 추천 태그다
    expect(out.candidates.every((c) => c.inRecommend && !c.inCompetitor && !c.ownerAdded)).toBe(
      true,
    );
    expect(out.candidates.every((c) => c.competitorFrequency === null)).toBe(true);
    expect(out.candidates.filter((c) => c.outcome === 'SELECTED')).toHaveLength(10);
    expect(out.candidates.filter((c) => c.outcome === 'FILTERED')).toHaveLength(4);
    expect(out.candidates.find((c) => c.text === '정품운동화')).toMatchObject({
      outcome: 'RESTRICTED',
      restricted: true,
    });
    expect(new Set(out.candidates.map((c) => c.id)).size).toBe(out.candidates.length);
  });

  it('다시 실행하면 새 버전, 옛 버전은 ?stepRunId=로 읽힌다', async () => {
    await reachThumbnailDone(demo);
    const first = await runTags();
    demo.world.flush();
    const second = await runTags();
    expect(second.data!.version).toBe(2);
    demo.world.flush();
    expect((await tagSet()).data).toMatchObject({ version: 2, isCurrent: true });
    expect((await tagSet({ stepRunId: first.data!.stepRunId })).data).toMatchObject({
      version: 1,
      isCurrent: false,
    });
    expect((await tagSet({ stepRunId: 99999 })).error).toMatchObject({
      code: 'STEP_RUN_NOT_FOUND',
    });
  });

  it('여정을 만들기 전에는 실제 BE처럼 404 CANDIDATE_NOT_FOUND, ② 전에는 시작 조건에 막힌다', async () => {
    expect((await runTags()).error).toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
    await reachSourcingSearch(demo);
    const blocked = await runTags();
    expect(blocked.response.status).toBe(409);
    expect(blocked.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ② 모델명·상품유형, 성별.',
    });
  });

  it('경쟁 태그 입력(POST·DELETE)과 태그 추가·삭제(owner-edits)는 체험에서 403 안내다', async () => {
    await reachThumbnailDone(demo);
    await runTags();
    demo.world.flush();
    const create = await api.POST('/candidates/{candidateId}/tag-competitor-inputs', {
      ...path,
      body: { sourceType: 'FREE_TEXT', text: '러닝화, 조깅화' },
    });
    expect(create.response.status).toBe(403);
    expect(create.error).toMatchObject({ code: 'DEMO_READ_ONLY' });
    const remove = await api.DELETE('/tag-competitor-inputs/{inputId}', {
      params: { path: { inputId: 1 } },
    });
    expect(remove.response.status).toBe(403);
    const edit = await api.POST('/candidates/{candidateId}/steps/{stepCode}/owner-edits', {
      params: { path: { candidateId, stepCode: 'TAGS' } },
      body: { ownerAction: 'EDIT', baseStepRunId: 1, add: ['신발'], remove: [] },
    });
    expect(edit.response.status).toBe(403);
    expect(demo.readOnlyRequests).toEqual([
      'POST /candidates/1/tag-competitor-inputs',
      'DELETE /tag-competitor-inputs/1',
      'POST /candidates/1/steps/TAGS/owner-edits',
    ]);
  });
});
