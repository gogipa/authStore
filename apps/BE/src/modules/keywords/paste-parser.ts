import type { FieldError } from '../../common/errors/error-response.js';
import { KEYWORD_MAX_LENGTH } from './keywords.constants.js';

/**
 * 순위 텍스트 붙여넣기 파서(F-KW-05, US-01 AC3, P2-01 규칙 9). 순수 함수.
 *
 * 줄 형식(Proposed — M0 S4에서 데이터랩 화면 복사 텍스트로 확정한다):
 * - 한 줄에 '순위 + 키워드': 순위(1~5자리 숫자) 뒤에 공백·탭 또는 `.`·`)`·`:`·`위`, 그다음 키워드.
 *   예 `1 뉴발란스 530`, `1\t뉴발란스 530`, `1. 뉴발란스 530`, `1위 뉴발란스 530`, 붙어 있으면 `1뉴발란스 530`
 * - 두 줄에 걸친 모양도 받는다: 숫자만 있는 줄 다음 줄이 그 순위의 키워드(데이터랩 목록을 긁으면 이렇게 복사될 수 있다)
 * - 빈 줄은 건너뛴다. 키워드 안의 공백·탭 여러 개는 공백 하나로 줄인다
 *
 * 오류: 형식이 맞지 않는 줄·순위 0·100자 넘는 키워드·같은 순위가 두 번(PG14 UNIQUE가 cid NULL 행의 중복을 못 잡아 여기서
 * 막는다) → IMPORT_PARSE_FAILED(fieldErrors `text[줄 번호]`, 줄 번호는 1부터, 앞 50건까지). 읽은 줄 0개 → IMPORT_EMPTY.
 */
export interface PastedKeyword {
  rank: number;
  keyword: string;
  /** 1부터 센 줄 번호(키워드가 있는 줄) */
  line: number;
}

export type PasteParseResult =
  | { ok: true; rows: PastedKeyword[] }
  | { ok: false; code: 'IMPORT_PARSE_FAILED' | 'IMPORT_EMPTY'; fieldErrors: FieldError[] };

/** 오류는 앞 50건까지만 싣는다 */
export const PASTE_MAX_FIELD_ERRORS = 50;

/** 순위 + 구분 + 키워드(한 줄) */
const RANK_WITH_KEYWORD = /^(\d{1,5})(?:\s*(?:위|\.|\)|:)\s*|\s+|(?=[^\d\s]))(.+)$/u;
/** 순위만 있는 줄 */
const RANK_ONLY = /^(\d{1,5})\s*(?:위|\.|\)|:)?$/u;

function lineField(line: number): string {
  return `text[${line}]`;
}

function preview(text: string): string {
  const chars = [...text];
  return chars.length > 100 ? `${chars.slice(0, 100).join('')}…` : text;
}

function normalizeKeyword(raw: string): string {
  return raw.replace(/\s+/gu, ' ').trim();
}

export function parsePastedRanks(text: string): PasteParseResult {
  const lines = text.split(/\r\n|\r|\n/);
  const rows: PastedKeyword[] = [];
  const errors: FieldError[] = [];
  const rankLine = new Map<number, number>();
  let pending: { rank: number; line: number } | null = null;

  const push = (rank: number, rawKeyword: string, line: number, source: string) => {
    const keyword = normalizeKeyword(rawKeyword);
    if (rank < 1) {
      errors.push({
        field: lineField(line),
        message: `${line}번째 줄: 순위는 1 이상이어야 합니다.`,
        rejectedValue: preview(source),
      });
      return;
    }
    if (keyword === '' || [...keyword].length > KEYWORD_MAX_LENGTH) {
      errors.push({
        field: lineField(line),
        message: `${line}번째 줄: 키워드는 1~${KEYWORD_MAX_LENGTH}자여야 합니다.`,
        rejectedValue: preview(source),
      });
      return;
    }
    const firstLine = rankLine.get(rank);
    if (firstLine !== undefined) {
      errors.push({
        field: lineField(line),
        message: `${line}번째 줄: ${firstLine}번째 줄과 같은 순위(${rank})입니다.`,
        rejectedValue: preview(source),
      });
      return;
    }
    rankLine.set(rank, line);
    rows.push({ rank, keyword, line });
  };

  for (const [index, raw] of lines.entries()) {
    const line = index + 1;
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    if (pending !== null) {
      push(pending.rank, trimmed, line, trimmed);
      pending = null;
      continue;
    }
    const only = RANK_ONLY.exec(trimmed);
    if (only) {
      pending = { rank: Number(only[1]), line };
      continue;
    }
    const m = RANK_WITH_KEYWORD.exec(trimmed);
    if (!m) {
      errors.push({
        field: lineField(line),
        message: `${line}번째 줄: '순위 키워드' 모양이 아닙니다.`,
        rejectedValue: preview(trimmed),
      });
      continue;
    }
    push(Number(m[1]), m[2] ?? '', line, trimmed);
  }
  if (pending !== null) {
    errors.push({
      field: lineField(pending.line),
      message: `${pending.line}번째 줄: 순위 다음 줄에 키워드가 없습니다.`,
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      code: 'IMPORT_PARSE_FAILED',
      fieldErrors: errors.slice(0, PASTE_MAX_FIELD_ERRORS),
    };
  }
  if (rows.length === 0) {
    return {
      ok: false,
      code: 'IMPORT_EMPTY',
      fieldErrors: [{ field: 'text', message: '순위와 키워드가 있는 줄이 없습니다.' }],
    };
  }
  return { ok: true, rows };
}
