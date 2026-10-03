import { createHash } from 'node:crypto';
import type { ThumbnailImageRole } from '../dto/thumbnail-output.dto.js';

/**
 * ⑤ G3 선택본(ERD `thumbnail_selection` + `thumbnail_selection_image`, P3-02 규칙 9·11·12) — 순수 값·함수.
 */

/** G3 체크리스트 키(05-2 GateThumbnailChecklist, 05-1 표 C, §7.4-30) — 보드 순서 */
export const G3_CHECKLIST_KEYS = [
  'shoeRatioOver70',
  'detailMatch',
  'colorMatchesSelectedColor',
  'referenceNoPerson',
  'noRealPersonResemblance',
  'noTextOrPrice',
  'singleProductSingleModel',
] as const;
export type G3ChecklistKey = (typeof G3_CHECKLIST_KEYS)[number];

/**
 * 체크리스트 버전(앱 상수 — `thumbnail_selection.checklist.version`, P3-02 Proposed). 항목·문구를 바꾸면 올린다. 형식은
 * `M1-<순번>`(M2에서 신발 길이·디테일 자동 검사가 붙으면 `M2-1`). `M1-2`: D-22로 첫 항목 문구를 '신발 비중 70% 이상'에서
 * '신발 길이가 화면 폭의 70% 이상'으로 바꿨다(키 `shoeRatioOver70`은 그대로). 이미 저장된 `M1-1` 기록은 그대로 둔다
 */
export const G3_CHECKLIST_VERSION = 'M1-2';

/** 저장하는 체크리스트(7개 모두 true + 버전) */
export type G3ChecklistSnapshot = { version: string } & Record<G3ChecklistKey, boolean>;

/** 7개 모두 true인 스냅샷(검사를 통과한 뒤에만 만든다) */
export function checklistSnapshot(): G3ChecklistSnapshot {
  const snapshot = { version: G3_CHECKLIST_VERSION } as G3ChecklistSnapshot;
  for (const key of G3_CHECKLIST_KEYS) snapshot[key] = true;
  return snapshot;
}

/** 선택본 이미지 한 장(대표 sort_order 0, 추가 1~9) */
export interface SelectionImageInput {
  imageAssetId: number;
  role: ThumbnailImageRole;
  sortOrder: number;
}

/** 대표 1장 + 추가 0~9장 → 선택본 이미지 행(요청 순서가 추가이미지 순서) */
export function selectionImagesOf(
  representativeImageAssetId: number,
  additionalImageAssetIds: readonly number[],
): SelectionImageInput[] {
  return [
    { imageAssetId: representativeImageAssetId, role: 'REPRESENTATIVE', sortOrder: 0 },
    ...additionalImageAssetIds.map((imageAssetId, i) => ({
      imageAssetId,
      role: 'ADDITIONAL' as const,
      sortOrder: i + 1,
    })),
  ];
}

/**
 * ⑤ 실행기 결과 `output`(G3 선택으로 ⑤를 끝낼 때). 실행기 `persist`가 ⑤를 닫기 **전에** 같은 트랜잭션에서
 * `thumbnail_selection`(+image)을 쓴다(`trg_output_frozen`).
 */
export interface ThumbnailSelectionOutput {
  kind: 'THUMBNAIL_SELECTION';
  checklist: G3ChecklistSnapshot;
  sameProductColorConfirmedAt: Date | null;
  selectedAt: Date;
  images: SelectionImageInput[];
}

export function isThumbnailSelectionOutput(value: unknown): value is ThumbnailSelectionOutput {
  return (value as { kind?: unknown } | null)?.kind === 'THUMBNAIL_SELECTION';
}

/**
 * G3 지문의 '선택본 파일 해시'(PRD §5.1, ERD `gate_pass.fingerprint`, P3-02 Proposed — 범위는 대표 + 추가 **전체**, 순서 포함):
 * 선택본 이미지를 `sort_order` 순으로 `<sort_order>:<파일 SHA-256>`을 줄바꿈으로 이은 값의 SHA-256. 대표·추가이미지·추가 순서
 * 가운데 하나라도 바뀌면 달라진다(⑧ 업로드가 이 목록을 순서대로 올린다). 이미지가 없으면 null.
 * G3 공급자의 `basis`(⑤ 버전의 저장된 선택본)와 `passBasis`(통과 요청의 선택본)가 이 함수 하나를 쓴다.
 */
export function selectionSetSha256(
  images: readonly { sortOrder: number; sha256: string }[],
): string | null {
  if (images.length === 0) return null;
  const joined = [...images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => `${image.sortOrder}:${image.sha256}`)
    .join('\n');
  return createHash('sha256').update(joined, 'utf8').digest('hex');
}
