/**
 * ⑥-2 글 다루기(P3-03 주의: 설명문 패턴은 NFKC 뒤 글자(`／`→`/`, `：`→`:`, 전각 영숫자→반각)에 맞추고, 원문 발췌는 원문 표기를
 * 그대로 남긴다). 순수 함수.
 */

/** NFKC 글과 원문 위치 표: `text[i]`는 원문 `raw.slice(from[i], to[i])`에서 왔다 */
export interface MappedText {
  raw: string;
  text: string;
  from: number[];
  to: number[];
}

/** 앞 글자와 한 덩어리로 NFKC를 해야 하는 글자(결합 문자·반각 탁점·반탁점) */
const JOINS_PREVIOUS = /[\p{M}\uff9e\uff9f]/u;

/**
 * 원문을 NFKC로 바꾸며 위치 표를 만든다. 글자(+ 뒤따르는 결합 문자)마다 따로 NFKC를 해서 이어 붙인다 — 반각 가타카나 탁점
 * (`ｶﾞ`→`ガ`)도 한 덩어리로 바꾼다. 전체 NFKC와 같은 글이 된다(드문 조합 문자 순서 차이는 무시한다)
 */
export function mapNfkc(raw: string): MappedText {
  const chars = [...raw];
  let text = '';
  const from: number[] = [];
  const to: number[] = [];
  let offset = 0;
  let i = 0;
  while (i < chars.length) {
    let cluster = chars[i]!;
    let j = i + 1;
    while (j < chars.length && JOINS_PREVIOUS.test(chars[j]!)) {
      cluster += chars[j]!;
      j += 1;
    }
    const start = offset;
    const end = offset + cluster.length;
    for (const ch of cluster.normalize('NFKC')) {
      text += ch;
      for (let k = 0; k < ch.length; k += 1) {
        from.push(start);
        to.push(end);
      }
    }
    offset = end;
    i = j;
  }
  return { raw, text, from, to };
}

/** NFKC 글의 [start, end) → 원문 조각(앞뒤 공백 정리) */
export function rawSlice(mapped: MappedText, start: number, end: number): string {
  if (end <= start || start >= mapped.from.length) return '';
  const rawStart = mapped.from[start] ?? mapped.raw.length;
  const rawEnd = mapped.to[Math.min(end, mapped.to.length) - 1] ?? mapped.raw.length;
  return mapped.raw.slice(rawStart, rawEnd).trim();
}

/** 비교 키: NFKC + 대문자 + 공백 없음 */
export function compareKey(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/\s+/g, '');
}

/** 글자(가나·한자·영문·숫자 — 장음 'ー' 포함). 항목 이름 앞이 이 글자면 다른 낱말의 일부다('インソール'의 'ソール') */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * NFKC 글에서 항목 이름이 낱말 경계로 시작하는 위치들(대소문자 무시). 앞 글자가 글자·숫자면 다른 낱말의 일부로 본다.
 * `MADE IN`처럼 영문 이름은 뒤도 경계여야 한다.
 */
export function labelPositions(text: string, label: string): number[] {
  const needle = label.normalize('NFKC').toUpperCase();
  const hay = text.toUpperCase();
  if (needle === '') return [];
  const out: number[] = [];
  let at = hay.indexOf(needle);
  while (at >= 0) {
    const before = at > 0 ? hay[at - 1]! : '';
    const after = hay[at + needle.length] ?? '';
    const asciiLabel = /^[A-Z0-9 ]+$/.test(needle);
    const boundaryBefore = before === '' || !WORD_CHAR.test(before);
    const boundaryAfter = !asciiLabel || after === '' || !/[A-Z0-9]/.test(after);
    if (boundaryBefore && boundaryAfter) out.push(at);
    at = hay.indexOf(needle, at + 1);
  }
  return out;
}

/** 높이 값(`約3cm`·`3.5 cm`·`35mm`·`3センチ`) → `{value, unit}`. 못 읽으면 null */
export function parseHeight(text: string): { value: number; unit: 'cm' | 'mm' } | null {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(cm|mm|センチ|ミリ|㎝|㎜)/i.exec(text.normalize('NFKC'));
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = /^(mm|ミリ|㎜)$/i.test(m[2]!) ? 'mm' : 'cm';
  if ((unit === 'cm' && value > 30) || (unit === 'mm' && value > 300)) return null;
  return { value, unit };
}

/**
 * 나라 목록 글 → 나라 조각(`ベトナム、インドネシア、中国` → 3개, `中国製` → `中国`).
 * 영문 약칭의 마침표를 뗀다(`U.S.A.` → `USA`, M0 S7: AI가 맞게 읽고도 사전에서 못 찾은 값). 괄호 설명은 `splitParenNotes`가 먼저 뗀다.
 */
export function splitCountries(text: string): string[] {
  return text
    .normalize('NFKC')
    .split(/[、,，/・&＆]|\s+AND\s+|\s+and\s+|または|又は/)
    .map((s) =>
      s
        .trim()
        .replace(/^(MADE\s+IN|原産国|製造国|生産国)\s*[:：]?\s*/i, '')
        .replace(/製$/, '')
        .replace(/^(?:[A-Za-z]\.)+[A-Za-z]?\.?$/, (abbr) => abbr.replace(/\./g, ''))
        .trim(),
    )
    .filter((s) => s !== '');
}

/**
 * 괄호 설명을 떼어 낸다(NFKC 뒤 `(…)`, 전각 괄호 포함): 괄호 밖 글과 괄호 안 글 목록.
 * `日本（福岡県久留米市の自社工場）` → main `日本`, notes `['福岡県久留米市の自社工場']`. 괄호 밖이 비면(괄호만) 안의 글을 main으로 쓴다.
 * 괄호 안 `、`·`・`로 나라 조각이 잘못 잘리지 않게 `splitCountries`보다 먼저 쓴다(M0 S7 §4.2).
 */
export function splitParenNotes(text: string): { main: string; notes: string[] } {
  const normalized = text.normalize('NFKC');
  const notes: string[] = [];
  const main = normalized
    .replace(/\(([^()]*)\)/g, (_m, inner: string) => {
      if (inner.trim() !== '') notes.push(inner.trim());
      return ' ';
    })
    .trim();
  if (main === '') return { main: notes.join('、'), notes: [] };
  return { main, notes };
}

/** 소재 글 → 소재 조각(`合成繊維・合成皮革` → 2개) */
export function splitMaterials(text: string): string[] {
  return text
    .normalize('NFKC')
    .split(/[・、,，/+＋&＆]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}
