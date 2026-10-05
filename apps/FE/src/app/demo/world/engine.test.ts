import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { api } from '@/shared/api/client';
import type { DemoApi } from '../demoApi';
import { reachSourcingDone, reachSourcingSearch, startDemoKit } from './testkit';

/**
 * 따라 하기 모델의 엔진·① 키워드·② 소싱(D-32). 모두 실제 `api` 클라이언트로 부른다 — 화면이 보내는 요청 그대로.
 * 지연은 0이고 `world.flush()`가 맡겨 둔 결과를 지금 낸다.
 */
let demo: DemoApi;
let off: () => void;

beforeEach(() => {
  ({ demo, off } = startDemoKit());
});

afterEach(() => {
  off();
  // 모델이 예상 밖 오류(500)를 내지 않았고, 표에 없는 조회도 없었다
  expect(demo.serverErrors).toEqual([]);
  expect(demo.unknownRequests).toEqual([]);
});

const candidateId = 1;
const path = { params: { path: { candidateId } } };

async function stepOf(code: string) {
  const rail = await api.GET('/candidates/{candidateId}/steps', path);
  return rail.data!.items.find((item) => item.stepCode === code)!;
}

describe('빈 상태에서 시작', () => {
  it('여정·키워드·이어 할 곳이 모두 비어 있고, 여정 주소는 실제 BE처럼 404 CANDIDATE_NOT_FOUND', async () => {
    const list = await api.GET('/candidates', { params: { query: { size: 100 } } });
    expect(list.data?.content).toEqual([]);
    const counts = await api.GET('/candidates/status-counts');
    expect(counts.data?.items.every((item) => item.count === 0)).toBe(true);
    expect((await api.GET('/candidates/resume-target')).response.status).toBe(204);
    const attention = await api.GET('/candidate-steps');
    expect(attention.data?.content).toEqual([]);

    const snapshots = await api.GET('/keyword-snapshots', { params: { query: { size: 1 } } });
    expect(snapshots.data?.content).toEqual([]);
    const status = await api.GET('/keyword-collection-status');
    expect(status.data).toMatchObject({
      collecting: false,
      lastKeywordSnapshotId: null,
      lastCollectedAt: null,
      disabledReasonCode: null,
    });

    const detail = await api.GET('/candidates/{candidateId}', path);
    expect(detail.response.status).toBe(404);
    expect(detail.error).toMatchObject({
      code: 'CANDIDATE_NOT_FOUND',
      message: '여정을 찾을 수 없습니다.',
    });
    const run = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'SOURCING' } },
      body: {},
    });
    expect(run.error).toMatchObject({ code: 'CANDIDATE_NOT_FOUND' });
  });

  it('오늘 조회 수는 0에서 시작해 한 일만큼 늘어난다(빈 상태 그대로)', async () => {
    const usage = async () => {
      const res = await api.GET('/call-usage');
      return Object.fromEntries(res.data!.items.map((item) => [item.target, item.count]));
    };
    expect(await usage()).toMatchObject({ RAKUTEN_PAGE: 0, RAKUTEN_API: 0, DATALAB: 0 });
    await reachSourcingDone(demo);
    // 검색 1번(상품 검색 2호출) · 앵커 뒤 상품 페이지 4건 · 데이터랩 수집 10요청
    expect(await usage()).toMatchObject({ RAKUTEN_PAGE: 4, RAKUTEN_API: 2, DATALAB: 10 });
  });

  it('시작 준비 5개 값(설정·키·프로필·AI 엔진)은 처음부터 모두 완료다', async () => {
    const secrets = await api.GET('/secrets');
    expect(secrets.data?.items.every((s) => s.configured)).toBe(true);
    const profile = await api.GET('/purchase-agency-profile');
    expect(profile.data?.missingFields).toEqual([]);
    const latest = await api.GET('/ai-cli-checks/latest');
    expect(latest.data?.items.map((i) => [i.engineCode, i.latest?.smokeStatus])).toEqual(
      expect.arrayContaining([
        ['CLAUDE', 'PASSED'],
        ['AGY', 'PASSED'],
      ]),
    );
    expect(demo.world.progress()).toMatchObject({ done: 0, next: { id: 'collect' } });
  });
});

describe('① 키워드', () => {
  it('[수집]은 202로 접수하고 받는 동안 다시 누르면 409, 끝나면 40줄(제외 1)이 된다', async () => {
    const events: string[] = [];
    demo.world.onEvent((name) => events.push(name));
    const collect = await api.POST('/keyword-snapshots', {
      body: { method: 'BUTTON', rankLimit: 100 } as never,
    });
    expect(collect.response.status).toBe(202);
    expect(collect.data).toMatchObject({
      status: 'RUNNING',
      rankLimit: 100,
      requestedCids: ['50000173', '50000174'],
    });
    expect((await api.GET('/keyword-collection-status')).data).toMatchObject({
      collecting: true,
      disabledReasonCode: 'ALREADY_IN_PROGRESS',
    });
    const again = await api.POST('/keyword-snapshots', {
      body: { method: 'BUTTON', rankLimit: 100 } as never,
    });
    expect(again.response.status).toBe(409);
    expect(again.error).toMatchObject({
      code: 'ALREADY_IN_PROGRESS',
      message: '데이터랩 수집이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
    });
    expect(demo.world.progress().busy).toBe(true);

    demo.world.flush();
    const done = await api.GET('/keyword-snapshots/{keywordSnapshotId}', {
      params: { path: { keywordSnapshotId: 7 } },
    });
    expect(done.data).toMatchObject({ status: 'COMPLETED', keywordCount: 40, excludedCount: 1 });
    expect(events.filter((e) => e === 'keyword-collection.progress')).toHaveLength(10);
    expect(events.at(-1)).toBe('keyword-collection.completed');
    expect((await api.GET('/keyword-collection-status')).data).toMatchObject({
      collecting: false,
      lastStatus: 'COMPLETED',
    });
    expect(demo.world.progress()).toMatchObject({ done: 1, busy: false });
    expect(demo.world.progress().next?.id).toBe('useKeyword');
  });

  it('붙여넣기 수집은 따라 하기 길이 아니라 403 체험 글', async () => {
    const paste = await api.POST('/keyword-snapshots', {
      body: { method: 'PASTE', text: '1 뉴발란스 530', cid: null } as never,
    });
    expect(paste.response.status).toBe(403);
    expect(paste.error).toMatchObject({ code: 'DEMO_READ_ONLY' });
    expect(demo.readOnlyRequests).toEqual(['POST /keyword-snapshots']);
  });

  it('키워드는 받은 만큼만 보이고(페이지마다 늘어난다), 아동 단어 줄은 제외됨에만 있다', async () => {
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    expect(
      (
        await api.GET('/keyword-snapshots/{keywordSnapshotId}/keywords', {
          params: { path: { keywordSnapshotId: 7 }, query: { excluded: false } },
        })
      ).data?.page.totalElements,
    ).toBe(0);
    demo.world.flush();
    const men = await api.GET('/keyword-snapshots/{keywordSnapshotId}/keywords', {
      params: {
        path: { keywordSnapshotId: 7 },
        query: { cid: '50000174', excluded: false, size: 50 },
      },
    });
    expect(men.data?.content).toHaveLength(19);
    expect(men.data?.content.map((k) => k.keyword)).not.toContain('키즈 운동화');
    expect(men.data?.content[1]).toMatchObject({ id: 101, rank: 2, keyword: '아식스 젤카야노14' });
    const excluded = await api.GET('/keyword-snapshots/{keywordSnapshotId}/keywords', {
      params: { path: { keywordSnapshotId: 7 }, query: { excluded: true } },
    });
    expect(excluded.data?.content.map((k) => [k.keyword, k.excludedReason])).toEqual([
      ['키즈 운동화', 'CHILD'],
    ]);
  });

  it('G1: 고르기는 멱등이고, 아동화는 409, 여정을 만든 키워드는 취소할 수 없다', async () => {
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    demo.world.flush();
    const first = await api.PUT('/keywords/{keywordId}/selection', {
      params: { path: { keywordId: 101 } },
    });
    const second = await api.PUT('/keywords/{keywordId}/selection', {
      params: { path: { keywordId: 101 } },
    });
    expect(first.data?.selectedAt).toBe(second.data?.selectedAt);
    const child = await api.PUT('/keywords/{keywordId}/selection', {
      params: { path: { keywordId: 115 } },
    });
    expect(child.error).toMatchObject({
      code: 'KEYWORD_EXCLUDED',
      message: '아동화로 빠진 키워드는 고를 수 없습니다.',
    });
    const missing = await api.PUT('/keywords/{keywordId}/selection', {
      params: { path: { keywordId: 9999 } },
    });
    expect(missing.error).toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    expect(demo.world.progress().next?.id).toBe('startSourcing');

    const created = await api.POST('/candidates', {
      body: {
        creationPath: 'KEYWORD',
        sourceKeywordId: 101,
        rakutenQuery: '아식스 젤카야노14',
      } as never,
    });
    expect(created.response.status).toBe(201);
    const unselect = await api.DELETE('/keywords/{keywordId}/selection', {
      params: { path: { keywordId: 101 } },
    });
    expect(unselect.error).toMatchObject({ code: 'KEYWORD_IN_USE' });
    const row = await api.GET('/keyword-snapshots/{keywordSnapshotId}/keywords', {
      params: { path: { keywordSnapshotId: 7 }, query: { cid: '50000174' } },
    });
    expect(row.data?.content.find((k) => k.id === 101)?.candidateIds).toEqual([candidateId]);
  });

  it('여정 만들기: 고르지 않은 키워드·없는 키워드·긴 검색어는 실제 BE의 오류, 두 번째 여정은 막는다', async () => {
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    demo.world.flush();
    const body = (sourceKeywordId: number, rakutenQuery = '아식스') =>
      ({ creationPath: 'KEYWORD', sourceKeywordId, rakutenQuery }) as never;
    const notSelected = await api.POST('/candidates', { body: body(101) });
    expect(notSelected.error).toMatchObject({
      code: 'KEYWORD_NOT_SELECTED',
      message: '키워드 화면에서 고른 키워드만 여정으로 만들 수 있습니다.',
    });
    expect((await api.POST('/candidates', { body: body(9999) })).error).toMatchObject({
      code: 'KEYWORD_NOT_FOUND',
    });
    await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 101 } } });
    expect(
      (await api.POST('/candidates', { body: body(101, 'あ'.repeat(70)) })).error,
    ).toMatchObject({
      code: 'RAKUTEN_QUERY_INVALID',
    });
    const created = await api.POST('/candidates', { body: body(101) });
    expect(created.data).toMatchObject({
      id: candidateId,
      status: 'WORKING',
      creationPath: 'KEYWORD',
      sourceKeyword: '아식스 젤카야노14',
      displayName: '아식스',
      resumeStepCode: 'SOURCING',
      itemCode: null,
      anchorFixedAt: null,
      locked: false,
    });
    const twice = await api.POST('/candidates', { body: body(101) });
    expect(twice.response.status).toBe(409);
    expect(twice.error).toMatchObject({ code: 'CANDIDATE_DUPLICATE' });
  });
});

describe('여정이 생긴 직후(단계 레일·목록·대시보드)', () => {
  beforeEach(async () => {
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    demo.world.flush();
    await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 101 } } });
    await api.POST('/candidates', {
      body: {
        creationPath: 'KEYWORD',
        sourceKeywordId: 101,
        rakutenQuery: '아식스 젤카야노14',
      } as never,
    });
  });

  it('레일 10칸은 모두 미실행이고 ②만 실행할 수 있다(BE 시작 조건·꺼진 이유 그대로)', async () => {
    const rail = await api.GET('/candidates/{candidateId}/steps', path);
    expect(rail.data?.items.map((i) => [i.stepCode, i.status, i.lastVersion])).toEqual(
      [
        'SOURCING',
        'PRICING',
        'CATEGORY',
        'THUMBNAIL',
        'COPY',
        'NOTICE_RAW',
        'NOTICE_HTML',
        'TAGS',
        'UPLOAD',
        'REGISTER',
      ].map((code) => [code, 'NOT_RUN', 0]),
    );
    const byCode = (code: string) => rail.data!.items.find((i) => i.stepCode === code)!;
    expect(byCode('SOURCING').actions.run).toEqual({ enabled: true, disabledReason: null });
    expect(byCode('PRICING').actions.run.disabledReason).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ② 목표 사이즈 SKU가·재고, 성별.',
    });
    expect(byCode('NOTICE_HTML').actions.run.disabledReason?.message).toBe(
      '시작에 필요한 값이 없습니다: ② 모델명·상품유형, ⑥-1 카피, ⑥-2 원산지·소재, ③ 판매 사이즈, 성별.',
    );
    expect(byCode('UPLOAD').actions.run.disabledReason?.message).toBe(
      '시작에 필요한 값이 없습니다: ⑤ 선택본, ⑥-3 HTML.',
    );
    expect(byCode('REGISTER').actions.run.disabledReason).toMatchObject({
      code: 'INVALID_STEP_CODE',
      message: '최종 승인(G4)에서만 등록합니다.',
    });
    expect(byCode('CATEGORY').actions.continuousRun.disabledReason?.code).toBe(
      'CONTINUOUS_RUN_BEFORE_G2',
    );
    expect(byCode('SOURCING').actions.edit.disabledReason?.code).toBe('INVALID_STEP_CODE');
    expect(byCode('COPY').actions.edit.disabledReason).toMatchObject({
      code: 'STEP_NOT_COMPLETED',
      message: '⑥-1 카피가 아직 완료되지 않았습니다(지금: 미실행).',
    });
    expect(byCode('THUMBNAIL').warnings[0]?.code).toBe('PRE_G2_AI_COST');
    expect(byCode('TAGS').warnings[0]?.code).toBe('CATEGORY_UNDECIDED');
  });

  it('순서를 어기면 실제 BE의 409(시작 조건)와 레일 꺼진 이유가 같다', async () => {
    const run = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'PRICING' } },
      body: {},
    });
    expect(run.response.status).toBe(409);
    expect(run.error).toMatchObject({
      code: 'STEP_START_CONDITION_UNMET',
      message: '시작에 필요한 값이 없습니다: ② 목표 사이즈 SKU가·재고, 성별.',
      fieldErrors: [
        { field: 'sourcing.targetSkus', message: '② 목표 사이즈 SKU가·재고 값이 필요합니다.' },
        { field: 'candidate.gender', message: '성별 값이 필요합니다.' },
      ],
    });
    // 실행 기록을 만들지 않았다
    expect((await stepOf('PRICING')).lastVersion).toBe(0);
    const reg = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'REGISTER' } },
      body: {},
    });
    expect(reg.error).toMatchObject({ code: 'INVALID_STEP_CODE' });
    const chain = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'CATEGORY' },
    });
    expect(chain.error).toMatchObject({ code: 'CONTINUOUS_RUN_BEFORE_G2' });
  });

  it('목록·이어 할 곳·진행 중에 방금 만든 여정이 보인다', async () => {
    const list = await api.GET('/candidates', { params: { query: { size: 100 } } });
    expect(list.data?.content).toHaveLength(1);
    expect(list.data?.content[0]).toMatchObject({
      id: candidateId,
      status: 'WORKING',
      resumeStepCode: 'SOURCING',
    });
    expect(list.data?.content[0]?.steps.every((s) => s.status === 'NOT_RUN')).toBe(true);
    const counts = await api.GET('/candidates/status-counts');
    expect(counts.data?.items.find((i) => i.status === 'WORKING')?.count).toBe(1);
    expect((await api.GET('/candidates/resume-target')).data).toMatchObject({
      candidateId,
      stepCode: 'SOURCING',
      stepStatus: 'NOT_RUN',
      gate: null,
    });
    const filtered = await api.GET('/candidates', {
      params: { query: { runnableStep: 'PRICING', size: 100 } },
    });
    expect(filtered.data?.content).toEqual([]);
    const sourcing = await api.GET('/candidates', {
      params: { query: { runnableStep: 'SOURCING', size: 100 } },
    });
    expect(sourcing.data?.content).toHaveLength(1);
    const history = await api.GET('/candidates/{candidateId}/status-history', path);
    expect(history.data?.content.map((h) => [h.fromStatus, h.toStatus, h.reason])).toEqual([
      [null, 'WORKING', 'CREATED'],
    ]);
    const gates = await api.GET('/candidates/{candidateId}/gates', path);
    expect(gates.data?.items.map((g) => [g.gate, g.passed])).toEqual([
      ['G1', true],
      ['G2', false],
      ['G3', false],
      ['G4', false],
    ]);
    expect(demo.world.progress()).toMatchObject({ done: 3, candidateId });
  });
});

describe('② 소싱', () => {
  it('[실행] → 실행 중(비교표 404, 다시 누르면 409) → 입력 대기(앵커) → 앵커 → 페이지 조회 → 고르기 = 완료', async () => {
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    demo.world.flush();
    await api.PUT('/keywords/{keywordId}/selection', { params: { path: { keywordId: 101 } } });
    await api.POST('/candidates', {
      body: {
        creationPath: 'KEYWORD',
        sourceKeywordId: 101,
        rakutenQuery: '아식스 젤카야노14',
      } as never,
    });

    const run = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'SOURCING' } },
      body: {},
    });
    expect(run.response.status).toBe(202);
    expect(run.data).toMatchObject({ stepCode: 'SOURCING', version: 1, status: 'RUNNING' });
    expect((await stepOf('SOURCING')).status).toBe('RUNNING');

    const early = await api.GET('/candidates/{candidateId}/sourcing-comparison', path);
    expect(early.response.status).toBe(404);
    expect(early.error).toMatchObject({
      code: 'STEP_OUTPUT_NOT_FOUND',
      message: '아직 ② 소싱을 실행하지 않았습니다.',
    });
    const double = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'SOURCING' } },
      body: {},
    });
    expect(double.error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 이미 실행 중입니다.',
    });
    expect((await stepOf('SOURCING')).actions.run.disabledReason?.message).toBe(
      '이 단계가 이미 실행 중입니다.',
    );
    expect(demo.world.progress().busy).toBe(true);

    demo.world.flush();
    const search = await api.GET('/candidates/{candidateId}/sourcing-comparison', path);
    expect(search.data).toMatchObject({
      stepStatus: 'WAITING_INPUT',
      exploreMode: true,
      anchorInputMethod: null,
      anchorModelCode: null,
    });
    // 검색 결과 8줄(상품 고르기 목록 — 관련도 순), 모두 미검증·같은 상품인지 판정 전, 사진은 없다
    expect(search.data?.rows).toHaveLength(8);
    expect(search.data?.rows.every((r) => !r.isVerified && r.anchorMatch === null)).toBe(true);
    expect(search.data?.rows.map((r) => r.shopName)).toEqual([
      'ショップL',
      'ショップJ',
      'ショップC',
      'ショップB',
      'ショップA',
      'ショップW',
      'ショップH',
      'ショップK',
    ]);
    expect(search.data?.rows.every((r) => r.imageUrl === null)).toBe(true);
    // 상품명에 모델 번호가 있으면 목록이 보인다(ショップK는 없다)
    expect(search.data?.rows.map((r) => r.modelCodeNorm)).toEqual([
      '1201A019',
      '1201A019',
      '1201A019',
      '1201A019',
      '1201A019',
      '1201A019',
      '1201A019',
      null,
    ]);
    expect((await stepOf('SOURCING')).status).toBe('WAITING_INPUT');
    const waiting = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'SOURCING' } },
      body: {},
    });
    expect(waiting.error).toMatchObject({
      code: 'STEP_ALREADY_RUNNING',
      message: '이 단계가 입력을 기다리고 있습니다. 입력을 마치면 이어서 실행됩니다.',
    });
    // 입력 대기 단계가 대시보드 '재실행 필요·멈춘 여정'에 보인다
    const attention = await api.GET('/candidate-steps');
    expect(attention.data?.content.map((a) => [a.stepCode, a.status])).toEqual([
      ['SOURCING', 'WAITING_INPUT'],
    ]);
    const id = search.data!.id;

    // '더 보기': 예시 검색 결과는 처음 받은 8건이 전부라 더할 것이 없다
    const more = await api.POST('/sourcing-comparisons/{sourcingComparisonId}/search-more', {
      params: { path: { sourcingComparisonId: id } },
    });
    expect(more.data).toEqual({ addedRowCount: 0, hasMore: false });

    // 앵커 전에는 고를 수 없다
    const early1 = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: id } },
      body: { rowId: 411 },
    });
    expect(early1.error).toMatchObject({
      code: 'ANCHOR_NOT_FIXED',
      message: '기준 모델·색상을 먼저 정해 주세요.',
    });

    // 준비된 예시가 아닌 앵커는 따라 하기 길이 아니다
    const other = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/anchor', {
      params: { path: { sourcingComparisonId: id } },
      body: { anchorInputMethod: 'CODE_ENTRY', anchorModelCode: 'XYZ99999' } as never,
    });
    expect(other.response.status).toBe(403);
    const anchor = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/anchor', {
      params: { path: { sourcingComparisonId: id } },
      body: {
        anchorInputMethod: 'SEARCH_PICK',
        anchorItemCode: 'shop-a:10000123',
        anchorColorCode: null,
      } as never,
    });
    expect(anchor.response.status).toBe(202);
    // 같은 앵커를 다시 정해도 같은 202(멱등)
    const anchorAgain = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/anchor', {
      params: { path: { sourcingComparisonId: id } },
      body: {
        anchorInputMethod: 'SEARCH_PICK',
        anchorItemCode: 'shop-a:10000123',
        anchorColorCode: null,
      } as never,
    });
    expect(anchorAgain.response.status).toBe(202);
    // 기준 상품을 정한 뒤에는 '더 보기'를 받지 않는다
    const moreAfter = await api.POST('/sourcing-comparisons/{sourcingComparisonId}/search-more', {
      params: { path: { sourcingComparisonId: id } },
    });
    expect(moreAfter.error).toMatchObject({ code: 'ANCHOR_ALREADY_FIXED' });
    const fixed = await api.GET('/candidates/{candidateId}/sourcing-comparison', path);
    expect(fixed.data).toMatchObject({ exploreMode: false, anchorModelCode: '1201A019' });
    // 페이지를 읽기 전에는 고를 수 없다(미검증 행)
    const tooEarly = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: id } },
      body: { rowId: 411 },
    });
    expect(tooEarly.error).toMatchObject({ code: 'ROW_NOT_VERIFIED' });

    demo.world.flush();
    const verified = await api.GET('/candidates/{candidateId}/sourcing-comparison', path);
    // 서버 순서: 재고 통과 3개(실질가 낮은 순) → 재고 모자란 1개 → 미검증 3개 (불일치 행은 기본으로 숨김).
    // 마지막 ショップK는 모델 번호가 없어 '확인 필요'로 남는다(화면은 이 행을 접어 보인다)
    expect(
      verified.data?.rows.map((r) => [r.shopName, r.isVerified, r.stockPass, r.anchorMatch]),
    ).toEqual([
      ['ショップA', true, true, 'MATCH'],
      ['ショップC', true, true, 'MATCH'],
      ['ショップB', true, true, 'MATCH'],
      ['ショップL', true, false, 'MATCH'],
      ['ショップW', false, null, 'MATCH'],
      ['ショップH', false, null, 'MATCH'],
      ['ショップK', false, null, 'NEEDS_REVIEW'],
    ]);
    expect(verified.data?.rows[0]).toMatchObject({
      effectivePriceYen: 11_455,
      inStockSizeCount: 5,
    });
    const low = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: id } },
      body: { rowId: 414 },
    });
    expect(low.error).toMatchObject({
      code: 'ROW_STOCK_INSUFFICIENT',
      message: '목표 사이즈 재고가 모자란 상품입니다.',
    });
    const notA = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: id } },
      body: { rowId: 412 },
    });
    expect(notA.response.status).toBe(403);

    const pick = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: id } },
      body: { rowId: 411 },
    });
    expect(pick.response.status).toBe(200);
    expect(pick.data).toMatchObject({
      stepStatus: 'COMPLETED',
      selectedRowId: 411,
      itemCode: 'shop-a:10000123',
      g2Invalidated: false,
    });
    // 같은 행을 다시 고르면 같은 응답(멱등)
    const pickAgain = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: id } },
      body: { rowId: 411 },
    });
    expect(pickAgain.response.status).toBe(200);

    const detail = await api.GET('/candidates/{candidateId}', path);
    expect(detail.data).toMatchObject({
      itemCode: 'shop-a:10000123',
      selectedColor: '크림/블랙',
      gender: 'MALE',
      genderSource: 'STEP2',
      anchorColorCode: '108',
      displayName: '아식스 젤카야노14 · 크림/블랙',
      resumeStepCode: 'PRICING',
    });
    expect(detail.data?.anchorFixedAt).not.toBeNull();
    expect((await stepOf('SOURCING')).status).toBe('COMPLETED');
    // ③이 이제 실행 가능
    expect((await stepOf('PRICING')).actions.run).toEqual({ enabled: true, disabledReason: null });
    // ⑤도 ②만 끝나면 실행 가능(G2·③ 없이도 — BE 규칙), ④는 성별까지 갖췄으니 가능
    expect((await stepOf('THUMBNAIL')).actions.run.enabled).toBe(true);
    expect((await stepOf('CATEGORY')).actions.run.enabled).toBe(true);
    expect((await api.GET('/candidate-steps')).data?.content).toEqual([]);
    expect(demo.world.progress()).toMatchObject({ done: 5, busy: false });
    expect(demo.world.progress().next?.id).toBe('domesticPrice');
  });

  it('② 다시 실행: 새 버전이 열리고, 앵커는 그대로라 곧바로 고르기 대기(SOURCING_SELECTION_REQUIRED)', async () => {
    await reachSourcingDone(demo);
    const run = await api.POST('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'SOURCING' } },
      body: {},
    });
    expect(run.data).toMatchObject({ version: 2, status: 'RUNNING' });
    demo.world.flush();
    const rail = await stepOf('SOURCING');
    expect(rail).toMatchObject({ status: 'WAITING_INPUT', lastVersion: 2 });
    expect(rail.currentRun).toMatchObject({ version: 2, status: 'WAITING_INPUT' });
    const versions = await api.GET('/candidates/{candidateId}/steps/{stepCode}/runs', {
      params: { path: { candidateId, stepCode: 'SOURCING' } },
    });
    expect(versions.data?.content.map((v) => [v.version, v.isCurrent, v.status])).toEqual([
      [2, true, 'WAITING_INPUT'],
      [1, false, 'COMPLETED'],
    ]);
    const comparison = await api.GET('/candidates/{candidateId}/sourcing-comparison', path);
    expect(comparison.data).toMatchObject({ stepStatus: 'WAITING_INPUT', exploreMode: false });
    expect(comparison.data?.rows.filter((r) => r.isVerified)).toHaveLength(4);
    expect(comparison.data?.rows.some((r) => r.isSelected)).toBe(false);
    // 다시 고르면 완료
    const pick = await api.PUT('/sourcing-comparisons/{sourcingComparisonId}/selection', {
      params: { path: { sourcingComparisonId: comparison.data!.id } },
      body: { rowId: 411 },
    });
    expect(pick.data).toMatchObject({ stepStatus: 'COMPLETED' });
    expect((await stepOf('SOURCING')).currentRun?.version).toBe(2);
  });

  it('② 입력 대기 중 연속 실행 시작은 막힌다(실행 중이면 CONTINUOUS_RUN_ALREADY_OPEN)', async () => {
    await reachSourcingSearch(demo);
    const waiting = await api.POST('/candidates/{candidateId}/continuous-runs', {
      ...path,
      body: { kind: 'FROM_HERE', startStepCode: 'SOURCING' },
    });
    expect(waiting.error).toMatchObject({ code: 'STEP_ALREADY_RUNNING' });
  });
});

describe('처음부터 다시', () => {
  it('맡겨 둔 결과를 취소하고 모든 상태를 빈 상태로 되돌린다', async () => {
    await reachSourcingSearch(demo);
    demo.world.reset();
    expect(demo.world.progress()).toMatchObject({
      done: 0,
      candidateId: null,
      registered: false,
      busy: false,
      next: { id: 'collect', path: '/keywords' },
    });
    expect(
      (await api.GET('/candidates', { params: { query: { size: 100 } } })).data?.content,
    ).toEqual([]);
    expect((await api.GET('/candidates/{candidateId}', path)).error).toMatchObject({
      code: 'CANDIDATE_NOT_FOUND',
    });
    // 수집 중에 되돌리면 남은 진행(맡겨 둔 일)이 새 상태를 건드리지 않는다
    await api.POST('/keyword-snapshots', { body: { method: 'BUTTON', rankLimit: 100 } as never });
    demo.world.reset();
    expect(demo.world.pendingTasks).toBe(0);
    demo.world.flush();
    expect((await api.GET('/keyword-collection-status')).data?.lastKeywordSnapshotId).toBeNull();
    // 되돌린 뒤 다시 처음부터 따라 갈 수 있다
    await reachSourcingDone(demo);
    expect(demo.world.progress().done).toBe(5);
  });
});
