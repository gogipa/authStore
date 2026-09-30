import { createHash } from 'node:crypto';

/**
 * 상세 HTML 계약(P3-04 Proposed — 열린질문 P3-04 '이미지 자리표시자 형식과 고지 블록 해시 정의', P4-01·P4-02와 공유).
 * 단계 모듈끼리 import하지 않으므로(03-ADR-003) 공용 위치(`common/rules`)에 한 곳으로 둔다. ⑥-3(content)이 만들고,
 * ⑧(P4-01)이 자리표시자를 업로드 URL로 바꾸고, 사전 검증(P4-02 F-AP-15)이 최종 `detailContent`에서 고지 블록을 다시 해시한다.
 *
 * 1. 이미지 자리표시자: `<p data-autostore-image-slot="{n}"><img src="autostore-image:selection/{n}" alt="…"></p>`, n = G3
 *    선택본 `thumbnail_selection_image.sort_order`(0 = 대표, 1~9 = 추가). ⑥-3은 선택본 장수를 모르므로(G3을 읽지 않는다) 늘
 *    10칸을 둔다. 채우는 쪽은 그 순서의 이미지가 있으면 `src`를 바꾸고, 없으면 그 칸(`<p …>…</p>`) 전체를 뺀다
 *    (`fillImagePlaceholders`). 미리보기는 `/api/v1/image-assets/{id}/file`, ⑧은 업로드 URL로 채운다.
 * 2. 고지 블록 표식: 고지 한 줄 = `<p data-block-id="{블록 ID}">…</p>`(설정 `notice.blocks[].id`), 고지 전체는
 *    `<div data-autostore-section="DISCLOSURE">`. 구획 표식: DISCLOSURE → IMAGES → COPY → SPEC(규칙 11 순서).
 * 3. 고지 블록 해시(`disclosure_blocks[].sha256`): 블록 요소의 **글**(태그를 떼고 HTML 엔티티를 풀고) → NFC → 공백 여러 개를
 *    한 칸으로 → 앞뒤 공백 제거 → UTF-8 SHA-256 hex. 템플릿 해시(설정 검사 `noticeBlockSha256` — NFC·앞뒤 공백만, 자리표시자
 *    그대로)와 다르다: 템플릿이 앱 내장 해시와 같은지는 설정 검사(P1-03)와 ⑥-3 렌더러가 보고, 채운 블록이 그 템플릿에서 나왔는지는
 *    `renderedMatchesTemplate`(자리표시자 `{…}` 자리는 비지 않은 아무 글)로 본다. P4-02는 최종 `detailContent`에서
 *    `extractDisclosureBlocks` → (a) 필수 블록이 모두 있는지, (b) 각 블록 글이 설정 템플릿과 맞는지, (c) 글 해시가 ⑥-3 기록과
 *    같은지를 본다.
 */

/** 자리표시자 URL 접두사(정리기가 허용하는 유일한 `img src` 모양) */
export const IMAGE_PLACEHOLDER_SCHEME = 'autostore-image:';

/** 선택본 칸 수: 대표 1 + 추가 9(G3 규칙 — ADDITIONAL_IMAGE_MAX) */
export const IMAGE_SLOT_COUNT = 10;

/** 칸 n의 자리표시자 URL(`autostore-image:selection/0`) */
export function imagePlaceholderSrc(slot: number): string {
  return `${IMAGE_PLACEHOLDER_SCHEME}selection/${slot}`;
}

/** 자리표시자 URL이면 칸 번호, 아니면 null */
export function imageSlotOf(src: string): number | null {
  const match = /^autostore-image:selection\/(\d)$/.exec(src);
  return match ? Number(match[1]) : null;
}

/** 칸 하나의 마크업(글은 없다 — alt만) */
export function imagePlaceholderHtml(slot: number): string {
  const alt = slot === 0 ? '대표 이미지' : `추가 이미지 ${slot}`;
  return `<p data-autostore-image-slot="${slot}"><img src="${imagePlaceholderSrc(slot)}" alt="${alt}"></p>`;
}

const SLOT_PATTERN =
  /<p data-autostore-image-slot="(\d)"><img src="autostore-image:selection\/\d" alt="[^"<>]*"><\/p>/g;

/**
 * 자리표시자 채우기: 칸 n → `urlOf(n)`(없으면 null → 칸 전체를 뺀다). 미리보기(⑥-3 GET)와 ⑧ `detailContent`(P4-01)가 같이 쓴다.
 * URL은 부르는 쪽이 만든 값이라 `"`·`<`만 막는다(엔티티로 바꾼다).
 */
export function fillImagePlaceholders(
  html: string,
  urlOf: (slot: number) => string | null,
): string {
  return html.replace(SLOT_PATTERN, (_match, slotText: string) => {
    const slot = Number(slotText);
    const url = urlOf(slot);
    if (url === null) return '';
    const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const alt = slot === 0 ? '대표 이미지' : `추가 이미지 ${slot}`;
    return `<p data-autostore-image-slot="${slot}"><img src="${safe}" alt="${alt}"></p>`;
  });
}

/** 남은 자리표시자 수(⑧이 다 채웠는지 확인할 때) */
export function countImagePlaceholders(html: string): number {
  return html.split(IMAGE_PLACEHOLDER_SCHEME).length - 1;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

/** HTML 글 → 평문(태그 떼기, 엔티티 풀기) */
export function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|#x[0-9a-fA-F]+|[a-z]+);/g, (whole, name: string) => {
      if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
      if (name.startsWith('#') && name !== '#39')
        return String.fromCodePoint(Number(name.slice(1)));
      return ENTITIES[name] ?? whole;
    });
}

/** 고지 블록 글의 정규화(NFC → 공백 한 칸 → 앞뒤 공백 제거) */
export function normalizeBlockText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

/** 채운 고지 블록 글의 해시(`disclosure_blocks[].sha256`) */
export function renderedBlockSha256(text: string): string {
  return createHash('sha256').update(normalizeBlockText(text), 'utf8').digest('hex');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 채운 글이 템플릿(자리표시자 `{…}`는 비지 않은 아무 글)에서 나왔는가 */
export function renderedMatchesTemplate(template: string, rendered: string): boolean {
  const parts = normalizeBlockText(template).split(/\{[^{}]+\}/);
  const pattern = parts.map(escapeRegExp).join('.+?');
  return new RegExp(`^${pattern}$`, 'u').test(normalizeBlockText(rendered));
}

/** 상세 HTML 안의 고지 블록(문서 순서): 블록 ID와 평문 글 */
export function extractDisclosureBlocks(html: string): { blockId: string; text: string }[] {
  const out: { blockId: string; text: string }[] = [];
  const pattern = /<p data-block-id="([A-Z][A-Z0-9_]{0,39})">([\s\S]*?)<\/p>/g;
  for (const match of html.matchAll(pattern)) {
    out.push({ blockId: match[1]!, text: htmlText(match[2]!) });
  }
  return out;
}
