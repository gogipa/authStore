import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusChip } from './StatusChip';
import { STEP_STATUS_LABEL } from './statusLabel';
import type { StepStatus } from './statusLabel';
import { moduleClassNames } from '@/test/cssModules';

// 규칙 2의 표(04-3 §3, 공통부품 §C): 코드 → 글자 · 클래스 · 아이콘(상태마다 하나로 고정)
const TABLE: Array<[StepStatus, string, string, string]> = [
  ['COMPLETED', '완료', 'done', 'check'],
  ['RUNNING', '실행중', 'running', 'progress'],
  ['WAITING_INPUT', '입력 대기', 'waiting', 'pause'],
  ['RERUN_REQUIRED', '재실행 필요', 'rerun', 'undo'],
  ['FAILED', '실패', 'failed', 'alert'],
  ['NOT_RUN', '미실행', 'idle', 'circle'],
];

describe('StatusChip', () => {
  it.each(TABLE)('%s → "%s" · .%s · 아이콘 %s', (status, label, className, icon) => {
    const { container } = render(<StatusChip status={status} />);
    const chip = container.firstElementChild;
    expect(chip).toHaveTextContent(label);
    expect(moduleClassNames(chip)).toEqual(['chip', className]);
    const svg = chip?.querySelector('svg');
    expect(svg?.getAttribute('data-icon')).toBe(icon);
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '12');
  });

  it('글자 표는 6개 코드 전부를 덮는다', () => {
    expect(Object.keys(STEP_STATUS_LABEL).sort()).toEqual(TABLE.map(([s]) => s).sort());
  });

  it('status="FAILED" detail="INTERRUPTED" → "실패(중단됨)"(칩 모양은 같다)', () => {
    const { container } = render(<StatusChip status="FAILED" detail="INTERRUPTED" />);
    expect(screen.getByText('실패(중단됨)')).toBeInTheDocument();
    expect(moduleClassNames(container.firstElementChild)).toEqual(['chip', 'failed']);
  });

  it('FAILED가 아닌 상태에서는 detail을 무시한다', () => {
    render(<StatusChip status="COMPLETED" detail="INTERRUPTED" />);
    expect(screen.getByText('완료')).toBeInTheDocument();
  });
});
