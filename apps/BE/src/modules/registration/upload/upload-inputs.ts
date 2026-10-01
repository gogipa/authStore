import type { StepInput } from '../../step-engine/contracts/step-runner.js';
import { fingerprint, NULL_VALUE_HASH, valueHash } from '../../step-engine/domain/fingerprint.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';

/** ⑤ G3 선택본 입력 값 한 칸: 순서와 원천 파일 해시만(규칙 3 — 업로드 시각·URL·수집 시각은 넣지 않는다) */
export interface SelectionHashItem {
  sortOrder: number;
  sha256: string;
}

/** 선택본 입력 값(`thumbnail.selection`): sort_order 순으로 `{sortOrder, sha256}`만 */
export function selectionInputValue(
  images: readonly { sortOrder: number; sha256: string }[],
): SelectionHashItem[] {
  return [...images]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((image) => ({ sortOrder: image.sortOrder, sha256: image.sha256 }));
}

export interface UploadInputSources {
  /** ⑤ 현재 완료 버전(없으면 null) */
  thumbnailStepRunId: number | null;
  /** 그 버전의 선택본(없으면 null) */
  selection: readonly { sortOrder: number; sha256: string }[] | null;
  /** ⑥-3 현재 완료 버전(없으면 null) */
  noticeHtmlStepRunId: number | null;
  /** 그 버전의 `html_sha256`(없으면 null) */
  htmlSha256: string | null;
}

/**
 * ⑧ 입력(규칙 3, PRD §5.3 규칙 1): ⑤ G3 선택본 이미지의 `sha256`(sort_order 순)과 ⑥-3 `html_sha256` 두 개뿐이고 둘 다 필수
 * 시작 조건(`source_type=PREV_STEP` + `source_step_run_id`). 엔진이 이 값으로 입력 지문을 만들고, P1-05 '재실행 필요' 전파가
 * 같은 값을 다시 읽어 비교한다(G3 선택본이나 ⑥-3 HTML이 바뀌면 ⑧만 재실행 필요 — 바뀐 입력 이름이 남는다).
 */
export function uploadStepInputs(sources: UploadInputSources): StepInput[] {
  return [
    {
      inputKey: INPUT_KEYS.thumbnailSelection,
      sourceType: 'PREV_STEP',
      sourceStepRunId: sources.thumbnailStepRunId,
      isStartCondition: true,
      required: true,
      value:
        sources.selection && sources.selection.length > 0
          ? selectionInputValue(sources.selection)
          : null,
    },
    {
      inputKey: INPUT_KEYS.noticeHtmlHtml,
      sourceType: 'PREV_STEP',
      sourceStepRunId: sources.noticeHtmlStepRunId,
      isStartCondition: true,
      required: true,
      value: sources.htmlSha256,
    },
  ];
}

/** 입력 지문(엔진과 같은 계산 — 시작 조건 입력의 값 해시를 키 순으로 묶은 SHA-256). 테스트·설명용 */
export function uploadInputFingerprint(inputs: readonly StepInput[]): string {
  const hashes: Record<string, string> = {};
  for (const input of inputs) {
    if (!input.isStartCondition) continue;
    hashes[input.inputKey] =
      input.value === null || input.value === undefined ? NULL_VALUE_HASH : valueHash(input.value);
  }
  return fingerprint(hashes);
}
