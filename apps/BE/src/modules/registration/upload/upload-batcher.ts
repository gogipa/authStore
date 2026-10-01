import { UPLOAD_MAX_BYTES_EXCLUSIVE } from '../../../common/files/image-asset.rules.js';

/** 한 번 호출에 넣는 파일 수 상한(F-AP-03 — 커머스API 이미지 업로드 1회 10장) */
export const UPLOAD_BATCH_MAX_FILES = 10;
/** 한 번 호출의 바이트 합 상한(**미만**, F-AP-03 — 10MB = 10,485,760바이트) */
export const UPLOAD_BATCH_MAX_BYTES_EXCLUSIVE = UPLOAD_MAX_BYTES_EXCLUSIVE;

export interface BatchLimits {
  maxFiles: number;
  /** 묶음 바이트 합이 이 값보다 작아야 한다 */
  maxBytesExclusive: number;
}

export const DEFAULT_BATCH_LIMITS: BatchLimits = {
  maxFiles: UPLOAD_BATCH_MAX_FILES,
  maxBytesExclusive: UPLOAD_BATCH_MAX_BYTES_EXCLUSIVE,
};

/** 한 파일만으로 묶음 상한을 넘는다(정규화본은 10MB 미만이라 생기지 않아야 한다 — 앱 코드의 잘못) */
export class UploadBatchError extends Error {
  constructor(readonly byteSize: number) {
    super(`파일 하나(${byteSize}바이트)가 한 번 호출의 상한을 넘습니다`);
    this.name = 'UploadBatchError';
  }
}

/**
 * 업로드 묶음 나누기(P4-01 §5 `upload-batcher.ts`, 순수 함수). 받은 순서를 지키며 앞에서부터 채운다: 지금 묶음에 넣으면 10장을
 * 넘거나 바이트 합이 10,485,760 **이상**이 되면 새 묶음을 연다(합이 정확히 10,485,760이면 한 묶음이 아니다 — '미만' 규칙).
 * 순서를 바꿔 더 적게 나누지는 않는다(보낸 순서 = 응답 URL 순서 가정을 단순하게 지킨다).
 */
export function splitUploadBatches<T extends { byteSize: number }>(
  files: readonly T[],
  limits: BatchLimits = DEFAULT_BATCH_LIMITS,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const file of files) {
    if (file.byteSize >= limits.maxBytesExclusive) throw new UploadBatchError(file.byteSize);
    const full =
      current.length >= limits.maxFiles || bytes + file.byteSize >= limits.maxBytesExclusive;
    if (full && current.length > 0) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(file);
    bytes += file.byteSize;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
