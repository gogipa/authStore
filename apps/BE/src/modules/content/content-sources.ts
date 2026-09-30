import { normalizeText } from '../step-engine/domain/fingerprint.js';
import type { SourcingItemContentView } from '../step-engine/ports/sourcing-selection.port.js';

/**
 * ⑥ 콘텐츠가 ② 산출물(step-engine `readSourcingItemContent`)에서 읽는 값 정리(P3-03). 단계 모듈끼리 import하지 않아 ② 페이지
 * 파서(sourcing)의 함수를 쓰지 않고 여기 둔다.
 */

/** 속성 한 줄(페이지 JSON `[{name, value}]` 원문 → 이름·값·글) */
export interface ItemAttribute {
  /** 원문 이름(예 `原産国／製造国`) */
  name: string;
  /** 원문 값(글·수·배열·`{value, unit}`) */
  value: unknown;
  /** 값을 글로 편 것(원문 표기 그대로) */
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** 속성 값 → 글(원문 표기). `{value:"3.5", unit:"cm"}` → `3.5cm`, 배열 → `、`로 잇기 */
export function attributeValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map(attributeValueText)
      .filter((s) => s !== '')
      .join('、');
  }
  if (isRecord(value)) {
    if ('value' in value) {
      const unit = typeof value.unit === 'string' ? value.unit.trim() : '';
      return `${attributeValueText(value.value)}${unit}`;
    }
    return JSON.stringify(value);
  }
  return '';
}

function attributeList(raw: unknown): ItemAttribute[] {
  if (!Array.isArray(raw)) return [];
  const out: ItemAttribute[] = [];
  for (const attr of raw) {
    if (!isRecord(attr)) continue;
    const name =
      typeof attr.name === 'string' ? attr.name : typeof attr.key === 'string' ? attr.key : null;
    if (!name || name.trim() === '') continue;
    const value = attr.value ?? attr.values ?? null;
    const text = attributeValueText(value);
    if (text === '') continue;
    out.push({ name: name.trim(), value, text });
  }
  return out;
}

/**
 * 상품 속성 + 선택 색상 SKU 속성을 한 목록으로(상품 속성 먼저, 같은 이름·값은 한 번). ⑥-1 입력 'SKU 속성'과 ⑥-2 1순위 추출의 원천
 */
export function flattenAttributes(
  itemAttributes: unknown,
  skuAttributes: readonly unknown[],
): ItemAttribute[] {
  const seen = new Set<string>();
  const out: ItemAttribute[] = [];
  for (const attr of [...attributeList(itemAttributes), ...skuAttributes.flatMap(attributeList)]) {
    const key = `${attr.name.normalize('NFKC')}\u0000${attr.text.normalize('NFKC')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(attr);
  }
  return out;
}

/** 입력 지문에 넣는 속성 값(이름·글을 NFKC·공백 정리) */
export function attributesInputValue(
  attributes: readonly ItemAttribute[],
): { name: string; text: string }[] {
  return attributes.map((a) => ({ name: normalizeText(a.name), text: normalizeText(a.text) }));
}

/** ⑥-1 입력 '② 상품명·설명'(상품명·설명 글을 NFKC·공백 정리) */
export function itemTextInputValue(content: SourcingItemContentView): {
  itemName: string;
  descriptionText: string;
} {
  return {
    itemName: normalizeText(content.itemName),
    descriptionText: normalizeText(content.descriptionText ?? ''),
  };
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * 설명 HTML → 글(원문 표기 그대로 — NFKC를 하지 않는다. 줄 나누기는 P2-02 `htmlToText`와 같다). ⑥-2 설명문 추출이 원문 발췌를
 * 남기려고 쓴다(P3-03 주의 '원문 발췌는 원문 표기를 그대로 남긴다')
 */
export function htmlToRawText(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t\f\v\u00a0\u3000]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
