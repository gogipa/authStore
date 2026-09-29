import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('라벨로 찾고, 오류면 aria-invalid, 잠기면 읽기 전용', () => {
    render(
      <>
        <Textarea label="데이터랩 화면에서 복사한 순위와 키워드" error="순위를 읽지 못했습니다." />
        <Textarea label="카피 본문" locked defaultValue="러닝화" />
      </>,
    );
    const paste = screen.getByLabelText('데이터랩 화면에서 복사한 순위와 키워드');
    expect(paste.tagName).toBe('TEXTAREA');
    expect(paste).toHaveAttribute('aria-invalid', 'true');
    expect(paste).toHaveAccessibleDescription('순위를 읽지 못했습니다.');
    expect(screen.getByLabelText('카피 본문')).toHaveAttribute('readonly');
  });
});
