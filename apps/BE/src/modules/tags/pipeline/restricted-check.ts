import { tagKeyOf } from './normalize.js';

/**
 * ⑦ 1차 제한 태그 검증(F-TG-10, PRD §8.6 5 ①, P3-05 규칙 10). 규칙 필터를 통과한 후보만 restricted-tags로 확인한다.
 * 1회 최대 개수는 M0 S3 전이라 설정 `tags.restrictedBatchSize`개씩 나눠 부른다. 응답 `tag`는 보낸 글자 또는 정규화 키로 맞춘다.
 * 응답에 없는 태그는 null(조회 안 함과 같게 — 승인 때 RG-08이 다시 본다, Proposed).
 */

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step));
  return out;
}

export interface RestrictedCheckResult {
  /** 정규화 키 → restricted(응답에 없으면 null) */
  byKey: Map<string, boolean | null>;
  /** 부른 횟수(0이면 restricted_checked_at을 남기지 않는다) */
  calls: number;
}

export async function checkRestricted(
  tags: readonly { text: string; textKey: string }[],
  batchSize: number,
  call: (batch: string[]) => Promise<{ tag: string; restricted: boolean }[]>,
): Promise<RestrictedCheckResult> {
  const byKey = new Map<string, boolean | null>(tags.map((tag) => [tag.textKey, null]));
  let calls = 0;
  for (const batch of chunk(tags, batchSize)) {
    const verdicts = await call(batch.map((tag) => tag.text));
    calls += 1;
    const byText = new Map(verdicts.map((v) => [v.tag, v.restricted]));
    const byNorm = new Map(verdicts.map((v) => [tagKeyOf(v.tag), v.restricted]));
    for (const tag of batch) {
      const verdict = byText.get(tag.text) ?? byNorm.get(tag.textKey);
      byKey.set(tag.textKey, verdict ?? null);
    }
  }
  return { byKey, calls };
}
