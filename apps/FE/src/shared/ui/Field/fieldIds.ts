import type { ReactNode } from 'react';

/** 입력칸 도움말·오류 글의 id. 칸의 aria-describedby에 넣는다. */
export function fieldDescribedBy(
  id: string,
  { hint, error }: { hint?: ReactNode; error?: ReactNode },
  extra?: string,
): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null, extra ?? null].filter(
    Boolean,
  );
  return ids.length > 0 ? ids.join(' ') : undefined;
}
