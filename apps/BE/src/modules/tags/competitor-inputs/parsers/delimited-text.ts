/**
 * 붙여 넣은 표·CSV 읽기(P3-05 — 새 의존성 없음). 엑셀에서 복사한 표는 탭으로, CSV는 쉼표로 나뉜다. 따옴표("…")와 따옴표 안
 * 줄바꿈·"" 이스케이프를 받는다(RFC 4180). 순수 함수.
 */

/** 줄 끝(\r\n·\r·\n)과 구분자로 나눈 칸. 끝의 빈 줄은 뺀다 */
export function parseDelimited(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell.length === 0) {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      pushRow();
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (cell.length > 0 || row.length > 0) pushRow();
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.trim().length === 0)) rows.pop();
  return rows;
}

/** 붙여 넣은 글의 구분자: 탭이 있으면 탭(엑셀 복사), 아니면 쉼표 */
export function detectDelimiter(text: string): ',' | '\t' {
  return text.includes('\t') ? '\t' : ',';
}

/** UTF-8 글자로 읽는다(BOM은 뺀다). UTF-8이 아니면 null */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.startsWith('﻿') ? text.slice(1) : text;
  } catch {
    return null;
  }
}
