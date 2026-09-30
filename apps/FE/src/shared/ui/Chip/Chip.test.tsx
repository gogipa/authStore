import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, type ChipTone } from './Chip';
import { moduleClassNames } from '@/test/cssModules';

describe('Chip', () => {
  it.each(['outline', 'neutral', 'waiting', 'accent', 'idle', 'done', 'failed'] as ChipTone[])(
    'tone %s → 클래스 하나',
    (tone) => {
      const { container } = render(<Chip tone={tone}>AI 생성</Chip>);
      expect(moduleClassNames(container.firstElementChild)).toEqual(['chip', tone]);
      expect(container.firstElementChild).toHaveTextContent('AI 생성');
    },
  );

  it('icon을 주면 글자 앞에 아이콘(장식)을 둔다', () => {
    const { container } = render(
      <Chip tone="done" icon="check">
        키체인에 저장됨
      </Chip>,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(container.firstElementChild).toHaveTextContent('키체인에 저장됨');
  });
});
