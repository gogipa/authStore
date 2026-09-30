import { htmlText } from '../../../../common/rules/detail-html.js';
import { imageSlotOf } from './image-placeholder.js';

/**
 * 상세 HTML 위험 요소 제거(P3-04 규칙 11, F-CT-30, CT-06). 새 의존성 없이 **허용 목록** 방식으로 다시 쓴다(Proposed — ⑥-3 HTML은
 * 앱이 이스케이프한 글로 만들므로 이 정리는 겉에 한 번 더 두는 방어다. 미리보기 CSP만 믿지 않는다 — 주의 8).
 * - 통째로 빼는 태그(안의 글까지): script·style·iframe·object·embed·noscript·template·svg·math·textarea·select·title·head·
 *   frame·frameset·applet·form·button·link·meta·base
 * - 허용 태그: div·p·ul·ol·li·strong·b·em·i·br·h2·h3·h4·span·img·table·thead·tbody·tr·th·td. 그 밖의 태그(a 등)는 태그만 빼고
 *   안의 글은 둔다 — 외부 링크(`href`)가 남지 않는다
 * - 허용 속성: `data-autostore-section`·`data-autostore-detail`·`data-block-id`·`data-spec-row`·`data-autostore-image-slot`
 *   (값 모양 검사), img의 `alt`와 `src`. `src`는 자리표시자(`autostore-image:selection/{n}`)만 — `data:`·`http(s):`·
 *   `javascript:`이면 img를 뺀다. `on*`·`style`·`href` 같은 속성은 모두 뺀다
 * - 주석·`<!…>`는 뺀다. 태그가 아닌 `<`·`>`는 엔티티로 바꾼다
 * 이미 정리한 HTML을 다시 넣으면 그대로 나온다(`html_sha256`이 흔들리지 않는다).
 */

const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'textarea',
  'select',
  'title',
  'head',
  'frame',
  'frameset',
  'applet',
  'form',
  'button',
]);

/** 내용 없이 태그만 있는 위험 태그(통째로 뺀다) */
const DROP_VOID = new Set(['link', 'meta', 'base', 'input', 'source', 'track', 'param']);

const ALLOWED_TAGS = new Set([
  'div',
  'p',
  'ul',
  'ol',
  'li',
  'strong',
  'b',
  'em',
  'i',
  'br',
  'h2',
  'h3',
  'h4',
  'span',
  'img',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);

const VOID_TAGS = new Set(['br', 'img']);

/** 허용 속성 → 값 모양 */
const DATA_ATTRS: Readonly<Record<string, RegExp>> = {
  'data-autostore-section': /^[A-Z]{1,20}$/,
  'data-autostore-detail': /^v\d{1,3}$/,
  'data-block-id': /^[A-Z][A-Z0-9_]{0,39}$/,
  'data-spec-row': /^[A-Z_]{1,20}$/,
  'data-autostore-image-slot': /^\d$/,
};

const TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTR = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 태그 사이 글: 엔티티가 아닌 `&`, 남은 `<`·`>`를 엔티티로 */
function cleanText(text: string): string {
  return text
    .replace(/&(?!(?:#\d{1,7}|#x[0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parseAttrs(source: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const match of source.matchAll(ATTR)) {
    const name = match[1]!.toLowerCase();
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    out.push({ name, value: htmlText(raw) });
  }
  return out;
}

/** 허용 태그 하나를 다시 쓴다. img가 자리표시자 src를 못 가지면 null(뺀다) */
function rebuildTag(name: string, attrSource: string): string | null {
  const kept: string[] = [];
  let hasSrc = false;
  for (const { name: attr, value } of parseAttrs(attrSource)) {
    const pattern = DATA_ATTRS[attr];
    if (pattern) {
      if (pattern.test(value)) kept.push(`${attr}="${escapeAttr(value)}"`);
      continue;
    }
    if (name !== 'img') continue;
    if (attr === 'src') {
      if (imageSlotOf(value.trim()) === null) return null;
      kept.push(`src="${escapeAttr(value.trim())}"`);
      hasSrc = true;
    } else if (attr === 'alt') {
      kept.push(`alt="${escapeAttr(value)}"`);
    }
  }
  if (name === 'img' && !hasSrc) return null;
  return kept.length > 0 ? `<${name} ${kept.join(' ')}>` : `<${name}>`;
}

export function sanitizeHtml(html: string): string {
  let out = '';
  let last = 0;
  let skipUntil: string | null = null;
  for (const match of html.matchAll(TOKEN)) {
    const index = match.index;
    const whole = match[0];
    const text = html.slice(last, index);
    last = index + whole.length;
    if (skipUntil !== null) {
      const closing = whole.startsWith('</') ? match[1]?.toLowerCase() : undefined;
      if (closing === skipUntil) skipUntil = null;
      continue;
    }
    out += cleanText(text);
    const rawName = match[1];
    if (!rawName) continue; // 주석·<!…>
    const name = rawName.toLowerCase();
    const closing = whole.startsWith('</');
    const selfClosing = /\/\s*>$/.test(whole);
    if (DROP_WITH_CONTENT.has(name)) {
      if (!closing && !selfClosing) skipUntil = name;
      continue;
    }
    if (DROP_VOID.has(name) || !ALLOWED_TAGS.has(name)) continue;
    if (closing) {
      if (!VOID_TAGS.has(name)) out += `</${name}>`;
      continue;
    }
    const attrSource = (match[2] ?? '').replace(/\/\s*$/, '');
    const tag = rebuildTag(name, attrSource);
    if (tag !== null) out += tag;
  }
  if (skipUntil === null) out += cleanText(html.slice(last));
  return out;
}
