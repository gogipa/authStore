import { searchComparison, unverifiedRow } from '@/test/fixtures/sourcing';
import type { DemoWorld } from '../../demoWorld';
import { get, post, put, read, type DemoRoute } from '../../router';
import { fullRows, ITEM_ID, rakutenItem, validateRakutenQuery } from '../../sample/sourcing';
import { DEMO_IDS, STORY } from '../../sample/story';
import type { Schema } from '../../sample/types';
import { currentRun, resumeToComplete } from '../engine';
import { httpError, validationFailed } from '../errors';
import type { StepRunner } from '../runner';

type Row = Schema<'SourcingComparisonRow'>;

/**
 * ② 소싱: 라쿠텐 검색 → 상품 고르기(검색 결과 목록 — 앵커 型番·색상 정하기) → 상품 페이지 조회(재고·실질가) → 샵 고르기(= ② 완료).
 * 예시는 아식스 젤카야노14 하나다(`sample/sourcing`) — 어떤 검색어에도 같은 비교표가 나온다. '더 보기'(search-more)는 더 불러올 상품이
 * 없다고 답한다(예시 검색 결과는 8건이 전부).
 */
export interface SourcingState {
  /** 현재 ② 실행의 비교표가 어디까지 왔나 */
  phase: 'NONE' | 'SEARCHED' | 'FETCHING' | 'FETCHED' | 'SELECTED';
  anchorFixed: boolean;
  anchorInputMethod: 'SEARCH_PICK' | 'CODE_ENTRY' | null;
  anchorItemCode: string | null;
  /** 페이지 조회를 끝낸 순서(조회 순서대로 행 id) */
  fetchedRowIds: number[];
  selectedRowId: number | null;
  searchedAt: number | null;
  /** 오늘 읽은 상품 페이지 수(하루 조회 수 표시) */
  pageFetches: number;
}

export const initialSourcing = (): SourcingState => ({
  phase: 'NONE',
  anchorFixed: false,
  anchorInputMethod: null,
  anchorItemCode: null,
  fetchedRowIds: [],
  selectedRowId: null,
  searchedAt: null,
  pageFetches: 0,
});

const SHOP_A_ROW = 411;
/** 페이지 조회 순서: 앵커 상품 → 가격+송료 추정이 낮은 순. 재고 통과 3개(A·C·B)에서 멈춘다 */
const FETCH_ORDER = [411, 414, 412, 413] as const;
const COMPARISON_BASE_ID = 40;

const comparisonIdOf = (w: DemoWorld): number =>
  COMPARISON_BASE_ID + (w.s.steps.SOURCING.runs.length || 1);

/** 데모 예시는 ショップA(色 108)만 준비돼 있다 */
function sampleOnly(message: string) {
  return httpError(403, 'DEMO_READ_ONLY', message);
}

// ── 실행기 ─────────────────────────────────────────────────────────────────

export const sourcingRunner: StepRunner = {
  stepCode: 'SOURCING',
  delay: 'medium',
  onStart(w) {
    const s = w.s.sourcing;
    s.phase = 'NONE';
    s.fetchedRowIds = [];
    s.selectedRowId = null;
    s.searchedAt = null;
    // 앵커가 이미 확정된 여정을 다시 실행하면 앵커 입력 없이 분류와 페이지 조회까지 이어 간다
    if (!w.s.candidate?.anchorFixedAt) {
      s.anchorFixed = false;
      s.anchorInputMethod = null;
      s.anchorItemCode = null;
    }
  },
  outcome(w) {
    const s = w.s.sourcing;
    s.searchedAt = w.now();
    if (w.s.candidate?.anchorFixedAt) {
      s.anchorFixed = true;
      s.fetchedRowIds = [...FETCH_ORDER];
      s.pageFetches += FETCH_ORDER.length;
      s.phase = 'FETCHED';
      return {
        status: 'WAITING_INPUT',
        reasonCode: 'SOURCING_SELECTION_REQUIRED',
        pendingInputs: ['owner.sourcingSelection'],
      };
    }
    s.phase = 'SEARCHED';
    return {
      status: 'WAITING_INPUT',
      reasonCode: 'SOURCING_ANCHOR_REQUIRED',
      pendingInputs: ['owner.anchor'],
    };
  },
};

// ── 비교표 ─────────────────────────────────────────────────────────────────

/** 검색 결과 그대로(앵커 전·페이지를 읽기 전). 사진은 없고, 상품명에 모델 번호가 있으면 그것을 보인다(상품 고르기 목록) */
function searchedRow(row: Row, searchAt: string): Row {
  return unverifiedRow(row.id, {
    imageUrl: null,
    sourcingComparisonId: row.sourcingComparisonId,
    searchRank: row.searchRank,
    itemCode: row.itemCode,
    shopCode: row.shopCode,
    shopName: row.shopName,
    itemName: row.itemName,
    itemUrl: row.itemUrl,
    apiItemPriceYen: row.apiItemPriceYen,
    apiItemPriceMin3Yen: row.apiItemPriceMin3Yen,
    apiPointRate: row.apiPointRate,
    apiPostageFlag: row.apiPostageFlag,
    reviewCount: row.reviewCount,
    reviewAverage: row.reviewAverage,
    apiCollectedAt: searchAt,
    modelCodeNorm: keyFromName(row.itemName).model,
    colorCode: null,
    anchorMatch: null,
  });
}

function rowsOf(w: DemoWorld): Row[] {
  const s = w.s.sourcing;
  const clock = w.clock;
  const searchAt = new Date(s.searchedAt ?? w.now()).toISOString();
  const pageAt = new Date(w.s.times.pageCollected ?? w.now()).toISOString();
  const comparisonId = comparisonIdOf(w);
  const all = fullRows(clock).map((row) => ({ ...row, sourcingComparisonId: comparisonId }));
  if (s.phase === 'SEARCHED' || !s.anchorFixed) {
    // 상품 고르기 목록은 검색 결과 순서(관련도 순) 그대로다
    return all
      .map((row) => searchedRow(row, searchAt))
      .sort((a, b) => (a.searchRank ?? Infinity) - (b.searchRank ?? Infinity));
  }
  const rows = all.map((row) => {
    if (s.fetchedRowIds.includes(row.id)) {
      return {
        ...row,
        apiCollectedAt: searchAt,
        rakutenPageCollectedAt: pageAt,
        isSelected: row.id === s.selectedRowId,
      };
    }
    // 앵커는 정했지만 아직 읽지 않은 행: 분류만 된 검색 결과
    return {
      ...searchedRow(row, searchAt),
      modelCodeNorm: row.modelCodeNorm,
      colorCode: row.colorCode,
      anchorMatch: row.anchorMatch,
    };
  });
  // 서버 순서: 검증 행(재고 통과 → 실질가 낮은 순, 재고 못 채운 행) → 미검증 행(검색 순위) → 불일치 행
  const rank = (row: Row): number => (row.isVerified ? 0 : row.anchorMatch === 'NO_MATCH' ? 2 : 1);
  return rows.sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 0) {
      if (a.stockPass !== b.stockPass) return a.stockPass ? -1 : 1;
      return (a.effectivePriceYen ?? Infinity) - (b.effectivePriceYen ?? Infinity);
    }
    return (a.searchRank ?? Infinity) - (b.searchRank ?? Infinity);
  });
}

function comparisonView(w: DemoWorld, includeNoMatch: boolean): Schema<'SourcingComparisonDetail'> {
  const candidate = w.candidate();
  const run = currentRun(w, 'SOURCING');
  if (!run || w.s.sourcing.phase === 'NONE') {
    throw httpError(404, 'STEP_OUTPUT_NOT_FOUND', '아직 ② 소싱을 실행하지 않았습니다.', {
      details: { stepCode: 'SOURCING' },
    });
  }
  const s = w.s.sourcing;
  const all = rowsOf(w);
  const explore = !s.anchorFixed;
  const selected = s.selectedRowId !== null;
  return searchComparison({
    id: comparisonIdOf(w),
    candidateId: candidate.id,
    version: run.version,
    stepRunId: run.id,
    stepStatus: w.s.steps.SOURCING.status,
    isCurrent: true,
    searchKeyword: candidate.rakutenQuery,
    anchorInputMethod: explore ? null : (s.anchorInputMethod ?? 'SEARCH_PICK'),
    anchorItemCode: explore ? null : (s.anchorItemCode ?? STORY.itemCode),
    anchorModelCode: explore ? null : STORY.modelCode,
    anchorModelCodeNorm: explore ? null : STORY.modelCodeNorm,
    anchorColorCode: explore ? null : STORY.colorCode,
    anchorColorLabel: explore ? null : STORY.colorLabelJa,
    exploreMode: explore,
    comparisonPerformed: true,
    selectedRakutenItemId: selected ? DEMO_IDS.rakutenItem : null,
    shippingYen: selected ? 0 : null,
    shippingSource: selected ? 'FREE' : null,
    detectedGender: explore ? null : 'MALE',
    genderBasis: explore
      ? null
      : w.s.keywords.selected[candidate.sourceKeywordId] !== undefined &&
          candidate.sourceKeywordId < 200
        ? 'KEYWORD_CID'
        : 'GENRE_PATH',
    rows: includeNoMatch ? all : all.filter((row) => row.anchorMatch !== 'NO_MATCH'),
    createdAt: new Date(run.startedAt).toISOString(),
    updatedAt: new Date(run.endedAt ?? w.now()).toISOString(),
  });
}

// ── 앵커 · 고르기 ──────────────────────────────────────────────────────────

const notFoundComparison = () =>
  httpError(404, 'SOURCING_COMPARISON_NOT_FOUND', '비교표를 찾을 수 없습니다.');

function openComparison(w: DemoWorld, idText: string) {
  const run = currentRun(w, 'SOURCING');
  if (!run || w.s.sourcing.phase === 'NONE' || String(comparisonIdOf(w)) !== idText) {
    throw notFoundComparison();
  }
  return run;
}

function waitingGuard(w: DemoWorld) {
  if (w.s.steps.SOURCING.status !== 'WAITING_INPUT') {
    throw httpError(
      409,
      'STEP_RUN_NOT_WAITING_INPUT',
      '이 실행은 입력을 기다리고 있지 않습니다. 바꾸려면 다시 실행하거나 수정해 주세요.',
    );
  }
}

/** 상품 이름에서 型番·색상 번호를 뽑는다('ゲルカヤノ14 1201A019-108' → 1201A019 · 108) */
function keyFromName(name: string): { model: string | null; color: string | null } {
  const found = /([0-9][0-9A-Z]{6,7})(?:-(\d{3}))?/.exec(name);
  return { model: found?.[1] ?? null, color: found?.[2] ?? null };
}

function fixAnchor(
  w: DemoWorld,
  comparisonId: string,
  body: {
    anchorInputMethod?: 'SEARCH_PICK' | 'CODE_ENTRY';
    anchorItemCode?: string;
    anchorModelCode?: string;
    anchorColorCode?: string | null;
  },
) {
  const run = openComparison(w, comparisonId);
  const s = w.s.sourcing;
  waitingGuard(w);
  let model: string | null;
  let color: string | null = body.anchorColorCode?.trim() || null;
  let itemCode: string | null = null;
  if (body.anchorInputMethod === 'CODE_ENTRY') {
    model = body.anchorModelCode?.trim().toUpperCase() ?? null;
    if (!model) throw validationFailed('anchorModelCode', '型番을 넣어 주세요.');
  } else {
    itemCode = body.anchorItemCode ?? null;
    const row = rowsOf(w).find((r) => r.itemCode === itemCode);
    if (!row) throw validationFailed('anchorItemCode', '이 비교표에 없는 상품입니다.', itemCode);
    const key = keyFromName(row.itemName);
    model = key.model;
    color ??= key.color;
  }
  color ??= STORY.colorCode;
  if (model !== STORY.modelCode || color !== STORY.colorCode) {
    throw sampleOnly(
      '체험에는 모델 번호 1201A019 · 색상 번호 108(ショップA 상품)만 준비돼 있습니다. ショップA 줄의 [이 상품으로 정하기]를 누르거나, 모델 번호 1201A019에 색상 번호를 비우거나 108로 넣어 주세요.',
    );
  }
  if (s.anchorFixed) {
    // 같은 앵커를 다시 정하는 것은 멱등(같은 202)
    return { run };
  }
  s.anchorFixed = true;
  s.anchorInputMethod = body.anchorInputMethod === 'CODE_ENTRY' ? 'CODE_ENTRY' : 'SEARCH_PICK';
  s.anchorItemCode = itemCode ?? STORY.itemCode;
  s.phase = 'FETCHING';
  s.fetchedRowIds = [];
  w.mark('anchorFixed');
  // 분류 → 상품 페이지를 하나씩 읽는다(행마다 검증된다)
  const per = Math.round(w.delay('medium') / FETCH_ORDER.length);
  const step = (index: number) => {
    const sourcing = w.s.sourcing;
    if (sourcing.phase !== 'FETCHING' || currentRun(w, 'SOURCING')?.id !== run.id) return;
    const rowId = FETCH_ORDER[index];
    if (rowId === undefined) {
      sourcing.phase = 'FETCHED';
      w.mark('pageCollected');
      return;
    }
    sourcing.fetchedRowIds.push(rowId);
    sourcing.pageFetches += 1;
    w.schedule(per, () => step(index + 1));
  };
  w.schedule(per, () => step(0));
  return { run };
}

/** 상품 고르기 '더 보기': 예시 검색 결과는 처음 받은 8건이 전부라 더할 것이 없다(기준 상품을 정한 뒤에는 409) */
function searchMore(w: DemoWorld, comparisonId: string) {
  openComparison(w, comparisonId);
  waitingGuard(w);
  if (w.s.sourcing.anchorFixed) {
    throw httpError(
      409,
      'ANCHOR_ALREADY_FIXED',
      '기준 상품을 이미 정해서 검색 결과를 더 볼 수 없습니다.',
    );
  }
  return { addedRowCount: 0, hasMore: false };
}

function selectRow(w: DemoWorld, comparisonId: string, rowId: number | undefined) {
  const run = openComparison(w, comparisonId);
  const s = w.s.sourcing;
  if (typeof rowId !== 'number') throw validationFailed('rowId', '필수입니다.');
  const row = rowsOf(w).find((r) => r.id === rowId);
  if (!row) {
    throw httpError(404, 'SOURCING_COMPARISON_ROW_NOT_FOUND', '비교표 행을 찾을 수 없습니다.');
  }
  // 이미 닫힌 버전에서 같은 행을 다시 고르면 같은 응답(멱등)
  if (s.phase === 'SELECTED' && s.selectedRowId === rowId) return { run, row };
  waitingGuard(w);
  if (!s.anchorFixed) {
    throw httpError(409, 'ANCHOR_NOT_FIXED', '기준 모델·색상을 먼저 정해 주세요.');
  }
  if (!row.isVerified) {
    throw httpError(
      409,
      'ROW_NOT_VERIFIED',
      "재고를 확인하지 않은 상품은 고를 수 없습니다. '재고 확인'을 눌러 주세요.",
    );
  }
  if (!row.stockPass) {
    throw httpError(409, 'ROW_STOCK_INSUFFICIENT', '목표 사이즈 재고가 모자란 상품입니다.');
  }
  if (rowId !== SHOP_A_ROW) {
    throw sampleOnly(
      '체험에서는 ショップA만 고를 수 있습니다. ショップA 줄의 고르기를 눌러 주세요.',
    );
  }
  s.selectedRowId = rowId;
  s.phase = 'SELECTED';
  const candidate = w.candidate();
  const now = w.now();
  candidate.anchorModelCode = STORY.modelCode;
  candidate.anchorItemCode = STORY.itemCode;
  candidate.anchorColorCode = STORY.colorCode;
  candidate.anchorFixedAt = now;
  candidate.itemCode = STORY.itemCode;
  candidate.selectedColor = STORY.selectedColor;
  candidate.gender = 'MALE';
  candidate.genderSource = 'STEP2';
  candidate.pageDataCollectedAt = w.s.times.pageCollected ?? now;
  candidate.displayName = STORY.displayName;
  candidate.updatedAt = now;
  resumeToComplete(w, 'SOURCING');
  return { run, row };
}

export const sourcingRoutes: DemoRoute[] = [
  read('/rakuten-query-validations', async ({ json }) => {
    const body = await json<{ rakutenQuery: string }>();
    return validateRakutenQuery(body.rakutenQuery ?? '');
  }),
  get('/rakuten-items/{rakutenItemId}', ({ world, params }) => {
    const id = Number(params.rakutenItemId);
    const snapshot = rakutenItem(world.clock, id);
    const fetched = world.s.sourcing.fetchedRowIds;
    const idsByRow: Record<number, number> = {
      411: ITEM_ID.A,
      412: ITEM_ID.C,
      413: ITEM_ID.B,
      414: ITEM_ID.L,
    };
    if (!snapshot || !fetched.some((rowId) => idsByRow[rowId] === id)) {
      throw httpError(404, 'RAKUTEN_ITEM_NOT_FOUND', '읽어 온 라쿠텐 상품을 찾을 수 없습니다.');
    }
    return snapshot;
  }),
  get('/candidates/{candidateId}/sourcing-comparison', ({ world, query }) => {
    const asked = query.get('stepRunId');
    const run = currentRun(world, 'SOURCING');
    if (asked !== null && String(run?.id) !== asked) {
      throw httpError(404, 'STEP_RUN_NOT_FOUND', '실행 기록을 찾을 수 없습니다.');
    }
    return comparisonView(world, query.get('includeNoMatch') === 'true');
  }),
  put(
    '/sourcing-comparisons/{sourcingComparisonId}/anchor',
    202,
    async ({ world, params, json }) => {
      const body = await json<Parameters<typeof fixAnchor>[2]>();
      const { run } = fixAnchor(world, params.sourcingComparisonId!, body);
      return {
        candidateId: world.candidate().id,
        sourcingComparisonId: comparisonIdOf(world),
        stepRunId: run.id,
        stepStatus: world.s.steps.SOURCING.status,
        rowId: null,
      };
    },
  ),
  post('/sourcing-comparisons/{sourcingComparisonId}/search-more', 200, ({ world, params }) =>
    searchMore(world, params.sourcingComparisonId!),
  ),
  put(
    '/sourcing-comparisons/{sourcingComparisonId}/selection',
    200,
    async ({ world, params, json }) => {
      const body = await json<{ rowId: number }>();
      const { run, row } = selectRow(world, params.sourcingComparisonId!, body.rowId);
      return {
        candidateId: world.candidate().id,
        sourcingComparisonId: comparisonIdOf(world),
        stepRunId: run.id,
        stepStatus: world.s.steps.SOURCING.status,
        selectedRowId: row.id,
        itemCode: row.itemCode,
        selectedColor: STORY.selectedColor,
        g2Invalidated: false,
        staleDownstreamSteps: [],
      };
    },
  ),
];
