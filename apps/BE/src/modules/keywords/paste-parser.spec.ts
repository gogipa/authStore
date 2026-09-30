import { datalabPasteFixture } from '../../../test/support/datalab-fixture.adapter.js';
import { parsePastedRanks, PASTE_MAX_FIELD_ERRORS } from './paste-parser.js';

describe('순위 붙여넣기 파서(F-KW-05, P2-01 규칙 9)', () => {
  it('정상(공백 구분) → (순위, 키워드) 배열', () => {
    const result = parsePastedRanks(datalabPasteFixture('ok.txt'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(10);
    expect(result.rows[0]).toEqual({ rank: 1, keyword: '뉴발란스 530', line: 1 });
    expect(result.rows[9]).toEqual({ rank: 10, keyword: '컨버스 척70', line: 10 });
  });

  it('탭 구분·빈 줄 건너뜀', () => {
    const result = parsePastedRanks(datalabPasteFixture('tab-separated.txt'));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.rows.map((r) => [r.rank, r.keyword, r.line])).toEqual([
      [1, '뉴발란스 530', 1],
      [2, '아식스 젤카야노14', 2],
      [3, '아디다스 삼바', 3],
      [4, '오니츠카타이거 멕시코66', 5],
      [5, '나이키 코르테즈', 6],
    ]);
  });

  it('여러 구분 모양(Proposed): `1.`·`1)`·`1위`·붙어 있음·두 줄(숫자만 있는 줄 다음 줄)·CRLF', () => {
    const text =
      '1. 뉴발란스 530\r\n2) 아식스 젤카야노14\r\n3위 아디다스 삼바\r\n4나이키 코르테즈\r\n5\r\n살로몬   XT-6\r\n';
    const result = parsePastedRanks(text);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.rows.map((r) => [r.rank, r.keyword])).toEqual([
      [1, '뉴발란스 530'],
      [2, '아식스 젤카야노14'],
      [3, '아디다스 삼바'],
      [4, '나이키 코르테즈'],
      [5, '살로몬 XT-6'],
    ]);
  });

  it('같은 순위 두 줄 → IMPORT_PARSE_FAILED(줄 번호)', () => {
    const result = parsePastedRanks(datalabPasteFixture('duplicate-rank.txt'));
    expect(result).toEqual({
      ok: false,
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: [
        {
          field: 'text[3]',
          message: '3번째 줄: 2번째 줄과 같은 순위(2)입니다.',
          rejectedValue: '2 아디다스 삼바',
        },
      ],
    });
  });

  it('형식이 맞지 않는 줄·순위 0·빠진 키워드 → IMPORT_PARSE_FAILED(줄마다)', () => {
    const result = parsePastedRanks('인기검색어\n0 뉴발란스\n1 아식스\n7');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('IMPORT_PARSE_FAILED');
    expect(result.fieldErrors.map((e) => e.field)).toEqual(['text[1]', 'text[2]', 'text[4]']);
    expect(result.fieldErrors[2]!.message).toBe('4번째 줄: 순위 다음 줄에 키워드가 없습니다.');
  });

  it('키워드가 100자를 넘으면 오류', () => {
    const result = parsePastedRanks(`1 ${'가'.repeat(101)}`);
    expect(result).toMatchObject({ ok: false, code: 'IMPORT_PARSE_FAILED' });
  });

  it(`오류는 앞 ${PASTE_MAX_FIELD_ERRORS}건까지`, () => {
    const text = Array.from({ length: 80 }, () => '순위 없음').join('\n');
    const result = parsePastedRanks(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.fieldErrors).toHaveLength(PASTE_MAX_FIELD_ERRORS);
  });

  it('빈 줄만 → IMPORT_EMPTY', () => {
    expect(parsePastedRanks(datalabPasteFixture('blank-only.txt'))).toEqual({
      ok: false,
      code: 'IMPORT_EMPTY',
      fieldErrors: [{ field: 'text', message: '순위와 키워드가 있는 줄이 없습니다.' }],
    });
  });

  it('아동 단어 줄도 읽는다(제외는 저장할 때 표시)', () => {
    const result = parsePastedRanks(datalabPasteFixture('with-child-terms.txt'));
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.rows.map((r) => r.keyword)).toContain('키즈 운동화');
  });
});
