import { createHash } from 'node:crypto';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * 레퍼런스 해시(ERD `generation_run.reference_set_sha256`·`thumbnail_reference_input` '선택의 해시', PRD §12) — 순수 함수.
 * 고른 레퍼런스 파일 SHA-256(소문자 hex 64자)들을 **정렬해 이은 값**(구분자 없음)의 SHA-256(소문자 hex).
 * 순서만 바꾼 같은 파일 묶음은 같은 값이다. P3-01 레퍼런스 저장(`owner.referenceSelection`), P3-02 `generation_run`과
 * G3 지문(`g3Basis.referenceHashes`)이 이 함수 하나를 쓴다.
 */
export function referenceSetSha256(fileSha256s: readonly string[]): string {
  if (fileSha256s.length === 0) throw new Error('레퍼런스가 없습니다(1장 이상).');
  for (const sha of fileSha256s) {
    if (!SHA256_HEX.test(sha)) throw new Error(`파일 해시 형식이 아닙니다: ${sha}`);
  }
  const joined = [...fileSha256s].sort().join('');
  return createHash('sha256').update(joined, 'utf8').digest('hex');
}
