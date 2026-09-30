import { canonicalJson, sha256Hex } from '../domain/fingerprint.js';

/**
 * 게이트 지문(F-CW-02, PRD §5.1 '게이트 지문', ERD `gate_pass.fingerprint`·`fingerprint_basis`, P1-06 규칙 8).
 * - 지문 = 구성값(basis)을 키 정렬 JSON(`canonicalJson`)으로 만든 SHA-256 hex 64자(`ck_gate_pass_fp`).
 * - 구성값은 `gate_pass.fingerprint_basis`(jsonb)에 그대로 남긴다. 무엇이 바뀌었는지(`changedBasisKeys`)를 보여 줄 때만 읽는다.
 * - 구성값 만들기(`g2Basis`·`g3Basis`)는 게이트 공급자(P2-05 G2, P3-02 G3)가 쓴다. 순서만 다른 값(사이즈·레퍼런스)은
 *   정렬해 같은 지문이 되게 하고, 지문에 넣지 않는 값(P_min·환율·수집 시각)은 받지 않는다.
 */

/** 게이트 구성값(키 → 값). JSON으로 저장할 수 있는 값만 넣는다 */
export type GateBasis = Record<string, unknown>;

/** 게이트 지문(소문자 hex 64자) */
export function gateFingerprint(basis: GateBasis): string {
  return sha256Hex(canonicalJson(basis));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 구성값을 잎(leaf) 경로 → 정규화 JSON으로 편다. 객체는 점으로 잇고, 배열·값·빈 객체는 한 칸이다 */
function flatten(value: unknown, prefix: string, out: Map<string, string>): void {
  if (isPlainObject(value) && !(value instanceof Date)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined);
    if (keys.length > 0 || prefix === '') {
      for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
      return;
    }
  }
  if (prefix !== '') out.set(prefix, canonicalJson(value));
}

/**
 * 바뀐 구성값 이름(05-2 CandidateGateState.changedBasisKeys): 두 구성값의 잎 경로를 합쳐 값이 다른 경로. 사전순.
 * 예: 250mm 판매가만 달라지면 `['salePrices.250']`, 앵커 색상만 달라지면 `['anchorKey.colorCode']`.
 */
export function changedBasisKeys(stored: unknown, current: unknown): string[] {
  const a = new Map<string, string>();
  const b = new Map<string, string>();
  flatten(stored, '', a);
  flatten(current, '', b);
  const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
  const missing = canonicalJson(null);
  return keys.filter((key) => (a.get(key) ?? missing) !== (b.get(key) ?? missing));
}

/** 판매 사이즈 한 칸(③ 판정 결과) */
export interface G2SaleSize {
  sizeMm: number;
  /** 사이즈별 판매가(원) */
  salePriceKrw: number | null;
  /** 사이즈별 옵션가(원, 대표가 대비) */
  optionPriceKrw: number | null;
}

/** G2 구성값 재료: ② 소싱 선택 + ③ 판정 결과(판매 후보 여부·판매 사이즈·사이즈별 판매가·옵션가) */
export interface G2BasisInput {
  itemCode: string | null;
  selectedColor: string | null;
  saleCandidate: boolean;
  saleSizes: readonly G2SaleSize[];
}

/**
 * G2 구성값(PRD §5.1): `{ itemCode, selectedColor, saleCandidate, saleSizes(오름차순), salePrices{mm}, optionPrices{mm} }`.
 * 최소 판매가(P_min)·환율·원가는 넣지 않는다 — ③을 다시 돌려 P_min만 바뀌면 G2는 그대로 유효하다.
 */
export function g2Basis(input: G2BasisInput): GateBasis {
  const bySize = new Map<number, G2SaleSize>();
  for (const size of input.saleSizes) bySize.set(size.sizeMm, size);
  const sizes = [...bySize.keys()].sort((x, y) => x - y);
  const salePrices: Record<string, number | null> = {};
  const optionPrices: Record<string, number | null> = {};
  for (const mm of sizes) {
    const size = bySize.get(mm)!;
    salePrices[String(mm)] = size.salePriceKrw;
    optionPrices[String(mm)] = size.optionPriceKrw;
  }
  return {
    itemCode: input.itemCode,
    selectedColor: input.selectedColor,
    saleCandidate: input.saleCandidate,
    saleSizes: sizes,
    salePrices,
    optionPrices,
  };
}

/** 앵커 키(型番 또는 앵커 itemCode + 색상 코드) */
export interface GateAnchorKey {
  modelCode: string | null;
  itemCode: string | null;
  colorCode: string | null;
}

/** G3 구성값 재료: 고른 레퍼런스 파일 해시 + 선택본 파일 해시 + 후보의 앵커 키 */
export interface G3BasisInput {
  referenceHashes: readonly string[];
  selectedHash: string | null;
  anchorKey: GateAnchorKey;
}

/** G3 구성값(PRD §5.1): `{ referenceHashes(정렬·중복 제거), selectedHash, anchorKey{modelCode,itemCode,colorCode} }` */
export function g3Basis(input: G3BasisInput): GateBasis {
  return {
    referenceHashes: [...new Set(input.referenceHashes)].sort(),
    selectedHash: input.selectedHash,
    anchorKey: {
      modelCode: input.anchorKey.modelCode,
      itemCode: input.anchorKey.itemCode,
      colorCode: input.anchorKey.colorCode,
    },
  };
}
