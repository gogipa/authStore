/** 가짜 SHA-256(64자 16진수) — 같은 글자면 같은 값(예시 데이터의 지문 칸) */
export function fakeSha256(seed: string): string {
  let hash = 0x811c9dc5;
  let out = '';
  while (out.length < 64) {
    for (const char of `${seed}:${out.length}`) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}

/** 05-3 페이지 한 쪽(page·size로 자른다) */
export function pageOf<T>(all: readonly T[], page = 0, size = 20) {
  const safeSize = size > 0 ? size : 20;
  const content = all.slice(page * safeSize, (page + 1) * safeSize);
  return {
    content,
    page: {
      number: page,
      size: safeSize,
      totalElements: all.length,
      totalPages: Math.ceil(all.length / safeSize),
    },
  };
}
