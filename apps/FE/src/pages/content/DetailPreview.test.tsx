import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DetailPreview } from './DetailPreview';

const URL = '/api/v1/candidates/1/content-assembly/preview?stepRunId=106';

describe('DetailPreview(SCR-06 ⑥-3 HTML 미리보기, P3-04)', () => {
  it('iframe에 sandbox가 있고 allow-scripts가 없다 — src는 미리보기 경로(fetch하지 않는다)', () => {
    render(<DetailPreview previewUrl={URL} reloadKey={1} />);
    const frame = screen.getByTitle('상세페이지 미리보기');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-scripts|allow-same-origin/);
    expect(frame).toHaveAttribute('src', URL);
    expect(screen.getByText('이미지 자리를 ⑤ 선택본(로컬)으로 채움')).toBeInTheDocument();
  });

  it("'크게 보기'는 칸을 키우고 '작게 보기'로 되돌린다", async () => {
    render(<DetailPreview previewUrl={URL} reloadKey={1} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '크게 보기' }));
    expect(screen.getByRole('button', { name: '작게 보기' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('reloadKey가 바뀌면 iframe을 새로 연다(G3 다시 고르기 — gate.passed 무효화)', () => {
    const { rerender } = render(<DetailPreview previewUrl={URL} reloadKey={1} />);
    const before = screen.getByTitle('상세페이지 미리보기');
    rerender(<DetailPreview previewUrl={URL} reloadKey={2} />);
    expect(screen.getByTitle('상세페이지 미리보기')).not.toBe(before);
  });
});
