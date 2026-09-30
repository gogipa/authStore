import { htmlText } from '../../../common/rules/detail-html.js';
import type { AssemblyFacts } from './assembly-facts.js';
import { heelCm } from './assembly-facts.js';
import { escapeHtml } from './html/html-text.js';
import { formatSaleSizes } from './notice/size-format.js';

/**
 * 상품 사양 블록(P3-04 규칙 10, F-CT-28, US-15 AC3·AC4, PRD §8.5 '상품 사양 블록'). ⑥-2와 **같은 레코드**로 만든다 — 사양 블록의
 * 제조국·소재는 고시 값과 같다.
 * ```
 * [상품 사양]
 * · 제조국(원산지): {제조국}          ← ⑥-2가 원산지를 확정해야 ⑥-3이 시작한다
 * · 소재: 겉감 {…} / 안감 {…} / 밑창 {…}   ← 근거 없는 칸은 뺀다(셋 다 없으면 행을 뺀다)
 * · 굽·밑창 높이: 약 {n}cm            ← 근거 없으면 행을 뺀다. 고시 height를 뺀 신발도 근거가 있으면 적는다
 * · 사이즈: {mm 목록}mm (JP {cm 목록}cm)
 * ```
 * 마크업: `<div data-autostore-section="SPEC"><p><strong>[상품 사양]</strong></p><ul><li data-spec-row="ORIGIN">…</li>…</ul></div>`.
 * 행 표식(`data-spec-row`)은 오너가 고시 `material`·`size`를 고칠 때 같은 행을 바꾸려고 둔다(사양 블록과 고시를 같게 유지).
 */

export const SPEC_ROW_KEYS = ['ORIGIN', 'MATERIAL', 'HEIGHT', 'SIZE'] as const;
export type SpecRowKey = (typeof SPEC_ROW_KEYS)[number];

export interface SpecRow {
  key: SpecRowKey;
  /** 머리표·이름을 뺀 값 글(예 `베트남`, `겉감 합성섬유 / 밑창 고무`) */
  value: string;
}

export const SPEC_TITLE = '[상품 사양]';

const ROW_LABEL: Readonly<Record<SpecRowKey, string>> = {
  ORIGIN: '제조국(원산지)',
  MATERIAL: '소재',
  HEIGHT: '굽·밑창 높이',
  SIZE: '사이즈',
};

/** 사양 블록 소재 값: 근거 있는 칸만(없으면 null — 행을 뺀다) */
export function specMaterialText(materials: AssemblyFacts['materials']): string | null {
  const parts = [
    materials.upper ? `겉감 ${materials.upper}` : null,
    materials.lining ? `안감 ${materials.lining}` : null,
    materials.sole ? `밑창 ${materials.sole}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' / ') : null;
}

/** 사양 블록 행(규칙 10) */
export function buildSpecRows(input: {
  specOriginLabel: string;
  facts: AssemblyFacts;
  sizes: readonly number[];
}): SpecRow[] {
  const rows: SpecRow[] = [{ key: 'ORIGIN', value: input.specOriginLabel }];
  const material = specMaterialText(input.facts.materials);
  if (material) rows.push({ key: 'MATERIAL', value: material });
  if (input.facts.heel) rows.push({ key: 'HEIGHT', value: `약 ${heelCm(input.facts.heel)}cm` });
  rows.push({ key: 'SIZE', value: formatSaleSizes(input.sizes) });
  return rows;
}

/** 행 한 줄의 글(`· 제조국(원산지): 베트남`) */
export function specRowText(row: SpecRow): string {
  return `· ${ROW_LABEL[row.key]}: ${row.value}`;
}

export function renderSpecBlock(rows: readonly SpecRow[]): string {
  const items = rows
    .map((row) => `<li data-spec-row="${row.key}">${escapeHtml(specRowText(row))}</li>`)
    .join('');
  return `<div data-autostore-section="SPEC"><p><strong>${escapeHtml(SPEC_TITLE)}</strong></p><ul>${items}</ul></div>`;
}

/** 저장된 사양 블록 HTML → 행(이 파일이 만든 마크업만 읽는다) */
export function parseSpecRows(html: string): SpecRow[] {
  const rows: SpecRow[] = [];
  for (const match of html.matchAll(/<li data-spec-row="([A-Z_]+)">([\s\S]*?)<\/li>/g)) {
    const key = match[1] as SpecRowKey;
    if (!(SPEC_ROW_KEYS as readonly string[]).includes(key)) continue;
    const text = htmlText(match[2]!);
    const prefix = `· ${ROW_LABEL[key]}: `;
    rows.push({ key, value: text.startsWith(prefix) ? text.slice(prefix.length) : text });
  }
  return rows;
}

/** 행 하나를 바꾸거나(있으면) 순서 자리에 넣는다 */
export function withSpecRow(rows: readonly SpecRow[], row: SpecRow): SpecRow[] {
  const others = rows.filter((r) => r.key !== row.key);
  const out = [...others, row];
  return out.sort((a, b) => SPEC_ROW_KEYS.indexOf(a.key) - SPEC_ROW_KEYS.indexOf(b.key));
}
