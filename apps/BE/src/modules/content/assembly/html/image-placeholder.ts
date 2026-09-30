/**
 * 상세 HTML 이미지 자리표시자(P3-04 규칙 11·12, CT-06 — P4-01이 import해 쓴다). 형식·채우기 함수의 원본은 공용 규칙
 * `common/rules/detail-html.ts` 한 곳이다(단계 모듈끼리 import하지 않는 규칙 때문에 content 밖에 둔다). 이 파일은 ⑥-3 쪽 입구로
 * 같은 상수를 다시 내보낸다.
 * - 칸: `<p data-autostore-image-slot="{n}"><img src="autostore-image:selection/{n}" alt="…"></p>`, n = G3 선택본 순서
 *   (0 대표, 1~9 추가). ⑥-3은 G3을 읽지 않으므로 늘 10칸을 둔다
 * - 채우기: 미리보기는 `/api/v1/image-assets/{id}/file`, ⑧은 업로드 URL. 그 순서의 이미지가 없으면 칸을 뺀다
 */
export {
  countImagePlaceholders,
  fillImagePlaceholders,
  IMAGE_PLACEHOLDER_SCHEME,
  IMAGE_SLOT_COUNT,
  imagePlaceholderHtml,
  imagePlaceholderSrc,
  imageSlotOf,
} from '../../../../common/rules/detail-html.js';

import { IMAGE_SLOT_COUNT, imagePlaceholderHtml } from '../../../../common/rules/detail-html.js';

/** 이미지 구획(선택본 10칸) */
export function imageSectionHtml(): string {
  const slots = Array.from({ length: IMAGE_SLOT_COUNT }, (_v, slot) => imagePlaceholderHtml(slot));
  return `<div data-autostore-section="IMAGES">${slots.join('')}</div>`;
}

/** 미리보기 이미지 주소(P1-01 이미지 파일 API — 같은 출처, CSP `img-src 'self'`) */
export function localImageUrl(imageAssetId: number): string {
  return `/api/v1/image-assets/${imageAssetId}/file`;
}
