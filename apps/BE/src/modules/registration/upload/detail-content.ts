import { createHash } from 'node:crypto';
import {
  countImagePlaceholders,
  fillImagePlaceholders,
  IMAGE_SLOT_COUNT,
} from '../../../common/rules/detail-html.js';

/** 최종 본문을 만들지 못함(⑧ 실패 — 바꾸지 못한 자리표시자가 남음) */
export class DetailContentError extends Error {
  constructor(readonly remaining: number) {
    super(`바꾸지 못한 이미지 자리표시자가 ${remaining}개 남았습니다`);
    this.name = 'DetailContentError';
  }
}

export interface DetailContent {
  detailContent: string;
  /** detail_content의 UTF-8 SHA-256 hex */
  detailContentSha256: string;
}

/**
 * 최종 상세 본문(P4-01 §5 `detail-content.ts`, 규칙 9, F-AP-06, 순수 함수). ⑥-3 `html`의 이미지 자리표시자(P3-04 계약 —
 * `common/rules/detail-html.ts`: `<p data-autostore-image-slot="{n}"><img src="autostore-image:selection/{n}" …></p>`, n = G3
 * 선택본 `sort_order`)를 이 버전의 업로드 URL로 바꾼다. 선택본에 없는 칸은 칸째 뺀다(P3-04 계약 — ⑥-3은 늘 10칸을 둔다).
 * 바꾼 뒤 `autostore-image:`가 하나라도 남으면(모르는 모양의 자리표시자·0~9 밖 칸) `DetailContentError` — ⑧을 실패로 둔다.
 */
export function buildDetailContent(
  html: string,
  urlBySlot: ReadonlyMap<number, string>,
): DetailContent {
  const detailContent = fillImagePlaceholders(html, (slot) =>
    slot >= 0 && slot < IMAGE_SLOT_COUNT ? (urlBySlot.get(slot) ?? null) : null,
  );
  const remaining = countImagePlaceholders(detailContent);
  if (remaining > 0) throw new DetailContentError(remaining);
  return {
    detailContent,
    detailContentSha256: createHash('sha256').update(detailContent, 'utf8').digest('hex'),
  };
}
