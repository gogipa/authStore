import { formatCount } from '@/shared/lib/format';
import type { components } from '@/shared/api/schema';
import type { RakutenSkuVariant, SourcingComparisonDetail } from './sourcing';

/** ② 비교표(P2-03) 화면 모델. 계산 값은 BE가 정한다 — 여기는 보이는 글·순서·사이즈 칸(스냅샷 SKU로 다시 그림)만 만든다 */
export type SourcingComparisonRow = components['schemas']['SourcingComparisonRow'];
export type SourcingRowRecalculation = components['schemas']['SourcingRowRecalculation'];
export type SourcingSelectionResult = components['schemas']['SourcingSelectionResult'];
export type SourcingJobAccepted = components['schemas']['SourcingJobAccepted'];
export type ComparisonGender = 'MALE' | 'FEMALE';

/** 버전 설정 사본(`params`)에서 쓰는 값. 없으면 기본값(설정 기본 템플릿과 같다) */
export interface ComparisonParams {
  kRank: number;
  spuMultiplier: number;
  pointRateIncludesBase: boolean;
  minSizeCount: number;
  defaultWidth: string;
  excludeBackOrder: boolean;
  defaultShippingYen: number;
  targetSizeMm: Record<ComparisonGender, { min: number; max: number }>;
}

const DEFAULT_PARAMS: ComparisonParams = {
  kRank: 0.5,
  spuMultiplier: 0,
  pointRateIncludesBase: true,
  minSizeCount: 3,
  defaultWidth: '2E (標準)',
  excludeBackOrder: true,
  defaultShippingYen: 800,
  targetSizeMm: { MALE: { min: 250, max: 290 }, FEMALE: { min: 220, max: 260 } },
};

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function range(value: unknown, fallback: { min: number; max: number }) {
  if (!value || typeof value !== 'object') return fallback;
  const v = value as { min?: unknown; max?: unknown };
  return typeof v.min === 'number' && typeof v.max === 'number'
    ? { min: v.min, max: v.max }
    : fallback;
}

export function comparisonParams(
  head: Pick<SourcingComparisonDetail, 'params'> | undefined,
): ComparisonParams {
  const p = (head?.params ?? {}) as Record<string, unknown>;
  const target = (p.targetSizeMm ?? {}) as Record<string, unknown>;
  return {
    kRank: num(p.kRank, DEFAULT_PARAMS.kRank),
    spuMultiplier: num(p.spuMultiplier, DEFAULT_PARAMS.spuMultiplier),
    pointRateIncludesBase:
      typeof p.pointRateIncludesBase === 'boolean'
        ? p.pointRateIncludesBase
        : DEFAULT_PARAMS.pointRateIncludesBase,
    minSizeCount: num(p.minSizeCount, DEFAULT_PARAMS.minSizeCount),
    defaultWidth: typeof p.defaultWidth === 'string' ? p.defaultWidth : DEFAULT_PARAMS.defaultWidth,
    excludeBackOrder:
      typeof p.excludeBackOrder === 'boolean'
        ? p.excludeBackOrder
        : DEFAULT_PARAMS.excludeBackOrder,
    defaultShippingYen: num(p.defaultShippingYen, DEFAULT_PARAMS.defaultShippingYen),
    targetSizeMm: {
      MALE: range(target.MALE, DEFAULT_PARAMS.targetSizeMm.MALE),
      FEMALE: range(target.FEMALE, DEFAULT_PARAMS.targetSizeMm.FEMALE),
    },
  };
}

/** k_rank 글('0.5') */
export function kRankText(kRank: number): string {
  return String(Math.round(kRank * 10_000) / 10_000);
}

/** 비교표 캡션(보드 그대로, k_rank는 버전 사본) */
export function comparisonCaption(kRank: number): string {
  return `실질가 = SKU가 + 송료 − 쿠폰 − 포인트 × ${kRankText(kRank)} · 검증된 샵만 실질가 낮은 순으로 세웁니다 · 포인트는 근사`;
}

/** 표 아래 안내(보드 그대로, 최소 사이즈 수는 버전 사본) */
export function selectionNote(minSizeCount: number): string {
  return `다른 샵을 고르면 판정(G2)을 다시 통과해야 합니다 · 재고 사이즈가 ${minSizeCount}개보다 적은 샵은 뺍니다`;
}

export function verifiedGroupText(count: number): string {
  return `검증 ${count} · 상품 페이지와 JAN·メーカー型番으로 같은 상품인지 확인 · 실질가 낮은 순`;
}

export function unverifiedGroupText(count: number): string {
  return `미검증 ${count} · 상품 페이지를 읽지 않아 고를 수 없고 실질가 순위에서 뺐습니다. '재고 확인'은 그 페이지만 읽습니다. 읽지 못한 칸은 '수동 확인'으로 둡니다.`;
}

/** 앵커 줄 글('型番 1201A019 · 색상 코드 108 · クリーム×ブラック(108)') */
export function anchorLabel(
  head: Pick<
    SourcingComparisonDetail,
    | 'anchorModelCodeNorm'
    | 'anchorModelCode'
    | 'anchorItemCode'
    | 'anchorColorCode'
    | 'anchorColorLabel'
  >,
): string {
  const model = head.anchorModelCodeNorm ?? head.anchorModelCode;
  return [
    model ? `型番 ${model}` : head.anchorItemCode,
    head.anchorColorCode ? `색상 코드 ${head.anchorColorCode}` : null,
    head.anchorColorLabel,
  ]
    .filter((part): part is string => !!part)
    .join(' · ');
}

export const ANCHOR_LOCKED_NOTE =
  '이 후보에서는 바꿀 수 없습니다 · 다른 모델·색상은 새 후보로 만듭니다';

export interface CandidateGenderLike {
  gender: ComparisonGender | null;
  genderSource: 'STEP2' | 'OWNER' | null;
  genderRecheckRequired: boolean;
}

/** 비교에 쓰는 성별(오너 → 자동 → ②에서 고른 성별 → 후보 ② 값)과 출처 */
export function comparisonGender(
  candidate: CandidateGenderLike | undefined,
  head: Pick<SourcingComparisonDetail, 'detectedGender' | 'ownerGender'> | undefined,
): { gender: ComparisonGender | null; source: 'OWNER' | 'AUTO' | null } {
  if (candidate?.genderSource === 'OWNER' && candidate.gender) {
    return { gender: candidate.gender, source: 'OWNER' };
  }
  const auto = head?.detectedGender ?? null;
  if (auto) return { gender: auto, source: 'AUTO' };
  const owner = head?.ownerGender ?? null;
  if (owner) return { gender: owner, source: 'OWNER' };
  return candidate?.gender
    ? { gender: candidate.gender, source: 'AUTO' }
    : { gender: null, source: null };
}

export const GENDER_LABEL: Record<ComparisonGender, string> = { MALE: '남성', FEMALE: '여성' };

export function targetRangeText(gender: ComparisonGender, params: ComparisonParams): string {
  const r = params.targetSizeMm[gender];
  return `${r.min}~${r.max}mm`;
}

/** 목표 범위 5mm 칸 수(화면 '5/9'의 9) */
export function targetSizeCount(
  gender: ComparisonGender | null,
  params: ComparisonParams,
): number | null {
  if (!gender) return null;
  const r = params.targetSizeMm[gender];
  return Math.floor((r.max - r.min) / 5) + 1;
}

export type AnchorMatchTone = 'done' | 'waiting' | 'idle' | 'neutral';

/** 앵커 일치 칸(보드: '일치' done·'확인 필요' waiting + 아래 설명·'확인 전' 등) */
export function anchorMatchView(
  row: Pick<
    SourcingComparisonRow,
    | 'anchorMatch'
    | 'janMatch'
    | 'makerModelMatch'
    | 'ownerMatchDecision'
    | 'colorCode'
    | 'isVerified'
    | 'rowSource'
  >,
): { label: string; tone: AnchorMatchTone; note: string | null } {
  if (row.ownerMatchDecision === 'MATCH')
    return { label: '같은 상품', tone: 'done', note: '오너 판단' };
  if (row.ownerMatchDecision === 'NO_MATCH')
    return { label: '다른 상품', tone: 'idle', note: '오너 판단' };
  if (row.anchorMatch === null || row.anchorMatch === undefined) {
    return { label: '확인 전', tone: 'neutral', note: null };
  }
  if (row.anchorMatch === 'MATCH') {
    if (row.janMatch === false) return { label: '확인 필요', tone: 'waiting', note: 'JAN 다름' };
    if (row.makerModelMatch === false) {
      return { label: '확인 필요', tone: 'waiting', note: 'メーカー型番 다름' };
    }
    return { label: '일치', tone: 'done', note: null };
  }
  if (row.anchorMatch === 'NEEDS_REVIEW') {
    return {
      label: '확인 필요',
      tone: 'waiting',
      note: row.colorCode ? '시리즈만 같음' : '색상 코드 없음',
    };
  }
  return { label: '불일치', tone: 'idle', note: null };
}

/** 오너 판단이 필요한(불확실한) 행 — 펼친 행에 AI 참고·'같은 상품'·'다른 상품'을 보인다 */
export function needsOwnerDecision(
  row: Pick<
    SourcingComparisonRow,
    'anchorMatch' | 'janMatch' | 'makerModelMatch' | 'ownerMatchDecision' | 'aiMatch'
  >,
): boolean {
  return (
    (row.ownerMatchDecision ?? null) !== null ||
    (row.aiMatch ?? null) !== null ||
    row.anchorMatch === 'NEEDS_REVIEW' ||
    (row.anchorMatch === 'MATCH' && (row.janMatch === false || row.makerModelMatch === false))
  );
}

/** 합계 포인트 배율(배) = 기본 1 + 상품 추가분 + 샵·이벤트 + SPU(BE effective-price와 같은 식) */
export function pointMultiplier(
  row: Pick<SourcingComparisonRow, 'apiPointRate' | 'shopEventMultiplier'>,
  params: ComparisonParams,
): { base: number; item: number; shopEvent: number; spu: number; total: number } {
  const rate = row.apiPointRate ?? 0;
  const item = rate <= 0 ? 0 : params.pointRateIncludesBase ? Math.max(rate - 1, 0) : rate;
  const total = 1 + item + row.shopEventMultiplier + params.spuMultiplier;
  return { base: 1, item, shopEvent: row.shopEventMultiplier, spu: params.spuMultiplier, total };
}

function times(n: number): string {
  return `${Math.round(n * 10_000) / 10_000}배`;
}

export function multiplierText(n: number): string {
  return times(n);
}

/**
 * 펼친 행 포인트 설명(보드: '포인트 10배 = 기본 1 + 상품 추가 9 + 샵·이벤트 0 → 1,090pt (근사). 실질가에는 포인트의 절반을
 * 반영합니다. 값을 바꾸면 바로 다시 계산합니다.'). k_rank가 0.5가 아니면 '× k'
 */
export function pointBreakdownText(
  row: Pick<SourcingComparisonRow, 'apiPointRate' | 'shopEventMultiplier' | 'pointsTotalPt'>,
  params: ComparisonParams,
): string {
  const m = pointMultiplier(row, params);
  const parts = [`기본 ${m.base}`, `상품 추가 ${m.item}`, `샵·이벤트 ${m.shopEvent}`];
  if (m.spu > 0) parts.push(`SPU ${m.spu}`);
  const total = row.pointsTotalPt ?? null;
  const pt = total === null ? '—' : `${formatCount(total)}pt`;
  const share = params.kRank === 0.5 ? '포인트의 절반을' : `포인트 × ${kRankText(params.kRank)}를`;
  return `포인트 ${times(m.total)} = ${parts.join(' + ')} → ${pt} (근사). 실질가에는 ${share} 반영합니다. 값을 바꾸면 바로 다시 계산합니다.`;
}

/** 리뷰 글(F-SO-28 '리뷰(수·평점)'): '리뷰 12건 · 평점 4.50', 없으면 '리뷰 정보 없음' */
export function reviewText(
  row: Pick<SourcingComparisonRow, 'reviewCount' | 'reviewAverage'>,
): string {
  const count = row.reviewCount ?? null;
  if (count === null) return '리뷰 정보 없음';
  const average = row.reviewAverage ?? null;
  return count > 0 && average !== null
    ? `리뷰 ${formatCount(count)}건 · 평점 ${average.toFixed(2)}`
    : `리뷰 ${formatCount(count)}건`;
}

/** 해외 배송 글(F-SO-28 '해외 배송 가능', API `shipOverseasFlag`) */
export function shipOverseasText(value: boolean | null | undefined): string {
  if (value === true) return '해외 배송 가능';
  if (value === false) return '해외 배송 안 함';
  return '해외 배송 정보 없음';
}

/** 펼친 행 '상품' 줄의 보조 글: 리뷰 · 해외 배송 */
export function itemFactsText(
  row: Pick<SourcingComparisonRow, 'reviewCount' | 'reviewAverage' | 'shipOverseas'>,
): string {
  return `${reviewText(row)} · ${shipOverseasText(row.shipOverseas)}`;
}

/**
 * '같은 상품인가' 줄의 이 상품 식별 글: '型番 1201A019 · 색상 코드 없음 · JAN 확인 전'.
 * 페이지 재대조가 어긋나면 'JAN 다름'·'メーカー型番 다름'
 */
export function rowIdentityText(
  row: Pick<SourcingComparisonRow, 'modelCodeNorm' | 'colorCode' | 'janMatch' | 'makerModelMatch'>,
): string {
  const jan =
    row.janMatch === true ? 'JAN 같음' : row.janMatch === false ? 'JAN 다름' : 'JAN 확인 전';
  const parts = [
    `型番 ${row.modelCodeNorm ?? '없음'}`,
    `색상 코드 ${row.colorCode ?? '없음'}`,
    jan,
  ];
  if (row.makerModelMatch === false) parts.push('メーカー型番 다름');
  return parts.join(' · ');
}

/**
 * 펼친 행 사이즈 칸(스냅샷 SKU로 FE가 다시 그림)의 '있음' 수가 서버 판정(`inStockSizeCount`)과 다르면 안내 글, 같거나 볼 수
 * 없으면 null. 사이즈별 상태를 API가 주지 않아 `sizeStockOf`가 BE 재고 판정 규칙을 복제하므로, 규칙·설정이 어긋날 때 오너가
 * 화면 칸을 판정으로 오해하지 않게 한다(고르기·순위는 서버 값이 기준)
 */
export function sizeStockMismatchText(
  sizes: readonly { status: SizeStatus }[],
  row: Pick<SourcingComparisonRow, 'inStockSizeCount'>,
): string | null {
  const server = row.inStockSizeCount ?? null;
  if (sizes.length === 0 || server === null) return null;
  const drawn = sizes.filter((s) => s.status === 'IN_STOCK').length;
  if (drawn === server) return null;
  return `사이즈 칸(재고 ${drawn}개)이 서버 판정(재고 ${server}개)과 다릅니다. 고르기·순위는 서버 판정을 따릅니다.`;
}

/** 표시 열(F-SO-28): 상품명의 並行輸入品·アウトレット(위험 플래그 전체 RK-10은 M2) */
export function itemNameMarks(itemName: string): string[] {
  const text = itemName.normalize('NFKC');
  const marks: string[] = [];
  if (/並行輸入/.test(text)) marks.push('並行輸入品');
  if (/アウトレット/.test(text)) marks.push('アウトレット');
  return marks;
}

export type SizeStatus = 'IN_STOCK' | 'SOLD_OUT' | 'BACK_ORDER' | 'NONE';

export const SIZE_STATUS_LABEL: Record<SizeStatus, string> = {
  IN_STOCK: '있음',
  SOLD_OUT: '품절',
  BACK_ORDER: '取り寄せ',
  NONE: '없음',
};

function normalizeLabel(label: string | null | undefined): string {
  return (label ?? '').normalize('NFKC').toUpperCase().replace(/\s+/g, '');
}

function isDefaultWidth(width: string | null, defaultWidth: string): boolean {
  if (!width || width.trim() === '') return true;
  const a = normalizeLabel(width);
  const b = normalizeLabel(defaultWidth);
  if (a === b || (a.includes('標準') && b.includes('標準'))) return true;
  const head = b.replace(/[(（].*$/, '');
  return head !== '' && a === head;
}

/**
 * 펼친 행의 사이즈별 칸('250 있음 · 270 품절 · 280 取り寄せ · 290 없음'). 스냅샷 SKU로 BE 재고 판정(stock-judgement)과 같은
 * 규칙을 다시 그린다(앵커 색상·기본 폭·hidden·取り寄せ). 성별을 모르면 빈 목록
 */
export function sizeStockOf(
  skus: readonly Pick<
    RakutenSkuVariant,
    'colorLabel' | 'colorCode' | 'sizeMm' | 'widthLabel' | 'quantity' | 'hidden' | 'backOrder'
  >[],
  input: {
    gender: ComparisonGender | null;
    params: ComparisonParams;
    anchorColorCode: string | null;
    anchorColorLabel: string | null;
    itemBackOrderFlag: boolean | null;
  },
): { sizeMm: number; status: SizeStatus }[] {
  if (!input.gender) return [];
  const r = input.params.targetSizeMm[input.gender];
  const code = input.anchorColorCode ? normalizeLabel(input.anchorColorCode) : null;
  const label = input.anchorColorLabel ? normalizeLabel(input.anchorColorLabel) : null;
  const colors = new Set(skus.map((s) => normalizeLabel(s.colorLabel)));
  let ofColor = skus.filter((s) => {
    if (!code && !label) return true;
    if (code && s.colorCode) return normalizeLabel(s.colorCode) === code;
    if (label && s.colorLabel) return normalizeLabel(s.colorLabel) === label;
    return false;
  });
  if (ofColor.length === 0 && colors.size <= 1) ofColor = [...skus];
  const pool = ofColor
    .map((s) => ({ ...s, size: s.sizeMm ?? null }))
    .filter(
      (s): s is typeof s & { size: number } =>
        isDefaultWidth(s.widthLabel ?? null, input.params.defaultWidth) &&
        s.size !== null &&
        s.size >= r.min &&
        s.size <= r.max,
    );
  const steps = new Set<number>();
  for (let mm = r.min; mm <= r.max; mm += 5) steps.add(mm);
  for (const s of pool) steps.add(s.size);
  const backOrderOf = (s: (typeof pool)[number]) => s.backOrder ?? input.itemBackOrderFlag ?? false;
  const inStock = (s: (typeof pool)[number]) => {
    if (s.hidden) return false;
    if (backOrderOf(s)) return !input.params.excludeBackOrder;
    return (s.quantity ?? 0) > 0;
  };
  return [...steps]
    .sort((a, b) => a - b)
    .map((sizeMm) => {
      const here = pool.filter((s) => s.size === sizeMm);
      if (here.some(inStock)) return { sizeMm, status: 'IN_STOCK' as const };
      if (here.length === 0) return { sizeMm, status: 'NONE' as const };
      if (here.some((s) => !s.hidden && backOrderOf(s)))
        return { sizeMm, status: 'BACK_ORDER' as const };
      return { sizeMm, status: 'SOLD_OUT' as const };
    });
}

/** 고를 수 없는 이유(없으면 null) — 서버가 최종으로 본다(409). 화면은 미검증·재고 부족·닫힌 버전만 미리 끈다 */
export function selectBlockedReason(
  row: Pick<SourcingComparisonRow, 'isVerified' | 'stockPass'>,
  head: Pick<SourcingComparisonDetail, 'stepStatus' | 'isCurrent' | 'exploreMode'>,
): string | null {
  if (!head.isCurrent || head.stepStatus !== 'WAITING_INPUT')
    return '입력을 기다리는 ② 버전에서만 고를 수 있습니다.';
  if (head.exploreMode) return '기준 모델·색상을 먼저 정해 주세요.';
  if (!row.isVerified)
    return "재고를 확인하지 않은 상품은 고를 수 없습니다. '재고 확인'을 눌러 주세요.";
  if (row.stockPass === false) return '목표 사이즈 재고가 모자란 상품입니다.';
  return null;
}

/** 비교표를 바꿀 수 있는가(쿠폰·배율·재고 확인·수동 행) */
export function isComparisonEditable(
  head:
    Pick<SourcingComparisonDetail, 'stepStatus' | 'isCurrent' | 'comparisonPerformed'> | undefined,
): boolean {
  return (
    !!head && head.isCurrent && head.comparisonPerformed && head.stepStatus === 'WAITING_INPUT'
  );
}

/**
 * PATCH 응답을 비교표 캐시에 반영한다: 그 행을 바꾸고, 검증 행을 `rankedRowIds` 순서로 다시 세운다(미검증 행은 뒤 그대로)
 */
export function applyRecalculation(
  detail: SourcingComparisonDetail,
  result: SourcingRowRecalculation,
): SourcingComparisonDetail {
  const rows = detail.rows.map((r) => (r.id === result.row.id ? result.row : r));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ranked = result.rankedRowIds
    .map((id) => byId.get(id))
    .filter((r): r is SourcingComparisonRow => r !== undefined);
  const rankedIds = new Set(ranked.map((r) => r.id));
  const rest = rows.filter((r) => !rankedIds.has(r.id));
  return { ...detail, rows: [...ranked, ...rest] };
}
