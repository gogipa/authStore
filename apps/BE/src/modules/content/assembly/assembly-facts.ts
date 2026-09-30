import { sha256Hex, canonicalJson } from '../../step-engine/domain/fingerprint.js';
import type { FieldDraft, FieldJson } from '../fields/content-field.store.js';

/**
 * ⑥-3이 읽는 ⑥-2 결과(P3-04 규칙 10 — 사양 블록과 고시는 ⑥-2와 **같은 레코드**로 만든다). ⑥-2 사실 필드 행(유효 값 = 오너 입력
 * 반영)과 머리 행의 선택 색상 원문을 한 모양으로 모은다. 입력 지문(`noticeRaw.facts`)도 이 값이다.
 */
export interface AssemblyHeel {
  value: number;
  unit: 'cm' | 'mm';
  /** 근거 원문 발췌(오너 입력이면 null) */
  quote: string | null;
  ownerInput: boolean;
}

export interface AssemblyMaterials {
  upper: string | null;
  lining: string | null;
  sole: string | null;
}

export interface AssemblyFacts {
  /** 한국어 나라 이름(⑥-2 fact.origin) */
  origin: string[];
  materials: AssemblyMaterials;
  heel: AssemblyHeel | null;
  /** 색상 한국어 표기(fact.color_ko, 없으면 null) */
  colorKo: string | null;
  /** 선택 색상 원문(content_draft_fact.selected_color_raw) */
  selectedColorRaw: string | null;
  /** 소재별 주의 문구(fact.caution, 없으면 null) */
  caution: string | null;
}

interface FactRowLike {
  fieldKey: string;
  value: FieldJson | null;
  valueSource: string;
  evidenceQuote: string | null;
}

function textOf(value: FieldJson | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function heelOf(row: FactRowLike | undefined): AssemblyHeel | null {
  const value = row?.value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as { value?: unknown; unit?: unknown };
  if (typeof v.value !== 'number' || (v.unit !== 'cm' && v.unit !== 'mm')) return null;
  return {
    value: v.value,
    unit: v.unit,
    quote: row?.evidenceQuote ?? null,
    ownerInput: row?.valueSource === 'OWNER_INPUT',
  };
}

/** ⑥-2 필드 행 → ⑥-3 입력 모양 */
export function assemblyFactsOf(
  rows: readonly (FactRowLike | FieldDraft)[],
  selectedColorRaw: string | null,
): AssemblyFacts {
  const row = (key: string) => rows.find((r) => r.fieldKey === key);
  const origin = row('fact.origin')?.value;
  return {
    origin: Array.isArray(origin)
      ? origin.filter((c): c is string => typeof c === 'string' && c.trim() !== '')
      : [],
    materials: {
      upper: textOf(row('fact.material_upper')?.value),
      lining: textOf(row('fact.material_lining')?.value),
      sole: textOf(row('fact.material_sole')?.value),
    },
    heel: heelOf(row('fact.heel_height')),
    colorKo: textOf(row('fact.color_ko')?.value),
    selectedColorRaw: selectedColorRaw?.trim() ? selectedColorRaw.trim() : null,
    caution: textOf(row('fact.caution')?.value),
  };
}

/** 굽·밑창 높이 → cm 수(소수 한 자리까지) */
export function heelCm(heel: Pick<AssemblyHeel, 'value' | 'unit'>): number {
  const cm = heel.unit === 'mm' ? heel.value / 10 : heel.value;
  return Math.round(cm * 10) / 10;
}

/**
 * '재확인 필요' 근거 요약값(ERD `content_draft_field.basis_sha256`, P3-04 규칙 15 — Proposed 정의).
 * - notice.size = 판매 사이즈 집합(정렬) → SALE_SIZES_CHANGED
 * - notice.material = ⑥-2 겉감·안감·밑창 값, notice.origin_area = ⑥-2 원산지 나라 → NOTICE_RAW_CHANGED
 * 값은 정규화 JSON의 SHA-256(입력 지문과 같은 방식)
 */
export function sizeBasisSha256(sizes: readonly number[]): string {
  return sha256Hex(canonicalJson([...new Set(sizes)].sort((a, b) => a - b)));
}

export function materialBasisSha256(facts: Pick<AssemblyFacts, 'materials'>): string {
  return sha256Hex(canonicalJson(facts.materials));
}

export function originBasisSha256(facts: Pick<AssemblyFacts, 'origin'>): string {
  return sha256Hex(canonicalJson(facts.origin));
}
