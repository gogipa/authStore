import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GateBadge } from './GateBadge';
import { moduleClassNames } from '@/test/cssModules';

function diamond(container: HTMLElement) {
  return container.querySelector('rect');
}

describe('GateBadge', () => {
  it('G2 · passed → "G2 판정 확정 · 통과", done 색, 채운 마름모', () => {
    const { container } = render(<GateBadge gate="G2" state="passed" />);
    expect(container.firstElementChild).toHaveTextContent('G2 판정 확정 · 통과');
    expect(moduleClassNames(container.firstElementChild)).toEqual(['badge', 'passed']);
    expect(diamond(container)).toHaveAttribute('fill', 'currentColor');
  });

  it('G3 · locked → "G3 썸네일 선택 · 잠김", idle 색, 마름모 fill="none"(테두리만)', () => {
    const { container } = render(<GateBadge gate="G3" state="locked" />);
    expect(container.firstElementChild).toHaveTextContent('G3 썸네일 선택 · 잠김');
    expect(moduleClassNames(container.firstElementChild)).toEqual(['badge', 'locked']);
    expect(diamond(container)).toHaveAttribute('fill', 'none');
    expect(diamond(container)).toHaveAttribute('stroke', 'currentColor');
  });

  it('G4 · pending → "G4 최종 승인 · 확인 필요", waiting 색', () => {
    const { container } = render(<GateBadge gate="G4" state="pending" />);
    expect(container.firstElementChild).toHaveTextContent('G4 최종 승인 · 확인 필요');
    expect(moduleClassNames(container.firstElementChild)).toEqual(['badge', 'pending']);
    expect(diamond(container)).toHaveAttribute('fill', 'currentColor');
  });

  it.each([
    ['G1', '키워드 선택'],
    ['G5', '전시 켜기'],
  ] as const)('%s 이름은 GATE_LABEL(%s)', (gate, name) => {
    const { container } = render(<GateBadge gate={gate} state="passed" />);
    expect(container.firstElementChild).toHaveTextContent(`${gate} ${name} · 통과`);
  });
});
