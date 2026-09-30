import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import {
  decodeRateTableCsv,
  looksBinary,
  parseRateTableCsv,
  RATE_TABLE_MAX_ROWS,
  splitCsvRecords,
} from './rate-table-csv.parser.js';

const FIXTURES = join(BE_ROOT, 'test', 'fixtures', 'forwarder');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const HEADER = 'weight_max_kg,fee,currency,volumetric_divisor,volumetric_applies_when';

describe('요금표 CSV 해석(parseRateTableCsv, 규칙 11)', () => {
  it('정상 fixture → 구간 수 = 데이터 행 수, 무게 오름차순, 통화·나눗수·조건 그대로', () => {
    const r = parseRateTableCsv(fixture('rate-table-v2026-09.csv'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tiers).toHaveLength(5);
    expect(r.tiers.map((t) => t.weightMaxKg)).toEqual(['0.5', '1', '1.2', '2', '3']);
    expect(r.tiers.find((t) => t.weightMaxKg === '1.2')).toMatchObject({
      fee: 15000,
      currency: 'KRW',
      volumetricDivisor: null,
      volumetricAppliesWhen: null,
    });
    expect(r.tiers.at(-1)).toMatchObject({
      volumetricDivisor: 6000,
      volumetricAppliesWhen: 'ALWAYS',
    });
    expect(r.tiers.find((t) => t.weightMaxKg === '2')!.volumetricAppliesWhen).toBe('SUM_CM>160');
  });

  it('엔화 요금은 원으로 바꾸지 않고 그대로 둔다(규칙 14)', () => {
    const r = parseRateTableCsv(fixture('rate-table-v2026-10.csv'));
    expect(r.ok && r.tiers.map((t) => [t.fee, t.currency])).toEqual([
      [1000, 'JPY'],
      [1500, 'JPY'],
      [2400, 'JPY'],
    ]);
  });

  it('통화 USD → IMPORT_PARSE_FAILED, fieldErrors에 row2.currency', () => {
    const r = parseRateTableCsv(fixture('rate-table-bad-currency.csv'));
    expect(r).toMatchObject({ ok: false, code: 'IMPORT_PARSE_FAILED' });
    if (r.ok) return;
    expect(r.fieldErrors).toEqual([
      { field: 'row2.currency', message: '통화는 JPY 또는 KRW여야 합니다.', rejectedValue: 'USD' },
    ]);
  });

  it('같은 무게 두 번(1.2와 1.200) → IMPORT_PARSE_FAILED, 뒤 줄에 앞 줄 번호', () => {
    const r = parseRateTableCsv(fixture('rate-table-dup-weight.csv'));
    expect(r).toMatchObject({ ok: false, code: 'IMPORT_PARSE_FAILED' });
    if (r.ok) return;
    expect(r.fieldErrors).toEqual([
      {
        field: 'row4.weight_max_kg',
        message: '같은 무게 구간이 2줄에 이미 있습니다.',
        rejectedValue: '1.200',
      },
    ]);
  });

  it('fee −1 · volumetric_divisor 0 → IMPORT_PARSE_FAILED(두 칸 모두)', () => {
    const r = parseRateTableCsv(fixture('rate-table-bad-numbers.csv'));
    expect(r).toMatchObject({ ok: false, code: 'IMPORT_PARSE_FAILED' });
    if (r.ok) return;
    expect(r.fieldErrors.map((e) => e.field)).toEqual(['row2.fee', 'row2.volumetric_divisor']);
  });

  it('머리행만 → IMPORT_EMPTY, 빈 파일도 IMPORT_EMPTY', () => {
    expect(parseRateTableCsv(fixture('rate-table-header-only.csv'))).toEqual({
      ok: false,
      code: 'IMPORT_EMPTY',
      fieldErrors: [],
    });
    expect(parseRateTableCsv('\n\n')).toMatchObject({ ok: false, code: 'IMPORT_EMPTY' });
  });

  it('머리행: 순서·대소문자·공백은 상관없고, 빠진 열·모르는 열은 row1 오류', () => {
    const reordered =
      'Currency, FEE ,weight_max_kg,volumetric_applies_when,volumetric_divisor\nKRW,15000,1.2,,\n';
    expect(parseRateTableCsv(reordered)).toMatchObject({
      ok: true,
      tiers: [{ weightMaxKg: '1.2', fee: 15000 }],
    });
    const r = parseRateTableCsv('weight_max_kg,fee,currency,volumetric_divisor,note\n1,1,KRW,,\n');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.map((e) => e.field)).toEqual([
      'row1.note',
      'row1.volumetric_applies_when',
    ]);
  });

  it('무게 규칙: 0·음수·소수 넷째 자리·1000kg은 오류, 열 수가 다른 줄은 row{n}', () => {
    const text = `${HEADER}\n0,1,KRW,,\n1.2345,1,KRW,,\n1000,1,KRW,,\n1,1,KRW\n`;
    const r = parseRateTableCsv(text);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.fieldErrors.map((e) => e.field)).toEqual([
      'row2.weight_max_kg',
      'row3.weight_max_kg',
      'row4.weight_max_kg',
      'row5',
    ]);
  });

  it('적용 조건: ALWAYS·NEVER·SUM_CM>n(정규화), 그 밖이나 나눗수 없이 ALWAYS는 오류', () => {
    const ok = parseRateTableCsv(
      `${HEADER}\n1,1,krw,5000, always \n2,1,KRW,5000,sum_cm > 150\n3,1,KRW,,NEVER\n`,
    );
    expect(ok.ok && ok.tiers.map((t) => [t.currency, t.volumetricAppliesWhen])).toEqual([
      ['KRW', 'ALWAYS'],
      ['KRW', 'SUM_CM>150'],
      ['KRW', 'NEVER'],
    ]);
    const bad = parseRateTableCsv(`${HEADER}\n1,1,KRW,5000,부피가 크면\n2,1,KRW,,ALWAYS\n`);
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.fieldErrors.map((e) => e.field)).toEqual([
      'row2.volumetric_applies_when',
      'row3.volumetric_applies_when',
    ]);
  });

  it('따옴표·CRLF·BOM·빈 줄을 읽는다', () => {
    const text = `\uFEFF${HEADER}\r\n"1.2","15000","KRW","",""\r\n\r\n2,18000,KRW,6000,"SUM_CM>160"\r\n`;
    const decoded = decodeRateTableCsv(Buffer.from(text, 'utf8'))!;
    expect(decoded.startsWith('weight')).toBe(true);
    const r = parseRateTableCsv(decoded);
    expect(r.ok && r.tiers.map((t) => t.line)).toEqual([2, 4]);
  });

  it('닫히지 않은 따옴표 → 그 줄 오류', () => {
    expect(parseRateTableCsv(`${HEADER}\n"1.2,15000,KRW,,\n`)).toMatchObject({
      ok: false,
      fieldErrors: [{ field: 'row2' }],
    });
    expect(splitCsvRecords('a,"b\nc",d\ne').ok && splitCsvRecords('a,"b\nc",d\ne')).toMatchObject({
      records: [
        { line: 1, cells: ['a', 'b\nc', 'd'] },
        { line: 3, cells: ['e'] },
      ],
    });
  });

  it(`데이터 행이 ${RATE_TABLE_MAX_ROWS}개를 넘으면 file 오류`, () => {
    const rows = Array.from(
      { length: RATE_TABLE_MAX_ROWS + 1 },
      (_, i) => `${(i + 1) / 1000},1,KRW,,`,
    );
    const r = parseRateTableCsv(`${HEADER}\n${rows.join('\n')}\n`);
    expect(r).toMatchObject({
      ok: false,
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: [{ field: 'file' }],
    });
  });

  it('UTF-8이 아니면 null, NUL 바이트가 있으면 바이너리', () => {
    expect(decodeRateTableCsv(Buffer.from([0xb9, 0xab, 0xb0, 0xd4]))).toBeNull(); // CP949 '무게'
    expect(looksBinary(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBe(true);
    expect(looksBinary(Buffer.from(HEADER))).toBe(false);
  });
});
