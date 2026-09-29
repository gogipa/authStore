import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Chip, type ChipTone } from './Chip';
import { moduleClassNames } from '@/test/cssModules';

describe('Chip', () => {
  it.each(['outline', 'neutral', 'waiting', 'accent', 'idle'] as ChipTone[])(
    'tone %s → 클래스 하나',
    (tone) => {
      const { container } = render(<Chip tone={tone}>AI 생성</Chip>);
      expect(moduleClassNames(container.firstElementChild)).toEqual(['chip', tone]);
      expect(container.firstElementChild).toHaveTextContent('AI 생성');
    },
  );
});
