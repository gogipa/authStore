import { expectedCollectionPeriod } from '@/features/keywords';
import { keywordSnapshotDetail, rankedKeyword } from '@/test/fixtures/keywords';
import { del, get, post, put, read, READ_ONLY, type DemoRoute } from '../../router';
import {
  childKeywordTerms,
  COLLECT_CIDS,
  KEYWORD_SPECS,
  rakutenQueryOf,
  ROWS_PER_PAGE,
  type KeywordSpec,
} from '../../sample/keywords';
import { validateRakutenQuery } from '../../sample/sourcing';
import { DEMO_IDS } from '../../sample/story';
import type { Ok, Schema } from '../../sample/types';
import { pageOf } from '../../sample/util';
import type { DemoWorld } from '../../demoWorld';
import { httpError, validationFailed } from '../errors';
import { candidateDetailOf } from '../candidateViews';

/** ① 키워드: 데이터랩 [수집]으로 만든 묶음 하나와 G1(키워드 고르기) 기록 */
export interface KeywordsState {
  snapshot: null | {
    id: number;
    status: 'RUNNING' | 'COMPLETED';
    collectedAt: number;
    rankLimit: 100 | 500;
    /** 분야(cid)별로 끝낸 페이지 수 */
    pagesDone: Record<string, number>;
  };
  /**
   * G1로 고른 키워드 id → 고른 시각(ms). 앞서 고른 키워드의 시각은 지우지 않는다(승인 이력 — 그 키워드로 만든 여정의 G1 통과 시각).
   * '지금 고른 키워드'(D-33)는 이 가운데 시각이 가장 늦은 것이다(`currentKeywordId`).
   */
  selected: Record<number, number>;
}

export const initialKeywords = (): KeywordsState => ({ snapshot: null, selected: {} });

/**
 * 지금 고른 키워드 id(D-33): 고른 시각이 가장 늦은 키워드, 같으면 id가 큰 쪽(실제 BE `selected_at` 규칙). 고른 것이 없으면 null.
 * 값을 따로 두지 않고 `selected`에서 계산하므로 지금 고른 키워드를 비우면(DELETE) 그다음으로 늦게 고른 키워드가 자연히 된다.
 */
export function currentKeywordId(keywords: KeywordsState): number | null {
  let best: { id: number; at: number } | null = null;
  for (const [key, at] of Object.entries(keywords.selected)) {
    const id = Number(key);
    if (best === null || at > best.at || (at === best.at && id > best.id)) best = { id, at };
  }
  return best === null ? null : best.id;
}

const PAGES_PER_CID = 5;

/** 지금까지 받은 키워드 줄(페이지마다 줄이 늘어난다) */
export function visibleKeywords(w: DemoWorld): KeywordSpec[] {
  const snapshot = w.s.keywords.snapshot;
  if (!snapshot) return [];
  return KEYWORD_SPECS.filter((spec) => {
    const done = snapshot.pagesDone[spec.cid] ?? 0;
    return (spec.rank - 1) / ROWS_PER_PAGE < done;
  });
}

const specById = (w: DemoWorld, id: number): KeywordSpec | undefined =>
  visibleKeywords(w).find((spec) => spec.id === id);

function rankedRow(w: DemoWorld, spec: KeywordSpec): Schema<'RankedKeyword'> {
  const selectedAt = w.s.keywords.selected[spec.id];
  const candidate = w.s.candidate;
  return rankedKeyword({
    id: spec.id,
    keywordSnapshotId: DEMO_IDS.keywordSnapshot,
    cid: spec.cid,
    rank: spec.rank,
    keyword: spec.keyword,
    excludedReason: spec.childExcluded ? 'CHILD' : null,
    selectedAt: selectedAt === undefined ? null : new Date(selectedAt).toISOString(),
    candidateIds: candidate && candidate.sourceKeywordId === spec.id ? [candidate.id] : [],
  });
}

function snapshotView(w: DemoWorld): Schema<'KeywordSnapshotDetail'> | null {
  const snapshot = w.s.keywords.snapshot;
  if (!snapshot) return null;
  const rows = visibleKeywords(w);
  // 지금 고른 키워드(D-33): 표가 쪽·분야로 나뉘어도 새로고침 뒤에 같은 줄을 가리키도록 묶음 조회가 직접 알려 준다
  const currentId = currentKeywordId(w.s.keywords);
  const current = KEYWORD_SPECS.find((spec) => spec.id === currentId);
  const period = expectedCollectionPeriod(new Date(snapshot.collectedAt));
  const dotted = (date: string) => `${date.replaceAll('-', '.')}.`;
  return keywordSnapshotDetail({
    id: snapshot.id,
    method: 'BUTTON',
    collectedAt: new Date(snapshot.collectedAt).toISOString(),
    requestedCids: [...COLLECT_CIDS],
    periodStart: period.startDate,
    periodEnd: period.endDate,
    rankLimit: snapshot.rankLimit,
    responseRange: `${dotted(period.startDate)} ~ ${dotted(period.endDate)}`,
    rangeMatched: snapshot.status === 'COMPLETED' ? true : null,
    status: snapshot.status,
    keywordCount: rows.length,
    excludedCount: rows.filter((spec) => spec.childExcluded).length,
    selectedKeyword: current ? rankedRow(w, current) : null,
  });
}

/** 목록 항목은 묶음 요약이다 — 지금 고른 키워드(D-33)는 묶음 하나를 읽는 조회(`getKeywordSnapshot`)에만 있다 */
function summaryOf(view: Schema<'KeywordSnapshotDetail'>): Schema<'KeywordSnapshot'> {
  return Object.fromEntries(
    Object.entries(view).filter(([key]) => key !== 'selectedKeyword'),
  ) as Schema<'KeywordSnapshot'>;
}

/** `GET /keyword-collection-status` — 수집 이력이 없으면 빈 상태 */
function collectionStatus(w: DemoWorld): Ok<'/keyword-collection-status'> {
  const snapshot = w.s.keywords.snapshot;
  const running = snapshot?.status === 'RUNNING';
  return {
    collecting: running,
    runningKeywordSnapshotId: running ? snapshot.id : null,
    lastKeywordSnapshotId: snapshot && !running ? snapshot.id : null,
    lastCollectedAt: snapshot && !running ? new Date(snapshot.collectedAt).toISOString() : null,
    lastStatus: snapshot && !running ? 'COMPLETED' : null,
    lastAbortReason: null,
    blockedUntil: null,
    requestIntervalSeconds: 2,
    disabledReasonCode: running ? 'ALREADY_IN_PROGRESS' : null,
  };
}

/**
 * [수집]: 202를 주고, 분야(여성 → 남성) × 페이지를 하나씩 받는 모습을 진행 알림(`keyword-collection.progress`)으로 보낸다.
 * 이미 받는 중이면 409 ALREADY_IN_PROGRESS. 다시 수집하면 같은 묶음을 처음부터 다시 받는다(고른 키워드는 그대로).
 */
function startCollection(w: DemoWorld, rankLimit: 100 | 500) {
  const existing = w.s.keywords.snapshot;
  if (existing?.status === 'RUNNING') {
    throw httpError(
      409,
      'ALREADY_IN_PROGRESS',
      '데이터랩 수집이 이미 진행 중입니다. 끝난 뒤 다시 해 주세요.',
      { details: { job: 'KEYWORD_COLLECTION', keywordSnapshotId: existing.id } },
    );
  }
  const snapshot: NonNullable<KeywordsState['snapshot']> = {
    id: DEMO_IDS.keywordSnapshot,
    status: 'RUNNING',
    collectedAt: w.now(),
    rankLimit,
    pagesDone: {},
  };
  w.s.keywords.snapshot = snapshot;
  const steps = COLLECT_CIDS.flatMap((cid) =>
    Array.from({ length: PAGES_PER_CID }, (_, i) => ({ cid, page: i + 1 })),
  );
  const perStep = Math.round(w.delay('long') / steps.length);
  const run = (index: number) => {
    if (w.s.keywords.snapshot !== snapshot) return;
    const step = steps[index];
    if (!step) {
      snapshot.status = 'COMPLETED';
      snapshot.collectedAt = w.now();
      w.mark('keywordsPasted');
      const rows = visibleKeywords(w);
      w.emit('keyword-collection.completed', {
        keywordSnapshotId: snapshot.id,
        keywordCount: rows.length,
        excludedCount: rows.filter((spec) => spec.childExcluded).length,
        rangeMatched: true,
      });
      return;
    }
    snapshot.pagesDone[step.cid] = step.page;
    w.emit('keyword-collection.progress', {
      keywordSnapshotId: snapshot.id,
      cid: step.cid,
      page: step.page,
      pagesPerCid: PAGES_PER_CID,
      requestsDone: index + 1,
      requestsTotal: steps.length,
    });
    w.schedule(perStep, () => run(index + 1));
  };
  w.schedule(perStep, () => run(0));
  return {
    keywordSnapshotId: snapshot.id,
    status: 'RUNNING' as const,
    rankLimit,
    requestedCids: [...COLLECT_CIDS],
  };
}

function notFound() {
  return httpError(404, 'KEYWORD_NOT_FOUND', '키워드를 찾을 수 없습니다.');
}

/**
 * `PUT /keywords/{id}/selection`(D-33): 이 키워드를 지금 고른 키워드로 한다. 이미 지금 고른 키워드면 그대로(멱등).
 * 아니면(처음 고르는 키워드든, 앞서 골랐다가 다른 것으로 바꾼 키워드든) 고른 시각을 `max(지금, 가장 늦은 시각 + 1)`로 정해 가장 늦게
 * 만든다. 다른 키워드의 시각은 지우지 않는다. 이야기 시각표의 '키워드 고름'은 처음 고를 때만 남긴다(시각표 순서가 뒤바뀌지 않게).
 */
export function selectKeyword(w: DemoWorld, keywordId: number): Schema<'RankedKeyword'> {
  const spec = specById(w, keywordId);
  if (!spec) throw notFound();
  if (spec.childExcluded) {
    throw httpError(409, 'KEYWORD_EXCLUDED', '아동화로 빠진 키워드는 고를 수 없습니다.', {
      details: { keywordId },
    });
  }
  const keywords = w.s.keywords;
  if (currentKeywordId(keywords) !== keywordId) {
    const latest = Math.max(-Infinity, ...Object.values(keywords.selected));
    keywords.selected[keywordId] = Math.max(w.now(), latest + 1);
    if (w.s.times.keywordSelected === undefined) w.mark('keywordSelected');
  }
  return rankedRow(w, spec);
}

/**
 * `DELETE /keywords/{id}/selection`: 남겨 둔 API(D-33) — 화면은 부르지 않는다. 이 키워드로 만든 여정이 있으면 409 KEYWORD_IN_USE.
 * 지금 고른 키워드를 비우면 그다음으로 늦게 고른 키워드가 지금 고른 키워드가 된다(`currentKeywordId`가 계산한다).
 */
function unselectKeyword(w: DemoWorld, keywordId: number): void {
  const spec = specById(w, keywordId);
  if (!spec) throw notFound();
  const candidate = w.s.candidate;
  if (candidate && candidate.sourceKeywordId === keywordId) {
    throw httpError(
      409,
      'KEYWORD_IN_USE',
      '이 키워드로 만든 여정이 있어 선택을 취소할 수 없습니다.',
      { details: { keywordId, candidateIds: [candidate.id] } },
    );
  }
  delete w.s.keywords.selected[keywordId];
}

/**
 * `POST /keywords/{id}/rakuten-query-conversions`(F-BS-70): AI를 부르지 않고 예시 검색어를 답한다. 저장하지 않으므로 모델은 바뀌지 않는다.
 * 보이는 키워드가 아니면 404, 아동화로 빠진 키워드는 409 KEYWORD_EXCLUDED.
 */
function convertKeyword(w: DemoWorld, keywordId: number): Schema<'RakutenQueryConversion'> {
  const spec = specById(w, keywordId);
  if (!spec) throw notFound();
  if (spec.childExcluded) {
    throw httpError(409, 'KEYWORD_EXCLUDED', '아동화로 빠진 키워드는 일본어로 바꿀 수 없습니다.', {
      details: { keywordId },
    });
  }
  return {
    keywordId,
    keyword: spec.keyword,
    rakutenQuery: rakutenQueryOf(spec.keyword),
    // 체험의 AI 엔진 설정(Claude Code · sonnet)과 같다
    engineCode: 'CLAUDE',
    model: 'sonnet',
  };
}

const RAKUTEN_QUERY_INVALID =
  '라쿠텐 검색어 형식이 맞지 않습니다(반각 128자 이내, 너무 짧은 단어 없이).';

/**
 * `POST /candidates`(KEYWORD): G1로 고른 키워드로 예시 여정을 만든다. 체험은 여정을 하나만 만든다 — 이미 있으면 그 여정을 열라고
 * 알린다(KEYWORD 경로는 실제로는 중복 검사가 없다).
 */
export function createCandidate(
  w: DemoWorld,
  body: { creationPath?: string; sourceKeywordId?: number; rakutenQuery?: string },
): Schema<'CandidateDetail'> {
  if (body.creationPath !== 'KEYWORD') {
    // 검색어·URL로 시작은 따라 하기 길이 아니다(라우트가 403으로 답한다)
    throw validationFailed('creationPath', '체험에서는 키워드로 시작하는 여정만 만들 수 있습니다.');
  }
  const query = (body.rakutenQuery ?? '').trim();
  if (typeof body.sourceKeywordId !== 'number' || query === '') {
    throw validationFailed('rakutenQuery', '검색어를 넣어 주세요.');
  }
  const check = validateRakutenQuery(query);
  if (!check.valid) {
    throw httpError(422, 'RAKUTEN_QUERY_INVALID', RAKUTEN_QUERY_INVALID, {
      fieldErrors: check.violations.map((v) => ({ field: 'rakutenQuery', message: v.message })),
    });
  }
  const spec = specById(w, body.sourceKeywordId);
  if (!spec) throw notFound();
  if (spec.childExcluded) {
    throw httpError(409, 'KEYWORD_EXCLUDED', '아동화로 빠진 키워드는 고를 수 없습니다.');
  }
  if (w.s.keywords.selected[spec.id] === undefined) {
    throw httpError(
      409,
      'KEYWORD_NOT_SELECTED',
      '키워드 화면에서 고른 키워드만 여정으로 만들 수 있습니다.',
    );
  }
  if (w.s.candidate) {
    throw httpError(
      409,
      'CANDIDATE_DUPLICATE',
      '체험에서는 여정을 하나만 만듭니다. 이미 만든 여정을 열어 주세요.',
      { details: { existingCandidateId: w.s.candidate.id } },
    );
  }
  const now = w.now();
  w.s.candidate = {
    id: DEMO_IDS.candidate,
    status: 'WORKING',
    statusChangedAt: now,
    sourceKeywordId: spec.id,
    sourceKeyword: spec.keyword,
    rakutenQuery: query,
    createdAt: now,
    updatedAt: now,
    displayName: query,
    anchorModelCode: null,
    anchorItemCode: null,
    anchorColorCode: null,
    anchorFixedAt: null,
    itemCode: null,
    selectedColor: null,
    gender: null,
    genderSource: null,
    pageDataCollectedAt: null,
    leafCategoryId: null,
    wholeCategoryName: null,
    history: [
      {
        id: w.s.next.history++,
        from: null,
        to: 'WORKING',
        reason: 'CREATED',
        stepRunId: null,
        registrationId: null,
        at: now,
      },
    ],
  };
  w.mark('candidateCreated', now);
  return candidateDetailOf(w);
}

export const keywordsRoutes: DemoRoute[] = [
  get('/keyword-snapshots', ({ world, query }) => {
    const view = snapshotView(world);
    const method = query.get('method');
    const status = query.get('status');
    const match = view && (!method || method === 'BUTTON') && (!status || status === view.status);
    const { page, size } = {
      page: Number(query.get('page') ?? 0) || 0,
      size: Number(query.get('size') ?? 20) || 20,
    };
    return pageOf(match ? [summaryOf(view)] : [], page, size);
  }),
  get('/keyword-snapshots/{keywordSnapshotId}', ({ world, params }) => {
    const view = snapshotView(world);
    if (!view || String(view.id) !== params.keywordSnapshotId) {
      throw httpError(404, 'KEYWORD_SNAPSHOT_NOT_FOUND', '키워드 수집 결과를 찾을 수 없습니다.');
    }
    return view;
  }),
  get('/keyword-snapshots/{keywordSnapshotId}/keywords', ({ world, params, query }) => {
    if (
      !world.s.keywords.snapshot ||
      String(DEMO_IDS.keywordSnapshot) !== params.keywordSnapshotId
    ) {
      throw httpError(404, 'KEYWORD_SNAPSHOT_NOT_FOUND', '키워드 수집 결과를 찾을 수 없습니다.');
    }
    const cid = query.get('cid');
    const excluded = query.get('excluded');
    const rows = visibleKeywords(world)
      .filter((spec) => (cid ? spec.cid === cid : true))
      .filter((spec) => (excluded === null ? true : spec.childExcluded === (excluded === 'true')))
      .sort((a, b) => a.rank - b.rank || a.cid.localeCompare(b.cid) || a.id - b.id)
      .map((spec) => rankedRow(world, spec));
    return pageOf(rows, Number(query.get('page') ?? 0) || 0, Number(query.get('size') ?? 20) || 20);
  }),
  get('/keyword-collection-status', ({ world }) => collectionStatus(world)),
  get('/child-keyword-terms', () => childKeywordTerms()),
  post('/keyword-snapshots', 202, async ({ world, json }) => {
    const body = await json<{ method: string; rankLimit: number }>();
    // 순위 붙여넣기는 따라 하기 길이 아니다
    if (body.method !== 'BUTTON') return READ_ONLY;
    return startCollection(world, body.rankLimit === 500 ? 500 : 100);
  }),
  put('/keywords/{keywordId}/selection', 200, ({ world, params }) =>
    selectKeyword(world, Number(params.keywordId)),
  ),
  del('/keywords/{keywordId}/selection', ({ world, params }) => {
    unselectKeyword(world, Number(params.keywordId));
  }),
  read('/keywords/{keywordId}/rakuten-query-conversions', ({ world, params }) =>
    convertKeyword(world, Number(params.keywordId)),
  ),
  post('/candidates', 201, async ({ world, json }) => {
    const body = await json<{
      creationPath: string;
      sourceKeywordId: number;
      rakutenQuery: string;
    }>();
    if (body.creationPath !== 'KEYWORD') return READ_ONLY;
    return createCandidate(world, body);
  }),
];
