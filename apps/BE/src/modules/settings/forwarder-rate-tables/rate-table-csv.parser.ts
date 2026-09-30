import type { FieldError } from '../../../common/errors/error-response.js';
import { Prisma } from '../../../generated/prisma/client.js';
import { parseVolumetricAppliesWhen } from './rate-table.rules.js';

/**
 * 배대지 요금표 CSV 해석(순수 함수, P2-04 규칙 11, F-ST-04). 형식(Proposed, ERD §7.1-13 · 05-1 §7.3 'P2-04 구현 결정'):
 * - 인코딩 UTF-8(BOM 허용). 엑셀은 'CSV UTF-8'로 저장한다. UTF-8이 아니면 `IMPORT_PARSE_FAILED`(field `file`).
 * - RFC 4180 따옴표(`"…"`, 안의 `""`)·CRLF/LF를 읽는다. 빈 줄은 건너뛴다.
 * - 첫 줄은 머리행: `weight_max_kg, fee, currency, volumetric_divisor, volumetric_applies_when` 다섯 열(순서 무관, 대소문자·
 *   앞뒤 공백 무시, 빠지거나 모르는 열이 있으면 오류).
 * - 데이터 행: `weight_max_kg` > 0, 소수 셋째 자리까지(numeric(6,3), 999.999 이하) · `fee` 0 이상 정수(쉼표 없이) ·
 *   `currency` JPY·KRW · `volumetric_divisor` 비우거나 0보다 큰 정수 · `volumetric_applies_when` 비우거나
 *   `ALWAYS`·`NEVER`·`SUM_CM>{n}`(rate-table.rules.ts). 같은 무게 구간(1.2 = 1.200)이 두 번 나오면 오류.
 * - 오류 위치는 `row{줄 번호}.{열}`(머리행이 1줄, 파일의 실제 줄 번호), 앞 50건만. 데이터 행이 0개면 `IMPORT_EMPTY`.
 * - 구간은 무게 오름차순으로 돌려준다. 엔화 요금은 원으로 바꾸지 않고 그대로 둔다(규칙 14 — 판정 때 FX_base로).
 */

export const RATE_TABLE_COLUMNS = [
  'weight_max_kg',
  'fee',
  'currency',
  'volumetric_divisor',
  'volumetric_applies_when',
] as const;
export type RateTableColumn = (typeof RATE_TABLE_COLUMNS)[number];

export const RATE_TABLE_CURRENCIES = ['JPY', 'KRW'] as const;
export type RateTableCurrency = (typeof RATE_TABLE_CURRENCIES)[number];

/** 데이터 행 상한(Proposed — 요금표는 수십 행, row_count smallint) */
export const RATE_TABLE_MAX_ROWS = 1000;
/** 오류 위치를 앞에서부터 몇 건 돌려줄지(P2-01 붙여넣기와 같다) */
export const RATE_TABLE_MAX_FIELD_ERRORS = 50;

const INT4_MAX = 2_147_483_647;
const WEIGHT_RE = /^\d{1,3}(\.\d{1,3})?$/;
const INTEGER_RE = /^\d+$/;

export interface ParsedRateTier {
  /** 정규화한 무게 글자(끝 0 없음, 예 '1.2') — Prisma Decimal 칸에 그대로 넣는다 */
  weightMaxKg: string;
  fee: number;
  currency: RateTableCurrency;
  volumetricDivisor: number | null;
  /** 정규화한 적용 조건(`ALWAYS`·`NEVER`·`SUM_CM>160`) 또는 null */
  volumetricAppliesWhen: string | null;
  /** CSV 줄 번호 */
  line: number;
}

export type RateTableParseResult =
  | { ok: true; tiers: ParsedRateTier[] }
  | { ok: false; code: 'IMPORT_PARSE_FAILED' | 'IMPORT_EMPTY'; fieldErrors: FieldError[] };

export interface CsvRecord {
  /** 이 레코드가 시작한 줄(1부터) */
  line: number;
  cells: string[];
}

/** RFC 4180 CSV → 레코드. 닫히지 않은 따옴표면 그 줄 번호로 오류 */
export function splitCsvRecords(
  text: string,
): { ok: true; records: CsvRecord[] } | { ok: false; line: number } {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let startLine = 1;
  let quoteStartLine = 1;
  let i = 0;
  const endRecord = () => {
    cells.push(cell);
    records.push({ line: startLine, cells });
    cells = [];
    cell = '';
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
      if (ch === '\n') line += 1;
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && cell.trim() === '') {
      quoted = true;
      quoteStartLine = line;
      cell = '';
      i += 1;
      continue;
    }
    if (ch === ',') {
      cells.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      endRecord();
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      i += 1;
      line += 1;
      startLine = line;
      continue;
    }
    cell += ch;
    i += 1;
  }
  if (quoted) return { ok: false, line: quoteStartLine };
  if (cell !== '' || cells.length > 0) endRecord();
  return { ok: true, records };
}

function isBlank(record: CsvRecord): boolean {
  return record.cells.every((c) => c.trim() === '');
}

function short(value: string): string {
  return value.length > 100 ? `${value.slice(0, 100)}…` : value;
}

/** 파일 바이트 → 글자. UTF-8이 아니면 null(BOM은 뗀다) */
export function decodeRateTableCsv(bytes: Uint8Array): string | null {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text.replace(/^\uFEFF/, '');
  } catch {
    return null;
  }
}

/** 글자 파일이 아닌 것(앞 8KB에 NUL 바이트 — xlsx·이미지 등) */
export function looksBinary(bytes: Uint8Array): boolean {
  return bytes.subarray(0, 8192).includes(0);
}

/** 무게 → 정규화 글자(1.200 → '1.2'). 형식이 틀리거나 0이면 null */
export function normalizeWeight(raw: string): string | null {
  const text = raw.trim();
  if (!WEIGHT_RE.test(text)) return null;
  const value = new Prisma.Decimal(text);
  return value.gt(0) ? value.toFixed() : null;
}

export function parseRateTableCsv(text: string): RateTableParseResult {
  const split = splitCsvRecords(text);
  if (!split.ok) {
    return {
      ok: false,
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: [{ field: `row${split.line}`, message: '따옴표(")가 닫히지 않았습니다.' }],
    };
  }
  const records = split.records.filter((r) => !isBlank(r));
  if (records.length === 0) return { ok: false, code: 'IMPORT_EMPTY', fieldErrors: [] };

  // 머리행
  const header = records[0]!;
  const names = header.cells.map((c) => c.trim().toLowerCase());
  const errors: FieldError[] = [];
  const index = new Map<RateTableColumn, number>();
  names.forEach((name, i) => {
    if (!(RATE_TABLE_COLUMNS as readonly string[]).includes(name)) {
      errors.push({
        field: `row${header.line}.${name || `열${i + 1}`}`,
        message: `모르는 열입니다. 열은 ${RATE_TABLE_COLUMNS.join(', ')}입니다.`,
      });
      return;
    }
    if (index.has(name as RateTableColumn)) {
      errors.push({ field: `row${header.line}.${name}`, message: '같은 열이 두 번 있습니다.' });
      return;
    }
    index.set(name as RateTableColumn, i);
  });
  for (const column of RATE_TABLE_COLUMNS) {
    if (!index.has(column)) {
      errors.push({ field: `row${header.line}.${column}`, message: '필요한 열이 없습니다.' });
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: errors.slice(0, RATE_TABLE_MAX_FIELD_ERRORS),
    };
  }

  const dataRows = records.slice(1);
  if (dataRows.length === 0) return { ok: false, code: 'IMPORT_EMPTY', fieldErrors: [] };
  if (dataRows.length > RATE_TABLE_MAX_ROWS) {
    return {
      ok: false,
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: [
        {
          field: 'file',
          message: `데이터 행은 ${RATE_TABLE_MAX_ROWS.toLocaleString('ko-KR')}개까지 받습니다(${dataRows.length.toLocaleString('ko-KR')}개).`,
        },
      ],
    };
  }

  const tiers: ParsedRateTier[] = [];
  const seenWeights = new Map<string, number>();
  for (const record of dataRows) {
    const at = (column: RateTableColumn) => `row${record.line}.${column}`;
    if (record.cells.length !== names.length) {
      errors.push({
        field: `row${record.line}`,
        message: `열 수가 머리행과 다릅니다(${names.length}개여야 하는데 ${record.cells.length}개).`,
      });
      continue;
    }
    const cell = (column: RateTableColumn) => record.cells[index.get(column)!]!.trim();
    const rowErrors: FieldError[] = [];

    const weightRaw = cell('weight_max_kg');
    const weight = normalizeWeight(weightRaw);
    if (weight === null) {
      rowErrors.push({
        field: at('weight_max_kg'),
        message: '0보다 크고 999.999 이하인 숫자(소수 셋째 자리까지)여야 합니다.',
        rejectedValue: short(weightRaw),
      });
    } else if (seenWeights.has(weight)) {
      rowErrors.push({
        field: at('weight_max_kg'),
        message: `같은 무게 구간이 ${seenWeights.get(weight)}줄에 이미 있습니다.`,
        rejectedValue: short(weightRaw),
      });
    }

    const feeRaw = cell('fee');
    const fee = INTEGER_RE.test(feeRaw) ? Number(feeRaw) : NaN;
    if (!Number.isSafeInteger(fee) || fee > INT4_MAX) {
      rowErrors.push({
        field: at('fee'),
        message: '0 이상 정수여야 합니다(쉼표·소수 없이).',
        rejectedValue: short(feeRaw),
      });
    }

    const currencyRaw = cell('currency');
    const currency = currencyRaw.toUpperCase();
    if (!(RATE_TABLE_CURRENCIES as readonly string[]).includes(currency)) {
      rowErrors.push({
        field: at('currency'),
        message: '통화는 JPY 또는 KRW여야 합니다.',
        rejectedValue: short(currencyRaw),
      });
    }

    const divisorRaw = cell('volumetric_divisor');
    let divisor: number | null = null;
    if (divisorRaw !== '') {
      const n = INTEGER_RE.test(divisorRaw) ? Number(divisorRaw) : NaN;
      if (!Number.isSafeInteger(n) || n <= 0 || n > INT4_MAX) {
        rowErrors.push({
          field: at('volumetric_divisor'),
          message: '비우거나 0보다 큰 정수여야 합니다.',
          rejectedValue: short(divisorRaw),
        });
      } else {
        divisor = n;
      }
    }

    const whenRaw = cell('volumetric_applies_when');
    const when = parseVolumetricAppliesWhen(whenRaw);
    if (!when.ok) {
      rowErrors.push({
        field: at('volumetric_applies_when'),
        message: when.message,
        rejectedValue: short(whenRaw),
      });
    } else if (when.value !== null && when.value !== 'NEVER' && divisorRaw === '') {
      rowErrors.push({
        field: at('volumetric_applies_when'),
        message: '부피무게 나눗수(volumetric_divisor)가 비어 있으면 적용 조건도 비워 주세요.',
        rejectedValue: short(whenRaw),
      });
    }

    if (weight !== null && !seenWeights.has(weight)) seenWeights.set(weight, record.line);
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    tiers.push({
      weightMaxKg: weight!,
      fee,
      currency: currency as RateTableCurrency,
      volumetricDivisor: divisor,
      volumetricAppliesWhen: when.ok ? when.value : null,
      line: record.line,
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: errors.slice(0, RATE_TABLE_MAX_FIELD_ERRORS),
    };
  }
  tiers.sort((a, b) => new Prisma.Decimal(a.weightMaxKg).comparedTo(b.weightMaxKg));
  return { ok: true, tiers };
}
