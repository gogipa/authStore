import { normalizeModelCode } from './page-json.parser.js';

export { normalizeModelCode };

/**
 * 동일 상품 분류(PRD §8.2 RK-03, F-SO-09·10, P2-03 규칙 2·4). 순수 함수.
 * - 型番 정규화: NFKC → 대문자 → 공백·하이픈 제거(`normalizeModelCode`, P2-02 파서와 같은 함수)
 * - API 행의 型番·색상 코드는 상품명에서 뽑는다(Proposed): 영문과 숫자가 섞인 5~20자 토큰(숫자 3개 이상, `cm`·`mm`로 끝나지
 *   않음)이 型番이고, 바로 뒤에 하이픈(또는 붙어서) 이어지는 영문·숫자 2~4자가 색상 코드다('1201A019-108' → 1201A019 + 108)
 * - 분류: 앵커의 '모델+색상 코드'가 정확히 같으면 MATCH. 모델은 같은데 색상 코드가 없으면 NEEDS_REVIEW, 다른 색상이면 NO_MATCH.
 *   모델이 다르지만 '시리즈가 같으면'(Proposed: 앞에서부터 max(4, 앵커 型番 길이 − 2)자가 같다 — 1201A019·1201A018)
 *   NEEDS_REVIEW, 그 밖은 NO_MATCH. 앵커 색상 코드를 모르면 모델이 같아도 NEEDS_REVIEW
 * - 앵커 型番을 모르면(型番 없는 상품을 앵커로 고름) 앵커 itemCode 행만 MATCH, 나머지는 NEEDS_REVIEW(Proposed)
 * - 페이지를 읽은 행은 JAN(`articleNumber`)·メーカー型番으로 다시 대조한다(`recheckWithPage`, NULL = 확인 안 함).
 *   대조 결과는 `anchor_match`를 바꾸지 않는다(Proposed) — 선택할 수 있는지는 `effectiveMatch`가 합쳐서 본다
 */

export type AnchorMatch = 'MATCH' | 'NEEDS_REVIEW' | 'NO_MATCH';

export interface AnchorKey {
  /** 앵커 型番 정규화값(없으면 null) */
  modelCodeNorm: string | null;
  /** 앵커 색상 코드(정규화 전 원문 — 비교는 정규화해서) */
  colorCode: string | null;
  /** SEARCH_PICK 앵커 itemCode */
  itemCode: string | null;
}

export interface ExtractedModelCode {
  modelCodeNorm: string;
  colorCode: string | null;
}

const HYPHENS = '\\-‐‑‒–—―';
/** 型番 후보 토큰(NFKC·대문자 뒤) + 선택 색상 코드 */
const MODEL_TOKEN = new RegExp(
  `(?<![A-Z0-9])([A-Z0-9]{5,20})(?:[${HYPHENS}]([A-Z0-9]{2,4}))?(?![A-Z0-9])`,
  'g',
);

function isModelLike(token: string): boolean {
  const digits = (token.match(/\d/g) ?? []).length;
  const letters = (token.match(/[A-Z]/g) ?? []).length;
  return digits >= 3 && letters >= 1 && !/(CM|MM)$/.test(token);
}

function upper(text: string): string {
  return text.normalize('NFKC').toUpperCase();
}

/** 색상 코드 비교값 */
export function normalizeColorCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const norm = upper(code).replace(/[\s\-‐‑‒–—―]/g, '');
  return norm === '' ? null : norm;
}

/** 상품명에서 첫 型番(+ 색상 코드)을 뽑는다. 없으면 null */
export function extractModelCode(itemName: string): ExtractedModelCode | null {
  const text = upper(itemName);
  for (const m of text.matchAll(MODEL_TOKEN)) {
    const token = m[1]!;
    if (!isModelLike(token)) continue;
    return { modelCodeNorm: token.slice(0, 128), colorCode: m[2] ?? null };
  }
  return null;
}

/** 앵커 型番이 상품명에 있을 때 그 뒤의 색상 코드(하이픈으로 잇거나 붙은 영문·숫자 2~4자). 型番이 없으면 undefined */
export function colorCodeAfterModel(
  itemName: string,
  modelCodeNorm: string,
): string | null | undefined {
  const text = upper(itemName);
  // 型番 글자 사이의 공백·하이픈은 허용한다('1201A-019')
  const chars = [...modelCodeNorm].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(
    `(?<![A-Z0-9])${chars.join(`[\\s${HYPHENS}]?`)}(?:[${HYPHENS}]\\s*([A-Z0-9]{2,4})|([0-9]{2,4}))?(?![A-Z0-9])`,
  );
  const m = pattern.exec(text);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? null;
}

/** '시리즈가 같다'(Proposed): 앞에서부터 max(4, 앵커 길이 − 2)자가 같고 型番은 다르다 */
export function isSameSeries(a: string, b: string): boolean {
  if (a === b) return false;
  const need = Math.max(4, a.length - 2);
  if (b.length < need || a.length < need) return false;
  return a.slice(0, need) === b.slice(0, need);
}

export interface RowClassification {
  anchorMatch: AnchorMatch;
  /** 행 상품의 정규화 型番(뽑지 못하면 null) */
  modelCodeNorm: string | null;
  /** 행 상품의 색상 코드(뽑지 못하면 null) */
  colorCode: string | null;
}

/**
 * 행 하나를 앵커와 비교한다(F-SO-09). `row.modelCode`(페이지 メーカー型番 등 알고 있는 型番)가 있으면 그것을 먼저,
 * 없으면 상품명에서 뽑는다.
 */
export function classifyRow(
  anchor: AnchorKey,
  row: { itemCode: string; itemName: string; modelCode?: string | null; colorCode?: string | null },
): RowClassification {
  const anchorColor = normalizeColorCode(anchor.colorCode);
  if (!anchor.modelCodeNorm) {
    const extracted = extractModelCode(row.itemName);
    return {
      anchorMatch: anchor.itemCode && row.itemCode === anchor.itemCode ? 'MATCH' : 'NEEDS_REVIEW',
      modelCodeNorm: extracted?.modelCodeNorm ?? null,
      colorCode: row.colorCode ?? extracted?.colorCode ?? null,
    };
  }
  const model = anchor.modelCodeNorm;
  // 1) 알고 있는 型番(メーカー型番 '1201A019-108' 등)
  const known = row.modelCode ? normalizeModelCode(row.modelCode) : null;
  let rowModel: string | null = null;
  let rowColor: string | null = normalizeColorCode(row.colorCode ?? null);
  if (known && (known === model || known.startsWith(model))) {
    rowModel = model;
    rowColor = rowColor ?? normalizeColorCode(known.slice(model.length)) ?? null;
  } else {
    // 2) 상품명 속 앵커 型番
    const after = colorCodeAfterModel(row.itemName, model);
    if (after !== undefined) {
      rowModel = model;
      rowColor = rowColor ?? normalizeColorCode(after);
    } else {
      const extracted =
        extractModelCode(row.itemName) ??
        (known ? { modelCodeNorm: known, colorCode: null } : null);
      rowModel = extracted?.modelCodeNorm ?? null;
      rowColor = rowColor ?? normalizeColorCode(extracted?.colorCode ?? null);
    }
  }
  let anchorMatch: AnchorMatch;
  if (rowModel === model) {
    if (!anchorColor || !rowColor) anchorMatch = 'NEEDS_REVIEW';
    else anchorMatch = rowColor === anchorColor ? 'MATCH' : 'NO_MATCH';
  } else if (rowModel && isSameSeries(model, rowModel)) {
    anchorMatch = 'NEEDS_REVIEW';
  } else {
    anchorMatch = 'NO_MATCH';
  }
  return { anchorMatch, modelCodeNorm: rowModel, colorCode: rowColor };
}

/**
 * 페이지를 읽은 행의 재대조(F-SO-10). NULL = 확인 안 함(비교할 값이 한쪽에 없다).
 * - JAN: 앵커 상품 페이지의 앵커 색상 SKU JAN 집합과 이 행 페이지의 같은 색상 SKU JAN 집합이 하나라도 겹치면 true
 * - メーカー型番: 페이지 型番 정규화값이 앵커 型番이거나 앵커 型番+색상 코드면 true, 다른 型番이면 false
 */
export function recheckWithPage(input: {
  anchor: AnchorKey;
  /** 앵커 상품 페이지의 앵커 색상 JAN(모르면 null) */
  anchorJans: readonly string[] | null;
  /** 이 행 페이지의 앵커 색상 SKU JAN */
  rowJans: readonly string[];
  /** 이 행 페이지의 メーカー型番 정규화값 */
  pageModelCodeNorm: string | null;
}): { janMatch: boolean | null; makerModelMatch: boolean | null } {
  const rowJans = input.rowJans.map((j) => j.trim()).filter((j) => j !== '');
  const anchorJans = (input.anchorJans ?? []).map((j) => j.trim()).filter((j) => j !== '');
  const janMatch =
    anchorJans.length === 0 || rowJans.length === 0
      ? null
      : rowJans.some((j) => anchorJans.includes(j));
  let makerModelMatch: boolean | null = null;
  const model = input.anchor.modelCodeNorm;
  const page = input.pageModelCodeNorm;
  if (model && page) {
    const color = normalizeColorCode(input.anchor.colorCode) ?? '';
    makerModelMatch = page === model || page === `${model}${color}`;
    if (!makerModelMatch && page.startsWith(model)) {
      // 型番 + 다른 색상 코드('1201A019001')는 다른 상품이다
      makerModelMatch = color === '' ? true : false;
    }
  }
  return { janMatch, makerModelMatch };
}

/**
 * 고를 수 있는 '같은 상품'인가(선택·K 집계, Proposed). 오너 판단이 있으면 그것이 최종이다(RK-03 6). 없으면 규칙 분류가
 * MATCH이고 JAN·メーカー型番 재대조가 어긋나지 않아야 한다(NULL은 통과)
 */
export function effectiveMatch(row: {
  anchorMatch: string | null;
  janMatch: boolean | null;
  makerModelMatch: boolean | null;
  ownerMatchDecision: string | null;
}): boolean {
  if (row.ownerMatchDecision === 'MATCH') return true;
  if (row.ownerMatchDecision === 'NO_MATCH') return false;
  return row.anchorMatch === 'MATCH' && row.janMatch !== false && row.makerModelMatch !== false;
}

/** AI 보조를 부를 만큼 불확실한가(Proposed): 규칙이 NEEDS_REVIEW거나, MATCH인데 JAN·メーカー型番이 어긋났고 오너 판단이 없다 */
export function isUncertain(row: {
  anchorMatch: string | null;
  janMatch: boolean | null;
  makerModelMatch: boolean | null;
  ownerMatchDecision: string | null;
}): boolean {
  if (row.ownerMatchDecision !== null) return false;
  if (row.anchorMatch === 'NEEDS_REVIEW') return true;
  return row.anchorMatch === 'MATCH' && (row.janMatch === false || row.makerModelMatch === false);
}

/** 상품명 표시(비교표 '표시' 열, F-SO-28): 並行輸入品·アウトレット(RK-10 위험 플래그 전체는 M2) */
export function itemNameMarks(itemName: string): string[] {
  const text = itemName.normalize('NFKC');
  const marks: string[] = [];
  if (/並行輸入/.test(text)) marks.push('並行輸入品');
  if (/アウトレット/.test(text)) marks.push('アウトレット');
  return marks;
}
