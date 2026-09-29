import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DefinitionList } from './DefinitionList';

describe('DefinitionList', () => {
  it('dt·dd 쌍을 그리고 labelWidth를 라벨 열 폭으로 쓴다', () => {
    const { container } = render(
      <DefinitionList
        labelWidth={96}
        items={[
          { term: '설치', detail: '2.1.269' },
          { term: '실행 파일', detail: '~/.local/bin/claude' },
        ]}
      />,
    );
    const list = container.querySelector('dl');
    expect(list?.style.getPropertyValue('--dl-label-width')).toBe('96px');
    expect(screen.getAllByRole('term').map((t) => t.textContent)).toEqual(['설치', '실행 파일']);
    expect(screen.getAllByRole('definition').map((d) => d.textContent)).toEqual([
      '2.1.269',
      '~/.local/bin/claude',
    ]);
  });

  it('labelWidth 기본값은 76px(AiEngine 보드)', () => {
    const { container } = render(<DefinitionList items={[{ term: 'a', detail: 'b' }]} />);
    expect(container.querySelector('dl')?.style.getPropertyValue('--dl-label-width')).toBe('76px');
  });
});
