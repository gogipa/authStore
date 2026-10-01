import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BE_ROOT } from '../../../../common/config/paths.js';
import { parseBrowserResponse } from './browser-response.parser.js';
import { parseDelimited } from './delimited-text.js';
import { parseFreeText } from './free-text.parser.js';
import { CompetitorParseError, type ParsedCompetitorInput } from './parsed-input.js';
import {
  parseSellerfinderFile,
  parseSellerfinderText,
  sellerfinderFileKind,
} from './sellerfinder.parser.js';
import { readXlsxRows } from './xlsx-reader.js';

const FIXTURES = join(BE_ROOT, 'test', 'fixtures', 'tags');
const bytes = (name: string) => readFileSync(join(FIXTURES, name));
const text = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');

/** 결과 객체의 키는 넷(태그·순위·상품 ID·빈도)뿐이고, 원본·머리·연락처가 어디에도 없다 */
function expectOnlyAllowedKeys(parsed: ParsedCompetitorInput) {
  expect(Object.keys(parsed).sort()).toEqual(['hasFrequency', 'tags']);
  for (const tag of parsed.tags) {
    expect(Object.keys(tag).sort()).toEqual([
      'frequency',
      'naverProductId',
      'sourceRank',
      'tagText',
    ]);
  }
}

function parseError(fn: () => unknown): CompetitorParseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CompetitorParseError) return error;
    throw error;
  }
  throw new Error('파싱 오류가 나지 않았습니다');
}

describe('브라우저 응답 파서(F-TG-03, 규칙 3)', () => {
  it('JSON manuTag → 태그·순위·상품 ID(쉼표·|·배열), 판매자 연락처·상호는 담지 않는다', () => {
    const parsed = parseBrowserResponse(text('browser/search-response.json'));
    expectOnlyAllowedKeys(parsed);
    expect(parsed.hasFrequency).toBe(false);
    expect(parsed.tags).toEqual([
      { tagText: '젤카야노14', sourceRank: 1, naverProductId: '82345678901', frequency: null },
      { tagText: '데일리운동화', sourceRank: 1, naverProductId: '82345678901', frequency: null },
      { tagText: '아식스운동화', sourceRank: 1, naverProductId: '82345678901', frequency: null },
      { tagText: '젤카야노14', sourceRank: 2, naverProductId: '82345678902', frequency: null },
      { tagText: '레트로운동화', sourceRank: 2, naverProductId: '82345678902', frequency: null },
      { tagText: '무료배송', sourceRank: 2, naverProductId: '82345678902', frequency: null },
      { tagText: '크림운동화', sourceRank: 3, naverProductId: '82345678903', frequency: null },
      { tagText: '쿠션운동화', sourceRank: 3, naverProductId: '82345678903', frequency: null },
    ]);
    const out = JSON.stringify(parsed);
    for (const leaked of ['010-2222-3333', 'seller@example.com', '슈즈마켓', 'productTitle']) {
      expect(out).not.toContain(leaked);
    }
  });

  it('HAR: 응답 본문만 읽고 Cookie·Authorization·Set-Cookie·주소·연락처는 결과에 없다', () => {
    const raw = text('browser/search.har');
    const parsed = parseBrowserResponse(raw);
    expectOnlyAllowedKeys(parsed);
    expect(parsed.tags.map((t) => [t.tagText, t.sourceRank, t.naverProductId])).toEqual([
      ['젤카야노14', 1, '83345678901'],
      ['남자운동화', 1, '83345678901'],
      ['키즈운동화', 1, '83345678901'],
      ['정품운동화', 2, '83345678902'],
      ['크림운동화', 2, '83345678902'],
    ]);
    const out = JSON.stringify(parsed);
    for (const leaked of [
      'HAR-COOKIE-SECRET-VALUE',
      'HAR-AUTH-TOKEN-VALUE',
      'HAR-SET-COOKIE-VALUE',
      'HAR-SESSION-VALUE',
      '02-1234-5678',
      'contact@seller-shop.example',
      'search.shopping.naver.com',
      'Cookie',
      'Authorization',
    ]) {
      expect(raw).toContain(leaked);
      expect(out).not.toContain(leaked);
    }
  });

  it('manuTag가 없으면 IMPORT_EMPTY, JSON이 아니면 IMPORT_PARSE_FAILED(줄·칸만 — 값 없음)', () => {
    expect(parseError(() => parseBrowserResponse('{"products":[{"id":"1"}]}')).code).toBe(
      'IMPORT_EMPTY',
    );
    const broken = parseError(() => parseBrowserResponse('{\n "manuTag": "secret-tag-text",\n}'));
    expect(broken.code).toBe('IMPORT_PARSE_FAILED');
    expect(broken.fieldErrors).toHaveLength(1);
    expect(broken.fieldErrors[0]!.field).toMatch(/^text\[\d+\]$/);
    expect(JSON.stringify(broken.fieldErrors)).not.toContain('secret-tag-text');
  });
});

describe('셀라파인더 파서(F-TG-02, 규칙 4)', () => {
  it('빈도 열이 있는 xlsx → hasFrequency=true, 13개, 키 넷만', () => {
    expect(sellerfinderFileKind(bytes('sellerfinder/manutag-freq.xlsx'))).toBe('XLSX');
    const parsed = parseSellerfinderFile(bytes('sellerfinder/manutag-freq.xlsx'));
    expectOnlyAllowedKeys(parsed);
    expect(parsed.hasFrequency).toBe(true);
    expect(parsed.tags).toHaveLength(13);
    expect(parsed.tags[0]).toEqual({
      tagText: '젤카야노14',
      sourceRank: null,
      naverProductId: null,
      frequency: 18,
    });
    expect(parsed.tags.at(-1)).toMatchObject({ tagText: '키즈운동화', frequency: 6 });
  });

  it('빈도 열이 없는 CSV → hasFrequency=false, 순위 열은 sourceRank', () => {
    const parsed = parseSellerfinderFile(bytes('sellerfinder/manutag-nofreq.csv'));
    expect(parsed.hasFrequency).toBe(false);
    expect(parsed.tags.map((t) => [t.tagText, t.sourceRank, t.frequency])).toEqual([
      ['젤카야노14', 1, null],
      ['데일리운동화', 2, null],
      ['#레트로운동화', 3, null],
      ['크림운동화', 4, null],
      ['무료배송', 5, null],
    ]);
  });

  it('붙여 넣은 표(탭) — 머리행이 있으면 열 이름으로, 없으면 모든 칸이 태그', () => {
    const withHeader = parseSellerfinderText('태그\t사용수\n젤카야노14\t18\n조깅화\t1,234\n');
    expect(withHeader.hasFrequency).toBe(true);
    expect(withHeader.tags.map((t) => t.frequency)).toEqual([18, 1234]);
    const list = parseSellerfinderText('젤카야노14, 조깅화\n데일리운동화\n');
    expect(list.hasFrequency).toBe(false);
    expect(list.tags.map((t) => t.tagText)).toEqual(['젤카야노14', '조깅화', '데일리운동화']);
  });

  it('빈 입력 → IMPORT_EMPTY, 깨진 표(빈도 열에 글자) → IMPORT_PARSE_FAILED(행·열)', () => {
    expect(parseError(() => parseSellerfinderText('\n \n')).code).toBe('IMPORT_EMPTY');
    expect(parseError(() => parseSellerfinderText('manu태그\n\n')).code).toBe('IMPORT_EMPTY');
    const broken = parseError(() =>
      parseSellerfinderFile(bytes('sellerfinder/manutag-broken.xlsx')),
    );
    expect(broken.code).toBe('IMPORT_PARSE_FAILED');
    expect(broken.fieldErrors).toEqual([
      { field: 'row3.빈도', message: '빈도는 1 이상의 정수여야 합니다.' },
    ]);
  });

  it('pdf·옛 엑셀(바이너리) → UNSUPPORTED_FILE_TYPE, 깨진 zip → IMPORT_PARSE_FAILED(file)', () => {
    expect(parseError(() => parseSellerfinderFile(Buffer.from('%PDF-1.7\n%âãÏÓ\n'))).code).toBe(
      'UNSUPPORTED_FILE_TYPE',
    );
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0]);
    expect(parseError(() => parseSellerfinderFile(ole)).code).toBe('UNSUPPORTED_FILE_TYPE');
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.alloc(40, 1)]);
    const broken = parseError(() => parseSellerfinderFile(zip));
    expect(broken.code).toBe('IMPORT_PARSE_FAILED');
    expect(broken.fieldErrors[0]!.field).toBe('file');
  });

  it('xlsx 읽기: 첫 시트의 공유 문자열·숫자', () => {
    const rows = readXlsxRows(bytes('sellerfinder/manutag-freq.xlsx'));
    expect(rows[0]).toEqual(['manu태그', '빈도']);
    expect(rows[1]).toEqual(['젤카야노14', '18']);
  });

  it('CSV 읽기: 따옴표 안 쉼표·줄바꿈·이스케이프', () => {
    expect(parseDelimited('a,"b,c","d""e"\r\n"x\ny",z\n', ',')).toEqual([
      ['a', 'b,c', 'd"e'],
      ['x\ny', 'z'],
    ]);
  });
});

describe('자유 텍스트 파서(F-TG-04)', () => {
  it('줄바꿈·쉼표·#로 나누고, 연락처 모양은 버리고, 같은 태그는 한 번만', () => {
    const parsed = parseFreeText(text('free-text.txt'));
    expectOnlyAllowedKeys(parsed);
    expect(parsed.tags.map((t) => t.tagText)).toEqual([
      '데일리운동화',
      '레트로운동화',
      '크림운동화',
      '쿠션운동화',
      '무료배송',
      '나이키운동화',
      '키즈운동화',
      '정품운동화',
    ]);
    expect(JSON.stringify(parsed)).not.toContain('010-1234-5678');
    expect(parseFreeText('젤카야노14\n#젤카야노14').tags).toHaveLength(1);
  });

  it('빈 입력 → IMPORT_EMPTY, 100자 넘는 조각 → IMPORT_PARSE_FAILED(text[줄])', () => {
    expect(parseError(() => parseFreeText(' , # \n')).code).toBe('IMPORT_EMPTY');
    const long = parseError(() => parseFreeText(`ok\n${'가'.repeat(101)}`));
    expect(long.code).toBe('IMPORT_PARSE_FAILED');
    expect(long.fieldErrors).toEqual([{ field: 'text[2]', message: '태그는 100자까지입니다.' }]);
  });
});
