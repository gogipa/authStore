import { sha256Hex } from '../../../step-engine/domain/fingerprint.js';
import type { CopyDraft } from '../../copy/copy.schema.js';
import { sanitizeHtml } from './html-sanitizer.js';
import { escapeHtml } from './html-text.js';
import { imageSectionHtml } from './image-placeholder.js';

/**
 * 상세 HTML 조립(P3-04 규칙 11, F-CT-29, CT-06). AI 없이 **고지 → 이미지 자리표시자 → 카피 → 사양 블록** 순(시안 미리보기 순서)으로
 * 붙인다. 글은 모두 이스케이프하고(카피에 든 `<b>`는 글로 보인다), 붙인 뒤 한 번 더 정리(`sanitizeHtml` — script·style·data: URI·
 * 외부 링크·on* 속성 제거)한 결과의 SHA-256을 `html_sha256`으로 둔다. 이미지 자리에는 자리표시자만 둔다 — 썸네일만 다시 골라도
 * ⑥-3은 그대로이고 ⑧만 다시 돈다(PRD §5.3).
 * 전체: `<div data-autostore-detail="v1">DISCLOSURE · IMAGES · COPY · SPEC</div>`(버전 표식 v1 — Proposed).
 */

/** 문단 나누기(빈 줄 또는 줄바꿈 기준 — 빈 문단은 뺀다) */
function paragraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** 카피 구획: 헤드라인 → 셀링포인트 → 본문 → 착화감·코디 → 사이즈 안내(카피에 쓴 원문 사실은 넣지 않는다) */
export function copySectionHtml(copy: Omit<CopyDraft, 'source_facts_used'>): string {
  const parts: string[] = [];
  if (copy.headline.trim()) parts.push(`<h3>${escapeHtml(copy.headline.trim())}</h3>`);
  const points = copy.selling_points.map((p) => p.trim()).filter((p) => p !== '');
  if (points.length > 0) {
    parts.push(`<ul>${points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`);
  }
  for (const text of [copy.body, copy.fit_and_styling, copy.size_guide]) {
    for (const line of paragraphs(text)) parts.push(`<p>${escapeHtml(line)}</p>`);
  }
  return `<div data-autostore-section="COPY">${parts.join('')}</div>`;
}

export interface DetailHtmlInput {
  disclosureHtml: string;
  copy: Omit<CopyDraft, 'source_facts_used'>;
  specBlockHtml: string;
}

/** 조립 + 정리 + 해시 */
export function buildDetailHtml(input: DetailHtmlInput): { html: string; htmlSha256: string } {
  const raw = [
    '<div data-autostore-detail="v1">',
    input.disclosureHtml,
    imageSectionHtml(),
    copySectionHtml(input.copy),
    input.specBlockHtml,
    '</div>',
  ].join('');
  return finalizeHtml(raw);
}

/** 정리 + 해시(오너 수정으로 사양 블록만 바꿀 때도 쓴다) */
export function finalizeHtml(raw: string): { html: string; htmlSha256: string } {
  const html = sanitizeHtml(raw);
  return { html, htmlSha256: sha256Hex(html) };
}
