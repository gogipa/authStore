import { inflateRawSync } from 'node:zlib';

/**
 * 최소 xlsx 읽기(P3-05 Proposed — 새 의존성 없이). 셀라파인더 엑셀의 **첫 시트 값**만 글자로 읽는다(서식·수식·여러 시트는 보지
 * 않는다). xlsx = zip(Office Open XML): 중앙 디렉터리로 항목을 찾고, 저장(0)·deflate(8)만 푼다. 파일은 메모리에서만 읽고 디스크에
 * 쓰지 않는다.
 * 안전: 항목 수·푼 크기에 상한을 둔다(zip 폭탄). 깨졌거나 xlsx가 아니면 `XlsxReadError`(서비스가 IMPORT_PARSE_FAILED·
 * UNSUPPORTED_FILE_TYPE로 바꾼다).
 */

export class XlsxReadError extends Error {
  constructor(
    readonly kind: 'NOT_XLSX' | 'BROKEN',
    message: string,
  ) {
    super(message);
    this.name = 'XlsxReadError';
  }
}

/** zip 항목 수 상한 */
const MAX_ENTRIES = 2000;
/** 항목 하나를 풀었을 때 크기 상한(20MB) */
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
/** 시트 행 상한 */
const MAX_ROWS = 20_000;
/** 시트 열 상한(A~ZZ) */
const MAX_COLUMNS = 702;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

/** zip 파일의 첫 4바이트(PK\x03\x04) */
export function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4
  );
}

function readEntries(buf: Buffer): ZipEntry[] {
  const minEocd = 22;
  if (buf.length < minEocd) throw new XlsxReadError('BROKEN', 'zip이 너무 짧습니다');
  let eocd = -1;
  const stop = Math.max(0, buf.length - minEocd - 0xffff);
  for (let i = buf.length - minEocd; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxReadError('BROKEN', 'zip 끝 기록을 찾지 못했습니다');
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new XlsxReadError('BROKEN', 'zip 항목이 너무 많습니다');
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) {
      throw new XlsxReadError('BROKEN', 'zip 목록이 깨졌습니다');
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    entries.push({ name, method, compressedSize, localOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntry(buf: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOCAL_SIGNATURE) {
    throw new XlsxReadError('BROKEN', 'zip 항목 머리가 깨졌습니다');
  }
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw new XlsxReadError('BROKEN', 'zip 항목이 잘렸습니다');
  const data = buf.subarray(start, end);
  if (entry.method === 0) {
    if (data.length > MAX_ENTRY_BYTES) throw new XlsxReadError('BROKEN', '항목이 너무 큽니다');
    return Buffer.from(data);
  }
  if (entry.method !== 8) throw new XlsxReadError('BROKEN', '모르는 압축 방식입니다');
  try {
    return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
  } catch {
    throw new XlsxReadError('BROKEN', '압축을 풀지 못했습니다');
  }
}

/** XML 글자 참조를 푼다 */
export function decodeXmlText(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|lt|gt|amp|quot|apos);/g, (_m, ref: string) => {
    if (ref === 'lt') return '<';
    if (ref === 'gt') return '>';
    if (ref === 'amp') return '&';
    if (ref === 'quot') return '"';
    if (ref === 'apos') return "'";
    const code = ref.startsWith('#x') ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** `<t>…</t>`를 모두 이은 글(소리 표기 `<rPh>`는 뺀다) */
function textRuns(xml: string): string {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  // `<t/>`(빈 글)는 건너뛴다 — 마지막 글자가 '/'인 머리는 맞추지 않는다
  for (const m of body.matchAll(/<t(?:\s[^>]*[^/>])?>([\s\S]*?)<\/t>/g)) {
    out += decodeXmlText(m[1] ?? '');
  }
  return out;
}

function sharedStringsOf(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si(?:\s[^>]*)?\/>|<si(?:\s[^>]*[^/>])?>([\s\S]*?)<\/si>/g)].map((m) =>
    textRuns(m[1] ?? ''),
  );
}

/** 'BC12' → 열 번호(0부터) */
function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref.toUpperCase())?.[1] ?? '';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function firstSheetPath(workbook: string | null, rels: string | null): string {
  const rid = workbook ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1] : undefined;
  if (rid && rels) {
    for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attrs = m[1] ?? '';
      if (new RegExp(`\\bId="${rid}"`).test(attrs)) {
        const target = /\bTarget="([^"]+)"/.exec(attrs)?.[1];
        if (target) {
          const clean = target.replace(/^\/+/, '');
          return clean.startsWith('xl/') ? clean : `xl/${clean}`;
        }
      }
    }
  }
  return 'xl/worksheets/sheet1.xml';
}

/**
 * xlsx 첫 시트의 행(1행부터, 빈 행은 빈 배열로 자리만 둔다). 셀 값은 글자(숫자는 원문 글자, 참·거짓은 TRUE·FALSE).
 */
export function readXlsxRows(bytes: Uint8Array): string[][] {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!looksLikeZip(buf)) throw new XlsxReadError('NOT_XLSX', 'zip이 아닙니다');
  const entries = readEntries(buf);
  const byName = new Map(entries.map((e) => [e.name, e]));
  if (!byName.has('xl/workbook.xml')) throw new XlsxReadError('NOT_XLSX', 'xlsx가 아닙니다');
  const text = (name: string): string | null => {
    const entry = byName.get(name);
    return entry ? readEntry(buf, entry).toString('utf8') : null;
  };
  const sheetPath = firstSheetPath(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels'));
  const sheet = text(sheetPath);
  if (sheet === null) throw new XlsxReadError('BROKEN', '첫 시트를 찾지 못했습니다');
  const shared = sharedStringsOf(text('xl/sharedStrings.xml'));
  const rows: string[][] = [];
  let rowNo = 0;
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rAttr = /\br="(\d+)"/.exec(rowMatch[1] ?? '')?.[1];
    rowNo = rAttr ? Number(rAttr) : rowNo + 1;
    if (rowNo > MAX_ROWS) throw new XlsxReadError('BROKEN', '행이 너무 많습니다');
    const cells: string[] = [];
    let colNo = -1;
    for (const cellMatch of (rowMatch[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const ref = /\br="([A-Za-z]+\d+)"/.exec(attrs)?.[1];
      colNo = ref ? columnIndex(ref) : colNo + 1;
      if (colNo < 0 || colNo >= MAX_COLUMNS) continue;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? 'n';
      const inner = cellMatch[2] ?? '';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v ?? -1)] ?? '';
      else if (type === 'inlineStr') value = textRuns(inner);
      else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else value = v !== undefined ? decodeXmlText(v) : '';
      while (cells.length < colNo) cells.push('');
      cells[colNo] = value;
    }
    while (rows.length < rowNo - 1) rows.push([]);
    rows[rowNo - 1] = cells;
  }
  return rows;
}
