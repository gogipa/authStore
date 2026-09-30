import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TextField } from './TextField';
import { moduleClassNames } from '@/test/cssModules';

describe('TextField', () => {
  it('라벨(<label for>)로 칸을 찾을 수 있다', async () => {
    render(<TextField label="근거 링크" type="url" />);
    const input = screen.getByLabelText('근거 링크');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'url');
    expect(input).not.toHaveAttribute('aria-invalid');
    await userEvent.type(input, 'abc');
    expect(input).toHaveValue('abc');
  });

  it('error가 있으면 aria-invalid="true"이고 오류 글이 설명으로 붙는다', () => {
    render(<TextField label="국내 기준가" unit="원" numeric error="숫자만 넣을 수 있습니다." />);
    const input = screen.getByLabelText('국내 기준가');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('숫자만 넣을 수 있습니다.');
    expect(screen.getByText('원')).toBeInTheDocument();
    expect(moduleClassNames(input)).toEqual(['input', 'numeric']);
  });

  it('locked면 읽기 전용이고 잠김 모양이다', () => {
    render(<TextField label="쿠폰" unit="¥" locked defaultValue="0" />);
    const input = screen.getByLabelText('쿠폰');
    expect(input).toHaveAttribute('readonly');
    expect(moduleClassNames(input.parentElement)).toContain('locked');
  });

  it('label을 비우면 칸만 그리고 밖의 <label htmlFor>로 찾는다(P1-11). mono는 코드 값 모양', () => {
    render(
      <>
        <label htmlFor="codex-text">텍스트 모델</label>
        <TextField id="codex-text" mono placeholder="모델 ID 직접 입력" />
      </>,
    );
    const input = screen.getByLabelText('텍스트 모델');
    expect(input).toHaveAttribute('placeholder', '모델 ID 직접 입력');
    expect(moduleClassNames(input)).toEqual(['input', 'mono']);
    expect(document.querySelectorAll('label')).toHaveLength(1);
  });
});
