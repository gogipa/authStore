import { useEffect, useState } from 'react';

/**
 * 값이 `delayMs` 동안 바뀌지 않으면 그 값을 돌려준다(입력이 멈춘 뒤 검사 요청 — P2-02 라쿠텐 검색어 검사).
 * 처음 값은 곧바로 돌려준다(첫 화면에서 기다리지 않는다).
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (Object.is(value, debounced)) return undefined;
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, debounced, delayMs]);
  return debounced;
}
