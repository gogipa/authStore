import { useCallback, useState } from 'react';

/**
 * 제어(value + onChange)와 비제어(defaultValue) 둘 다 받는 부품용 상태.
 * value를 주면 그 값을 쓰고, 안 주면 안에서 기억한다. 바뀔 때마다 onChange를 부른다.
 */
export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [inner, setInner] = useState<T>(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;

  const setValue = useCallback(
    (next: T) => {
      if (!controlled) setInner(next);
      onChange?.(next);
    },
    [controlled, onChange],
  );

  return [current, setValue];
}
