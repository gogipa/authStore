/**
 * ⑥-3 HTML 글 이스케이프(P3-04 규칙 11 — 텍스트는 모두 HTML 이스케이프). 카피·사양·고지 글에 든 `<b>` 같은 표기는 태그가 아니라
 * 글로 보인다. 줄바꿈은 `<br>`로 바꾸지 않는다(문단은 조립기가 나눈다).
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
