import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Num } from './Num';
import { formatNum } from './formatNum';
import { moduleClassNames } from '@/test/cssModules';

describe('Num', () => {
  it.each([
    [167300, 'krw', '167,300원'],
    [12000, 'yen', '¥12,000'],
    [255, 'mm', '255mm'],
    [10, 'pct', '10%'],
    ['2026-09-27T05:02:00Z', 'time', '14:02'],
    [1358, 'count', '1,358'],
  ] as const)('%s %s → %s', (value, unit, text) => {
    const { container } = render(<Num value={value} unit={unit} />);
    expect(container.firstElementChild).toHaveTextContent(text);
  });

  it('pct 자리 수(digits): 3 → 3.0%, 3.63 → 3.63%', () => {
    const rate = { minFractionDigits: 1, maxFractionDigits: 2 };
    const { container, rerender } = render(<Num value={3} unit="pct" digits={rate} />);
    expect(container.firstElementChild).toHaveTextContent('3.0%');
    rerender(<Num value={3.63} unit="pct" digits={rate} />);
    expect(container.firstElementChild).toHaveTextContent('3.63%');
  });

  it('mono·tabular-nums 글꼴(.num)이고 표 안에서는 오른쪽 정렬(.right)이 기본이다', () => {
    const { container } = render(<Num value={167300} unit="krw" />);
    expect(moduleClassNames(container.firstElementChild)).toEqual(['num', 'right']);
  });

  it('문장 안 숫자는 align="inline"', () => {
    const { container } = render(<Num value={38} unit="count" align="inline" />);
    expect(moduleClassNames(container.firstElementChild)).toEqual(['num', 'inline']);
  });

  it('값이 없거나 읽을 수 없으면 —', () => {
    expect(formatNum(null, 'krw')).toBe('—');
    expect(formatNum(undefined, 'time')).toBe('—');
    expect(formatNum('', 'yen')).toBe('—');
    expect(formatNum('abc', 'mm')).toBe('—');
    expect(formatNum('167300', 'krw')).toBe('167,300원');
  });
});
