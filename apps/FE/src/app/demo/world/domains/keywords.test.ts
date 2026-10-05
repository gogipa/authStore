import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api, installApiRuntime } from '@/shared/api/client';
import { createDemoApi, type DemoApi } from '../../demoApi';
import { currentKeywordId } from './keywords';

/**
 * ① 키워드 '지금 고른 키워드'(D-33): 묶음에서 고른 시각이 가장 늦은 키워드 하나. 실제 BE(`selected_at` 규칙)와 같게 —
 * 고르면 지금 고른 키워드가 바뀌고, 앞서 고른 키워드의 고른 시각은 남으며(승인 이력), 같은 줄을 또 고르면 아무 일도 없다.
 * 실제 `api` 클라이언트로 화면이 보내는 요청 그대로 부른다. 시계를 손으로 움직여(`clock.ms`) 고른 시각을 정확히 본다.
 */
const SNAPSHOT = 7;
const START = 1_000_000;
/** 남성신발 '아식스 젤카야노14' */
const ASICS = 101;
/** 남성신발 1위 '뉴발란스 530'(분야·순위는 sample/keywords) */
const NEW_BALANCE = 100;
/** 여성신발 1위(다른 분야) */
const WOMEN_FIRST = 200;
/** 아동 단어로 빠진 줄 '키즈 운동화' */
const CHILD = 115;

let demo: DemoApi;
let off: () => void;
const clock = { ms: START };

beforeEach(() => {
  clock.ms = START;
  demo = createDemoApi({ now: () => clock.ms, delays: { short: 0, medium: 0, long: 0 } });
  off = installApiRuntime(demo);
});

afterEach(() => {
  off();
  expect(demo.serverErrors).toEqual([]);
  expect(demo.unknownRequests).toEqual([]);
});

const collect = async () => {
  await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
  demo.world.flush();
};
const select = (keywordId: number) =>
  api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId } } });
const unselect = (keywordId: number) =>
  api.DELETE('/keywords/{keywordId}/selection', { params: { path: { keywordId } } });
const detail = async () =>
  (
    await api.GET('/keyword-snapshots/{keywordSnapshotId}', {
      params: { path: { keywordSnapshotId: SNAPSHOT } },
    })
  ).data!;
const rows = async (cid: string) =>
  (
    await api.GET('/keyword-snapshots/{keywordSnapshotId}/keywords', {
      params: { path: { keywordSnapshotId: SNAPSHOT }, query: { cid, size: 50 } },
    })
  ).data!.content;
const selectedAtOf = async (cid: string, id: number) =>
  (await rows(cid)).find((row) => row.id === id)?.selectedAt;
const iso = (ms: number) => new Date(ms).toISOString();
const MEN = '50000174';
const WOMEN = '50000173';
const createCandidate = (sourceKeywordId: number) =>
  api.POST('/candidates', {
    body: { creationPath: 'KEYWORD', sourceKeywordId, rakutenQuery: '아식스' } as never,
  });

describe('지금 고른 키워드(selectedKeyword)', () => {
  it('고른 것이 없으면 null이다(수집 뒤 아무것도 안 골랐을 때)', async () => {
    await collect();
    expect((await detail()).selectedKeyword).toBeNull();
  });

  it('고르면 묶음 하나를 읽는 조회가 그 줄을 지금 고른 키워드로 돌려준다 — 분야·쪽과 상관없다', async () => {
    await collect();
    await select(ASICS);
    const picked = (await detail()).selectedKeyword;
    expect(picked).toMatchObject({
      id: ASICS,
      keyword: '아식스 젤카야노14',
      cid: MEN,
      selectedAt: iso(START),
    });
    // 목록 항목은 묶음 요약이라 이 값이 없다(실제 BE와 같다)
    const list = await api.GET('/keyword-snapshots', { params: { query: { size: 1 } } });
    expect(list.data?.content[0]).toMatchObject({ id: SNAPSHOT, status: 'COMPLETED' });
    expect(list.data?.content[0]).not.toHaveProperty('selectedKeyword');
    // 다른 분야(여성신발)의 줄을 고르면 묶음 전체에서 그 줄이 지금 고른 키워드다
    clock.ms += 5_000;
    await select(WOMEN_FIRST);
    expect((await detail()).selectedKeyword).toMatchObject({ id: WOMEN_FIRST, cid: WOMEN });
  });

  it('A → B → A로 고르면 지금 고른 키워드가 따라 바뀌고, 앞서 고른 줄의 고른 시각은 그대로 남는다', async () => {
    await collect();
    const a = await select(ASICS);
    expect(a.data?.selectedAt).toBe(iso(START));
    clock.ms += 5_000;
    const b = await select(NEW_BALANCE);
    expect(b.data?.selectedAt).toBe(iso(START + 5_000));
    expect((await detail()).selectedKeyword?.id).toBe(NEW_BALANCE);
    // 앞서 고른 A는 지우지 않는다(승인 이력 — 그 키워드로 만든 여정의 G1 통과 시각)
    expect(await selectedAtOf(MEN, ASICS)).toBe(iso(START));
    expect(await selectedAtOf(MEN, NEW_BALANCE)).toBe(iso(START + 5_000));

    // A를 다시 고르면 지금 고른 키워드가 A로 돌아오고 A의 고른 시각만 더 늦어진다
    clock.ms += 5_000;
    const again = await select(ASICS);
    expect(again.data?.selectedAt).toBe(iso(START + 10_000));
    expect((await detail()).selectedKeyword).toMatchObject({
      id: ASICS,
      selectedAt: iso(START + 10_000),
    });
    expect(await selectedAtOf(MEN, NEW_BALANCE)).toBe(iso(START + 5_000));
  });

  it('같은 ms 안에 다른 줄을 골라도 가장 늦은 고른 시각보다 1ms 뒤로 정해 순서가 뒤바뀌지 않는다', async () => {
    await collect();
    await select(ASICS);
    // 시계가 그대로(같은 ms)이거나 거꾸로 가도 새로 고른 키워드가 항상 가장 늦다
    const b = await select(NEW_BALANCE);
    expect(b.data?.selectedAt).toBe(iso(START + 1));
    clock.ms -= 10_000;
    const c = await select(WOMEN_FIRST);
    expect(c.data?.selectedAt).toBe(iso(START + 2));
    expect((await detail()).selectedKeyword?.id).toBe(WOMEN_FIRST);
    const backToA = await select(ASICS);
    expect(backToA.data?.selectedAt).toBe(iso(START + 3));
    expect((await detail()).selectedKeyword?.id).toBe(ASICS);
  });

  it('지금 고른 키워드를 또 고르면 아무 일도 없다(멱등) — 고른 시각이 그대로이고 바뀐 것이 없다', async () => {
    await collect();
    const first = await select(ASICS);
    const stored = structuredClone(demo.world.s.keywords.selected);
    const markedAt = demo.world.s.times.keywordSelected;
    clock.ms += 60_000;
    const second = await select(ASICS);
    expect(second.data).toEqual(first.data);
    expect(demo.world.s.keywords.selected).toEqual(stored);
    expect(demo.world.s.times.keywordSelected).toBe(markedAt);
    expect((await detail()).selectedKeyword?.selectedAt).toBe(iso(START));
  });

  it('이야기 시각표의 키워드 고름은 처음 고를 때만 남는다(다시 골라도 뒤로 밀리지 않는다)', async () => {
    await collect();
    expect(demo.world.s.times.keywordSelected).toBeUndefined();
    await select(ASICS);
    expect(demo.world.s.times.keywordSelected).toBe(START);
    clock.ms += 5_000;
    await select(NEW_BALANCE);
    expect(demo.world.s.times.keywordSelected).toBe(START);
  });

  it('같은 시각이면 id가 큰 쪽이 지금 고른 키워드이고, 고른 것이 없으면 null이다(계산 규칙)', () => {
    expect(currentKeywordId({ snapshot: null, selected: {} })).toBeNull();
    expect(currentKeywordId({ snapshot: null, selected: { 101: 5, 105: 5, 103: 4 } })).toBe(105);
    expect(currentKeywordId({ snapshot: null, selected: { 105: 5, 101: 9 } })).toBe(101);
  });
});

describe('고를 수 없는 줄', () => {
  it('아동 단어로 빠진 줄은 409 KEYWORD_EXCLUDED이고 지금 고른 키워드는 그대로다', async () => {
    await collect();
    await select(ASICS);
    clock.ms += 5_000;
    const child = await select(CHILD);
    expect(child.response.status).toBe(409);
    expect(child.error).toMatchObject({
      code: 'KEYWORD_EXCLUDED',
      message: '아동화로 빠진 키워드는 고를 수 없습니다.',
    });
    const after = await detail();
    expect(after.selectedKeyword).toMatchObject({ id: ASICS, selectedAt: iso(START) });
  });

  it('없는 id는 404 KEYWORD_NOT_FOUND이고, 수집 전에는 어떤 id도 없다', async () => {
    expect((await select(ASICS)).error).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    await collect();
    expect((await select(9999)).error).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    expect((await detail()).selectedKeyword).toBeNull();
  });
});

describe("'일본어로 바꾸기'(rakuten-query-conversions)", () => {
  const convert = (keywordId: number) =>
    api.POST('/keywords/{keywordId}/rakuten-query-conversions', {
      params: { path: { keywordId } },
    });

  it('AI를 부르지 않고 예시 검색어를 돌려준다 — 따라 하기 밖(403)이 아니고 모델은 바뀌지 않는다', async () => {
    await collect();
    const before = structuredClone(demo.world.s.keywords);
    const known = await convert(NEW_BALANCE);
    expect(known.response.status).toBe(200);
    expect(known.data).toEqual({
      keywordId: NEW_BALANCE,
      keyword: '뉴발란스 530',
      rakutenQuery: 'ニューバランス 530',
      engineCode: 'CLAUDE',
      model: 'sonnet',
    });
    expect((await convert(ASICS)).data?.rakutenQuery).toBe('アシックス ゲルカヤノ14');
    // 예시에 없는 키워드(남성신발 '리복 클럽C')는 신발 일반어
    expect((await convert(119)).data?.rakutenQuery).toBe('スニーカー');
    expect(demo.world.s.keywords).toEqual(before);
    expect(demo.readOnlyRequests).toEqual([]);
  });

  it('수집 전·없는 id는 404 KEYWORD_NOT_FOUND, 아동 단어로 빠진 줄은 409 KEYWORD_EXCLUDED', async () => {
    expect((await convert(ASICS)).error).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    await collect();
    expect((await convert(9999)).error).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    const child = await convert(CHILD);
    expect(child.response.status).toBe(409);
    expect(child.error).toMatchObject({ code: 'KEYWORD_EXCLUDED' });
  });
});

describe('여정 만들기와 고르기 취소(남겨 둔 DELETE)', () => {
  it('고른 적 없는 키워드로는 여정을 못 만들고(KEYWORD_NOT_SELECTED), 앞서 고른 키워드는 막지 않는다', async () => {
    await collect();
    await select(ASICS);
    clock.ms += 5_000;
    await select(NEW_BALANCE);
    expect((await createCandidate(WOMEN_FIRST)).error).toMatchObject({
      code: 'KEYWORD_NOT_SELECTED',
    });
    // 화면은 지금 고른 키워드만 보내지만, 앞서 고른 키워드(selected_at이 있음)를 보내도 막지 않는다
    const made = await createCandidate(ASICS);
    expect(made.response.status).toBe(201);
    expect(made.data).toMatchObject({ sourceKeyword: '아식스 젤카야노14' });
  });

  it('여정의 G1은 그 키워드를 고른 시각으로 남는다 — 다른 줄로 바꿔도 그대로다', async () => {
    await collect();
    await select(ASICS);
    expect((await createCandidate(ASICS)).response.status).toBe(201);
    clock.ms += 5_000;
    await select(NEW_BALANCE);
    const gates = await api.GET('/candidates/{candidateId}/gates', {
      params: { path: { candidateId: 1 } },
    });
    expect(gates.data?.items.find((gate) => gate.gate === 'G1')).toMatchObject({
      passed: true,
      passedAt: iso(START),
    });
  });

  it('여정이 생긴 키워드는 다른 키워드를 고른 뒤에도 취소할 수 없다(KEYWORD_IN_USE)', async () => {
    await collect();
    await select(ASICS);
    expect((await createCandidate(ASICS)).response.status).toBe(201);
    clock.ms += 5_000;
    await select(NEW_BALANCE);
    expect((await detail()).selectedKeyword?.id).toBe(NEW_BALANCE);
    const blocked = await unselect(ASICS);
    expect(blocked.response.status).toBe(409);
    expect(blocked.error).toMatchObject({
      code: 'KEYWORD_IN_USE',
      details: { keywordId: ASICS, candidateIds: [1] },
    });
    // 취소가 막혔으니 고른 시각도 그대로고, 여정 있음 표시도 남는다
    expect(await selectedAtOf(MEN, ASICS)).toBe(iso(START));
    const asics = (await rows(MEN)).find((row) => row.id === ASICS);
    expect(asics?.candidateIds).toEqual([1]);
    expect((await detail()).selectedKeyword?.id).toBe(NEW_BALANCE);
  });

  it('지금 고른 키워드를 비우면(DELETE) 그다음으로 늦게 고른 키워드가 지금 고른 키워드가 된다', async () => {
    await collect();
    await select(ASICS);
    clock.ms += 5_000;
    await select(NEW_BALANCE);
    clock.ms += 5_000;
    await select(WOMEN_FIRST);
    expect((await detail()).selectedKeyword?.id).toBe(WOMEN_FIRST);

    expect((await unselect(WOMEN_FIRST)).response.status).toBe(204);
    expect((await detail()).selectedKeyword?.id).toBe(NEW_BALANCE);
    expect((await unselect(NEW_BALANCE)).response.status).toBe(204);
    expect((await detail()).selectedKeyword).toMatchObject({ id: ASICS, selectedAt: iso(START) });
    expect((await unselect(ASICS)).response.status).toBe(204);
    expect((await detail()).selectedKeyword).toBeNull();
    // 이미 비어 있어도 204(멱등)
    expect((await unselect(ASICS)).response.status).toBe(204);
  });
});

describe('따라 하기 띠', () => {
  it('고른 키워드가 있으면 ① 고르기는 된 일이고, 비우면 다시 고르라고 한다', async () => {
    await collect();
    expect(demo.world.progress().next?.id).toBe('useKeyword');
    await select(ASICS);
    expect(demo.world.progress()).toMatchObject({ done: 2, next: { id: 'startSourcing' } });
    // 다른 줄로 바꿔도 띠는 [이 검색어로 소싱]을 가리킨다(고름은 하나로 이어진다)
    clock.ms += 5_000;
    await select(NEW_BALANCE);
    expect(demo.world.progress()).toMatchObject({ done: 2, next: { id: 'startSourcing' } });
    await unselect(NEW_BALANCE);
    expect(demo.world.progress().next?.id).toBe('startSourcing');
    await unselect(ASICS);
    expect(demo.world.progress()).toMatchObject({ done: 1, next: { id: 'useKeyword' } });
  });
});
