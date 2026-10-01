import {
  CompetitorParseError,
  isDroppedTag,
  type ParsedCompetitorInput,
  type ParsedCompetitorTag,
  TAG_TEXT_MAX,
  tagRow,
} from './parsed-input.js';

/**
 * (고급) 오너 브라우저에서 복사한 네이버쇼핑 검색 응답(F-TG-03, PRD §8.6 2 ②, R05 M1). JSON 하나 또는 HAR(`log.entries[]`)을
 * 붙여 넣으면 `manuTag`만 뽑는다. 앱은 네이버에 요청하지 않는다(CON-03 — 이미 받은 응답 글만 읽는다).
 * - HAR: 각 항목의 **응답 본문**(`response.content.text`, base64면 풀어서)만 JSON으로 읽는다. 요청·응답 머리(Cookie·
 *   Authorization·Set-Cookie)와 주소·쿼리는 보지 않는다 — 결과 객체에 담을 자리도 없다
 * - JSON 안을 훑어 `manuTag`(대소문자·`manu_tag`·`manuTags` 허용) 키를 가진 객체를 상품으로 본다. 태그 = 글이면 쉼표·`|`로 나눈
 *   조각, 배열이면 글 원소(형식은 M0 S5 전 가정 — fixture `browser/*`). 상품 ID = 같은 객체의 `nvMid`·`productId`·`id`·
 *   `mallProductId` 가운데 처음 나온 숫자(20자까지), 순위 = `rank`(1 이상 정수), 없으면 상품이 나온 순서
 * - 판매자 이름·연락처·주소 같은 다른 필드는 읽지 않는다. 태그 조각에 개인 값 모양(이메일·전화)이 있으면 버린다(CON-09)
 * - 한 상품의 태그마다 한 줄(빈도 없음 — `hasFrequency=false`, 선정은 입력 순서). 0개면 IMPORT_EMPTY
 * - JSON이 아니면 IMPORT_PARSE_FAILED(`text[줄]` — 위치만, 값은 담지 않는다)
 */

const MANU_TAG_KEY = /^manu_?tags?$/i;
const PRODUCT_ID_KEYS = ['nvMid', 'nvmid', 'productId', 'id', 'mallProductId'];
const RANK_KEYS = ['rank', 'rankOrder'];
/** 훑는 깊이·마디 수 상한(붙여 넣은 큰 HAR 안전장치) */
const MAX_DEPTH = 64;
const MAX_NODES = 2_000_000;

function jsonErrorPosition(error: unknown, text: string): { line: number; column: number } {
  const message = error instanceof Error ? error.message : '';
  const lc = /line (\d+) column (\d+)/.exec(message);
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const pos = /position (\d+)/.exec(message);
  const at = pos ? Math.min(Number(pos[1]), text.length) : text.length;
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const column = at - before.lastIndexOf('\n');
  return { line, column };
}

function parseJsonOrFail(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const { line, column } = jsonErrorPosition(error, text);
    throw new CompetitorParseError('IMPORT_PARSE_FAILED', [
      {
        field: `text[${line}]`,
        message: `${line}줄 ${column}번째 글자에서 JSON 형식이 맞지 않습니다.`,
      },
    ]);
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** HAR이면 응답 본문 JSON들(항목 순서), 아니면 null */
function harBodies(root: unknown): unknown[] | null {
  const log = (root as { log?: { entries?: unknown } } | null)?.log;
  if (!log || !Array.isArray(log.entries)) return null;
  const bodies: unknown[] = [];
  for (const entry of log.entries as unknown[]) {
    const content = (entry as { response?: { content?: { text?: unknown; encoding?: unknown } } })
      ?.response?.content;
    if (!content || typeof content.text !== 'string') continue;
    const raw =
      content.encoding === 'base64'
        ? Buffer.from(content.text, 'base64').toString('utf8')
        : content.text;
    const parsed = tryJson(raw.trim());
    if (parsed !== undefined) bodies.push(parsed);
  }
  return bodies;
}

function tagPieces(value: unknown): string[] {
  if (typeof value === 'string') return value.split(/[,|]/);
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === 'string'
        ? [item]
        : item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'
          ? [(item as { text: string }).text]
          : [],
    );
  }
  return [];
}

function productIdOf(record: Record<string, unknown>): string | null {
  for (const key of PRODUCT_ID_KEYS) {
    const value = record[key];
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
    if (/^[0-9]{1,20}$/.test(text.trim())) return text.trim();
  }
  return null;
}

function rankOf(record: Record<string, unknown>): number | null {
  for (const key of RANK_KEYS) {
    const value = record[key];
    const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (Number.isInteger(n) && n >= 1 && n <= 1_000_000_000) return n;
  }
  return null;
}

/** JSON 안의 manuTag 상품을 차례로 훑는다 */
function collect(
  root: unknown,
  out: ParsedCompetitorTag[],
  state: { products: number; nodes: number },
) {
  const stack: { value: unknown; depth: number }[] = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    if (++state.nodes > MAX_NODES) return;
    if (!value || typeof value !== 'object' || depth > MAX_DEPTH) continue;
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push({ value: value[i], depth: depth + 1 });
      continue;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    const manuKey = keys.find((key) => MANU_TAG_KEY.test(key));
    if (manuKey !== undefined) {
      state.products += 1;
      const rank = rankOf(record) ?? state.products;
      const productId = productIdOf(record);
      for (const piece of tagPieces(record[manuKey])) {
        const text = piece.trim();
        if (isDroppedTag(text) || text.length > TAG_TEXT_MAX) continue;
        out.push(tagRow(text, rank, productId, null));
      }
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i]!;
      if (key === manuKey) continue;
      const child = record[key];
      if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
    }
  }
}

export function parseBrowserResponse(text: string): ParsedCompetitorInput {
  const root = parseJsonOrFail(text.trim());
  const sources = harBodies(root) ?? [root];
  const tags: ParsedCompetitorTag[] = [];
  const state = { products: 0, nodes: 0 };
  for (const source of sources) collect(source, tags, state);
  if (tags.length === 0) throw new CompetitorParseError('IMPORT_EMPTY');
  return { hasFrequency: false, tags };
}
