import { describe, expect, it } from 'vitest';
import {
  comparisonRow,
  rakutenItemSnapshot,
  searchComparison,
  unverifiedRow,
} from '@/test/fixtures/sourcing';
import {
  anchorLabel,
  anchorMatchView,
  applyRecalculation,
  comparisonCaption,
  comparisonGender,
  comparisonParams,
  isComparisonEditable,
  itemFactsText,
  itemNameMarks,
  needsOwnerDecision,
  pointBreakdownText,
  pointMultiplier,
  reviewText,
  rowIdentityText,
  selectBlockedReason,
  selectionNote,
  shipOverseasText,
  sizeStockMismatchText,
  sizeStockOf,
  targetRangeText,
  targetSizeCount,
  unverifiedGroupText,
  verifiedGroupText,
} from './comparison';

const head = searchComparison({ candidateId: 1 });
const params = comparisonParams(head);

describe('비교표 화면 모델(P2-03)', () => {
  it('보드 문구: 실질가 캡션·묶음 머리·표 아래 안내(k_rank·최소 사이즈 수는 버전 사본)', () => {
    expect(comparisonCaption(params.kRank)).toBe(
      '실질가 = SKU가 + 송료 − 쿠폰 − 포인트 × 0.5 · 검증된 샵만 실질가 낮은 순으로 세웁니다 · 포인트는 근사',
    );
    expect(verifiedGroupText(2)).toBe(
      '검증 2 · 상품 페이지와 JAN·メーカー型番으로 같은 상품인지 확인 · 실질가 낮은 순',
    );
    expect(unverifiedGroupText(2)).toMatch(/^미검증 2 · 상품 페이지를 읽지 않아 고를 수 없고/);
    expect(selectionNote(params.minSizeCount)).toBe(
      '다른 샵을 고르면 판정(G2)을 다시 통과해야 합니다 · 재고 사이즈가 3개보다 적은 샵은 뺍니다',
    );
    expect(comparisonCaption(0.25)).toContain('포인트 × 0.25');
  });

  it("앵커 줄 글: '型番 1201A019 · 색상 코드 108 · 라벨'(型番이 없으면 앵커 itemCode)", () => {
    expect(anchorLabel(head)).toBe('型番 1201A019 · 색상 코드 108 · クリーム×ブラック(108)');
    expect(
      anchorLabel({
        ...head,
        anchorModelCodeNorm: null,
        anchorModelCode: null,
        anchorColorLabel: null,
      }),
    ).toBe('shop-1:10001 · 색상 코드 108');
  });

  it('params 사본이 없으면(P2-02 버전) 기본값, 목표 범위 칸 수 9', () => {
    const empty = comparisonParams(undefined);
    expect(empty).toMatchObject({ kRank: 0.5, minSizeCount: 3, defaultShippingYen: 800 });
    expect(targetSizeCount('MALE', params)).toBe(9);
    expect(targetSizeCount('FEMALE', params)).toBe(9);
    expect(targetSizeCount(null, params)).toBeNull();
    expect(targetRangeText('MALE', params)).toBe('250~290mm');
    expect(targetRangeText('FEMALE', params)).toBe('220~260mm');
  });

  it('비교에 쓰는 성별: 오너 성별 → 자동 판단 → ②에서 고른 성별 → 후보 ② 값', () => {
    const owner = {
      gender: 'FEMALE' as const,
      genderSource: 'OWNER' as const,
      genderRecheckRequired: true,
    };
    expect(comparisonGender(owner, head)).toEqual({ gender: 'FEMALE', source: 'OWNER' });
    const step2 = { gender: null, genderSource: null, genderRecheckRequired: false };
    expect(comparisonGender(step2, head)).toEqual({ gender: 'MALE', source: 'AUTO' });
    expect(comparisonGender(step2, { detectedGender: null, ownerGender: 'FEMALE' })).toEqual({
      gender: 'FEMALE',
      source: 'OWNER',
    });
    expect(comparisonGender(step2, { detectedGender: null, ownerGender: null })).toEqual({
      gender: null,
      source: null,
    });
  });

  it('앵커 일치 칸: 일치·확인 필요(JAN 다름·색상 코드 없음·시리즈만 같음)·불일치·확인 전, 오너 판단이 우선', () => {
    expect(anchorMatchView(comparisonRow(1))).toEqual({ label: '일치', tone: 'done', note: null });
    expect(anchorMatchView(comparisonRow(1, { janMatch: false }))).toMatchObject({
      label: '확인 필요',
      note: 'JAN 다름',
    });
    expect(anchorMatchView(comparisonRow(1, { makerModelMatch: false }))).toMatchObject({
      note: 'メーカー型番 다름',
    });
    expect(
      anchorMatchView(comparisonRow(1, { anchorMatch: 'NEEDS_REVIEW', colorCode: null })),
    ).toEqual({ label: '확인 필요', tone: 'waiting', note: '색상 코드 없음' });
    expect(anchorMatchView(comparisonRow(1, { anchorMatch: 'NEEDS_REVIEW' })).note).toBe(
      '시리즈만 같음',
    );
    expect(anchorMatchView(comparisonRow(1, { anchorMatch: 'NO_MATCH' })).label).toBe('불일치');
    expect(anchorMatchView(comparisonRow(1, { anchorMatch: null })).label).toBe('확인 전');
    expect(
      anchorMatchView(
        comparisonRow(1, { anchorMatch: 'NEEDS_REVIEW', ownerMatchDecision: 'MATCH' }),
      ),
    ).toEqual({ label: '같은 상품', tone: 'done', note: '오너 판단' });
    expect(needsOwnerDecision(comparisonRow(1))).toBe(false);
    expect(needsOwnerDecision(comparisonRow(1, { anchorMatch: 'NEEDS_REVIEW' }))).toBe(true);
    expect(needsOwnerDecision(comparisonRow(1, { janMatch: false }))).toBe(true);
  });

  it("포인트 분해 글: '포인트 10배 = 기본 1 + 상품 추가 9 + 샵·이벤트 0 → 1,090pt (근사)…'", () => {
    const row = comparisonRow(1);
    expect(pointMultiplier(row, params)).toEqual({
      base: 1,
      item: 9,
      shopEvent: 0,
      spu: 0,
      total: 10,
    });
    expect(pointBreakdownText(row, params)).toBe(
      '포인트 10배 = 기본 1 + 상품 추가 9 + 샵·이벤트 0 → 1,090pt (근사). 실질가에는 포인트의 절반을 반영합니다. 값을 바꾸면 바로 다시 계산합니다.',
    );
    // 샵·이벤트 1.5배·SPU 2배, pointRate에 기본 1배가 없다고 보는 설정
    const custom = { ...params, spuMultiplier: 2, pointRateIncludesBase: false };
    const text = pointBreakdownText(
      { ...row, shopEventMultiplier: 1.5, pointsTotalPt: 1_526 },
      custom,
    );
    expect(text).toMatch(
      /^포인트 14\.5배 = 기본 1 \+ 상품 추가 10 \+ 샵·이벤트 1\.5 \+ SPU 2 → 1,526pt/,
    );
    // 수동 행(pointRate 없음)은 상품 추가 0
    expect(pointMultiplier({ apiPointRate: null, shopEventMultiplier: 0 }, params).total).toBe(1);
  });

  it('표시 열: 상품명의 並行輸入品·アウトレット(타임세일·위험 플래그는 M2)', () => {
    expect(itemNameMarks('【並行輸入品】アシックス 1201A019')).toEqual(['並行輸入品']);
    expect(itemNameMarks('ｱｳﾄﾚｯﾄ アシックス')).toEqual(['アウトレット']);
    expect(itemNameMarks('アシックス ゲルカヤノ14')).toEqual([]);
  });

  it("사이즈별 칸: 앵커 색상·기본 폭만, hidden·取り寄せ 빼고 '있음·품절·取り寄せ·없음'", () => {
    const base = rakutenItemSnapshot().skus[0]!;
    const sku = (sizeMm: number, patch: Partial<typeof base> = {}) => ({
      ...base,
      sizeMm,
      ...patch,
    });
    const skus = [
      sku(250),
      sku(255, { quantity: 0 }),
      sku(260, { backOrder: true }),
      sku(265, { hidden: true }),
      sku(270, { widthLabel: '4E' }),
      sku(275, { colorCode: '100', colorLabel: 'ホワイト(100)' }),
    ];
    const cells = sizeStockOf(skus, {
      gender: 'MALE',
      params,
      anchorColorCode: '108',
      anchorColorLabel: null,
      itemBackOrderFlag: false,
    });
    expect(cells.slice(0, 6)).toEqual([
      { sizeMm: 250, status: 'IN_STOCK' },
      { sizeMm: 255, status: 'SOLD_OUT' },
      { sizeMm: 260, status: 'BACK_ORDER' },
      { sizeMm: 265, status: 'SOLD_OUT' },
      { sizeMm: 270, status: 'NONE' },
      { sizeMm: 275, status: 'NONE' },
    ]);
    expect(cells).toHaveLength(9);
    expect(
      sizeStockOf(skus, {
        gender: null,
        params,
        anchorColorCode: '108',
        anchorColorLabel: null,
        itemBackOrderFlag: null,
      }),
    ).toEqual([]);
  });

  it('고를 수 없는 이유: 닫힌 버전 → 앵커 전 → 미검증 → 재고 부족(서버가 최종으로 409)', () => {
    expect(selectBlockedReason(comparisonRow(1), head)).toBeNull();
    expect(selectBlockedReason(unverifiedRow(2), head)).toBe(
      "재고를 확인하지 않은 상품은 고를 수 없습니다. '재고 확인'을 눌러 주세요.",
    );
    expect(selectBlockedReason(comparisonRow(1, { stockPass: false }), head)).toBe(
      '목표 사이즈 재고가 모자란 상품입니다.',
    );
    expect(selectBlockedReason(comparisonRow(1), { ...head, exploreMode: true })).toBe(
      '기준 모델·색상을 먼저 정해 주세요.',
    );
    expect(selectBlockedReason(comparisonRow(1), { ...head, stepStatus: 'COMPLETED' })).toBe(
      '입력을 기다리는 ② 버전에서만 고를 수 있습니다.',
    );
    expect(isComparisonEditable(head)).toBe(true);
    expect(isComparisonEditable({ ...head, isCurrent: false })).toBe(false);
    expect(isComparisonEditable(undefined)).toBe(false);
  });

  it("상품 줄(F-SO-28): 리뷰 수·평점, 해외 배송 가능 — 값이 없으면 '정보 없음'", () => {
    expect(reviewText({ reviewCount: 1_234, reviewAverage: 4.5 })).toBe('리뷰 1,234건 · 평점 4.50');
    expect(reviewText({ reviewCount: 0, reviewAverage: 0 })).toBe('리뷰 0건');
    expect(reviewText({ reviewCount: 3, reviewAverage: null })).toBe('리뷰 3건');
    expect(reviewText({ reviewCount: null, reviewAverage: null })).toBe('리뷰 정보 없음');
    expect(shipOverseasText(true)).toBe('해외 배송 가능');
    expect(shipOverseasText(false)).toBe('해외 배송 안 함');
    expect(shipOverseasText(null)).toBe('해외 배송 정보 없음');
    expect(itemFactsText(comparisonRow(1))).toBe('리뷰 12건 · 평점 4.50 · 해외 배송 안 함');
  });

  it("같은 상품 판단 줄의 이 상품 식별 글: 型番·색상 코드·JAN(재대조가 어긋나면 'JAN 다름'·'メーカー型番 다름')", () => {
    expect(rowIdentityText(comparisonRow(1))).toBe('型番 1201A019 · 색상 코드 108 · JAN 같음');
    expect(rowIdentityText(unverifiedRow(3, { colorCode: null }))).toBe(
      '型番 1201A019 · 색상 코드 없음 · JAN 확인 전',
    );
    expect(rowIdentityText(comparisonRow(2, { janMatch: false, makerModelMatch: false }))).toBe(
      '型番 1201A019 · 색상 코드 108 · JAN 다름 · メーカー型番 다름',
    );
    expect(rowIdentityText(comparisonRow(4, { modelCodeNorm: null }))).toMatch(/^型番 없음/);
  });

  it('사이즈 칸(화면이 다시 그림)의 있음 수가 서버 판정과 다르면 안내, 같거나 볼 수 없으면 null', () => {
    const cells = [
      { status: 'IN_STOCK' as const },
      { status: 'IN_STOCK' as const },
      { status: 'SOLD_OUT' as const },
    ];
    expect(sizeStockMismatchText(cells, { inStockSizeCount: 2 })).toBeNull();
    expect(sizeStockMismatchText(cells, { inStockSizeCount: 5 })).toBe(
      '사이즈 칸(재고 2개)이 서버 판정(재고 5개)과 다릅니다. 고르기·순위는 서버 판정을 따릅니다.',
    );
    expect(sizeStockMismatchText([], { inStockSizeCount: 5 })).toBeNull();
    expect(sizeStockMismatchText(cells, { inStockSizeCount: null })).toBeNull();
  });

  it('PATCH 응답 반영: 그 행을 바꾸고 검증 행을 rankedRowIds 순서로, 미검증 행은 뒤 그대로', () => {
    const a = comparisonRow(1);
    const b = comparisonRow(2, { effectivePriceYen: 12_332 });
    const c = unverifiedRow(3);
    const detail = { ...head, rows: [a, b, c] };
    const changed = { ...a, couponYen: 1_000, effectivePriceYen: 12_500 };
    const next = applyRecalculation(detail, { row: changed, rankedRowIds: [2, 1] });
    expect(next.rows.map((r) => r.id)).toEqual([2, 1, 3]);
    expect(next.rows[1]).toBe(changed);
    expect(detail.rows.map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
