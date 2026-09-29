/**
 * CSS Module 클래스의 원래 이름. Vitest는 `_<이름>_<해시>` 모양(stable)으로 만든다.
 * 예: '_chip_a956a5 _done_a956a5' → ['chip', 'done'].
 */
export function moduleClassNames(element: Element | null | undefined): string[] {
  if (!element) return [];
  return Array.from(element.classList).map((name) => /^_(.+)_[0-9a-z]+$/i.exec(name)?.[1] ?? name);
}
