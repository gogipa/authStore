import type { ContentDraftField } from '../../../generated/prisma/client.js';
import type { ContentDraftFieldItemDto } from '../dto/content.dto.js';

/** content_draft_field 한 행 → 05-2 ContentDraftFieldItem(`recheckRequired`는 계산) */
export function toFieldItem(row: ContentDraftField): ContentDraftFieldItemDto {
  return {
    id: row.id,
    stepRunId: row.stepRunId,
    fieldKey: row.fieldKey,
    value: row.value ?? null,
    generatedValue: row.generatedValue ?? null,
    valueSource: row.valueSource as ContentDraftFieldItemDto['valueSource'],
    extractionMethod: row.extractionMethod,
    evidenceQuote: row.evidenceQuote,
    evidenceUrl: row.evidenceUrl,
    evidenceImageAssetId: row.evidenceImageAssetId,
    basisItemCode: row.basisItemCode,
    ownerConfirmedAt: row.ownerConfirmedAt?.toISOString() ?? null,
    choicePending: row.choicePending,
    recheckReason: row.recheckReason,
    recheckResolvedAt: row.recheckResolvedAt?.toISOString() ?? null,
    recheckRequired: row.recheckReason !== null && row.recheckResolvedAt === null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 필드 행을 키 목록 순서로(목록 밖 키는 뒤에 id 순) */
export function sortFields<T extends { fieldKey: string; id: number }>(
  rows: readonly T[],
  order: readonly string[],
): T[] {
  const rank = (key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? order.length : i;
  };
  return [...rows].sort((a, b) => rank(a.fieldKey) - rank(b.fieldKey) || a.id - b.id);
}
