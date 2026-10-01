import { decodeUtf8, detectDelimiter, parseDelimited } from './delimited-text.js';
import {
  CompetitorParseError,
  isDroppedTag,
  MAX_PARSE_ERRORS,
  type ParsedCompetitorInput,
  type ParsedCompetitorTag,
  type ParseFieldError,
  TAG_TEXT_MAX,
  tagRow,
} from './parsed-input.js';
import { looksLikeZip, readXlsxRows, XlsxReadError } from './xlsx-reader.js';

/**
 * 셀러라이프 셀라파인더 '키워드정보'의 네이버 manu태그(F-TG-02, PRD §8.6 2 ①). 엑셀(xlsx)·CSV 파일 또는 엑셀에서 복사해 붙여
 * 넣은 표(탭)·쉼표 목록. 열 형식은 M0 S5 전이라 아래 가정(Proposed — fixture `sellerfinder/*`):
 * - 머리행(첫 비지 않은 행)에서 열 이름을 찾는다: 태그(`manu태그`·`태그`·`키워드`·`tag`), 빈도(`빈도`·`횟수`·`사용수`·`상품수`·
 *   `count`), 순위(`순위`·`rank`·`순번`·`no`), 상품 ID(`상품id`·`상품번호`·`nvmid`·`productid`) — NFKC·소문자·공백 무시
 * - 태그 열을 찾으면 그다음 행부터 한 행 = 태그 하나. 빈도 열을 찾았으면 `hasFrequency=true`(빈도순 표시 — x-decision §7.4-34)
 * - 머리행이 없으면 빈도 없는 목록: 모든 칸을 행 순서대로 태그로 본다(쉼표로 나눈 한 줄 목록도 된다)
 * - 빈도·순위는 1 이상 정수(천 단위 쉼표 허용), 상품 ID는 숫자 20자까지, 태그는 100자까지 — 어기면 IMPORT_PARSE_FAILED
 *   (`fieldErrors[].field` = `row{행 번호}.{열 이름}` — P2-04와 같은 모양, 앞 50건, 값은 담지 않는다)
 * - 태그가 0개면 IMPORT_EMPTY. 개인 값 모양(이메일·전화 — 판매자 연락처) 칸은 버린다
 * 파일 형식(서비스가 먼저 본다): zip이면 xlsx(아니면 UNSUPPORTED_FILE_TYPE), 글이면 UTF-8 CSV(BOM 허용, 아니면 IMPORT_PARSE_FAILED
 * `file`), 그 밖 바이너리(PDF·xls 등)는 UNSUPPORTED_FILE_TYPE.
 */

const HEADER_NAMES = {
  tag: ['manu태그', 'manutag', 'manutags', '메뉴태그', '태그', '태그명', '키워드', 'tag', 'tags'],
  frequency: ['빈도', '횟수', '사용수', '사용횟수', '상품수', '빈도수', 'count', 'frequency'],
  rank: ['순위', 'rank', '순번', 'no', 'no.', '번호'],
  productId: ['상품id', '상품번호', 'nvmid', 'productid', '상품아이디'],
} as const;

type ColumnName = keyof typeof HEADER_NAMES;

const COLUMN_LABEL: Record<ColumnName, string> = {
  tag: '태그',
  frequency: '빈도',
  rank: '순위',
  productId: '상품ID',
};

function headerKey(cell: string): string {
  return cell.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function findColumns(row: readonly string[]): Partial<Record<ColumnName, number>> {
  const found: Partial<Record<ColumnName, number>> = {};
  row.forEach((cell, index) => {
    const key = headerKey(cell);
    if (key.length === 0) return;
    for (const name of Object.keys(HEADER_NAMES) as ColumnName[]) {
      if (found[name] === undefined && (HEADER_NAMES[name] as readonly string[]).includes(key)) {
        found[name] = index;
        return;
      }
    }
  });
  return found;
}

/** 1 이상 정수(천 단위 쉼표 허용). 빈 칸은 null, 틀리면 undefined */
function positiveInt(cell: string | undefined): number | null | undefined {
  const text = (cell ?? '').normalize('NFKC').trim().replace(/,/g, '');
  if (text.length === 0) return null;
  if (!/^[0-9]{1,9}$/.test(text)) return undefined;
  const n = Number(text);
  return n >= 1 ? n : undefined;
}

function productIdOf(cell: string | undefined): string | null | undefined {
  const text = (cell ?? '').normalize('NFKC').trim();
  if (text.length === 0) return null;
  return /^[0-9]{1,20}$/.test(text) ? text : undefined;
}

/** 표(행 = 칸 목록, 1행부터) → 파싱 결과 */
export function parseSellerfinderRows(rows: readonly (readonly string[])[]): ParsedCompetitorInput {
  const headerIndex = rows.findIndex((row) => row.some((cell) => cell.trim().length > 0));
  if (headerIndex < 0) throw new CompetitorParseError('IMPORT_EMPTY');
  const columns = findColumns(rows[headerIndex]!);
  const tags: ParsedCompetitorTag[] = [];
  const errors: ParseFieldError[] = [];
  const fail = (rowNo: number, column: ColumnName, message: string) => {
    if (errors.length < MAX_PARSE_ERRORS) {
      errors.push({ field: `row${rowNo}.${COLUMN_LABEL[column]}`, message });
    }
  };

  if (columns.tag === undefined) {
    // 머리행이 없는 목록: 모든 칸이 태그(빈도 없음)
    rows.forEach((row, i) => {
      row.forEach((cell) => {
        const text = cell.trim();
        if (isDroppedTag(text)) return;
        if (text.length > TAG_TEXT_MAX) {
          fail(i + 1, 'tag', `태그는 ${TAG_TEXT_MAX}자까지입니다.`);
          return;
        }
        tags.push(tagRow(text, null, null, null));
      });
    });
    if (errors.length > 0) throw new CompetitorParseError('IMPORT_PARSE_FAILED', errors);
    if (tags.length === 0) throw new CompetitorParseError('IMPORT_EMPTY');
    return { hasFrequency: false, tags };
  }

  const hasFrequency = columns.frequency !== undefined;
  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const rowNo = i + 1;
    const text = (row[columns.tag] ?? '').trim();
    if (text.length === 0) continue;
    if (text.length > TAG_TEXT_MAX) {
      fail(rowNo, 'tag', `태그는 ${TAG_TEXT_MAX}자까지입니다.`);
      continue;
    }
    const frequency = columns.frequency !== undefined ? positiveInt(row[columns.frequency]) : null;
    const rank = columns.rank !== undefined ? positiveInt(row[columns.rank]) : null;
    const productId = columns.productId !== undefined ? productIdOf(row[columns.productId]) : null;
    if (frequency === undefined) fail(rowNo, 'frequency', '빈도는 1 이상의 정수여야 합니다.');
    if (rank === undefined) fail(rowNo, 'rank', '순위는 1 이상의 정수여야 합니다.');
    if (productId === undefined) fail(rowNo, 'productId', '상품 ID는 숫자 20자까지입니다.');
    if (frequency === undefined || rank === undefined || productId === undefined) continue;
    if (isDroppedTag(text)) continue;
    tags.push(tagRow(text, rank, productId, frequency));
  }
  if (errors.length > 0) throw new CompetitorParseError('IMPORT_PARSE_FAILED', errors);
  if (tags.length === 0) throw new CompetitorParseError('IMPORT_EMPTY');
  return { hasFrequency, tags };
}

/** 붙여 넣은 표·목록 글 */
export function parseSellerfinderText(text: string): ParsedCompetitorInput {
  return parseSellerfinderRows(parseDelimited(text, detectDelimiter(text)));
}

/** 파일 종류(내용으로 판별 — 파일 이름은 보지 않고 저장하지도 않는다) */
export type SellerfinderFileKind = 'XLSX' | 'CSV' | 'UNSUPPORTED';

export function sellerfinderFileKind(bytes: Uint8Array): SellerfinderFileKind {
  if (looksLikeZip(bytes)) return 'XLSX';
  const head = bytes.subarray(0, Math.min(bytes.length, 8192));
  // PDF·옛 엑셀(xls, OLE)·그 밖 바이너리(NUL 바이트)
  if (head.includes(0)) return 'UNSUPPORTED';
  if (head.length >= 4 && Buffer.from(head.subarray(0, 4)).toString('latin1') === '%PDF') {
    return 'UNSUPPORTED';
  }
  return 'CSV';
}

/** 파일(xlsx·CSV) */
export function parseSellerfinderFile(bytes: Uint8Array): ParsedCompetitorInput {
  const kind = sellerfinderFileKind(bytes);
  if (kind === 'UNSUPPORTED') throw new CompetitorParseError('UNSUPPORTED_FILE_TYPE');
  if (kind === 'XLSX') {
    let rows: string[][];
    try {
      rows = readXlsxRows(bytes);
    } catch (error) {
      if (error instanceof XlsxReadError && error.kind === 'NOT_XLSX') {
        throw new CompetitorParseError('UNSUPPORTED_FILE_TYPE');
      }
      throw new CompetitorParseError('IMPORT_PARSE_FAILED', [
        { field: 'file', message: '엑셀 파일을 읽지 못했습니다(파일이 깨졌을 수 있습니다).' },
      ]);
    }
    return parseSellerfinderRows(rows);
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
    throw new CompetitorParseError('IMPORT_PARSE_FAILED', [
      { field: 'file', message: "CSV는 UTF-8이어야 합니다(엑셀 'CSV UTF-8'로 저장)." },
    ]);
  }
  return parseSellerfinderRows(parseDelimited(text, detectDelimiter(text)));
}
