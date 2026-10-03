import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PageHeader } from '../PageHeader/PageHeader';

function renderHeader(help?: string) {
  return render(
    <>
      <PageHeader title="키워드" description="설명" help={help ? <p>{help}</p> : undefined} />
      <button type="button">다음 버튼</button>
    </>,
  );
}

describe("화면 제목 옆 '?' 도움말(PageHeader help, D-29)", () => {
  it('help가 없으면 버튼도 판도 없다', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: '이 화면 도움말' })).toBeNull();
    expect(screen.queryByText('이 화면 도움말')).toBeNull();
  });

  it('제목 옆 버튼은 닫힌 판을 aria-controls로 가리키고 aria-expanded=false다', () => {
    renderHeader('할 일 글');
    const heading = screen.getByRole('heading', { level: 1, name: '키워드' });
    const button = screen.getByRole('button', { name: '이 화면 도움말' });
    expect(heading.parentElement).toContainElement(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(button.getAttribute('aria-controls')!);
    expect(panel).not.toBeNull();
    expect(panel).not.toBeVisible();
    expect(screen.queryByRole('region', { name: '이 화면 도움말' })).toBeNull();
  });

  it('누르면 판이 열리고(aria-expanded=true) 다시 누르면 닫힌다', async () => {
    renderHeader('할 일 글');
    const button = screen.getByRole('button', { name: '이 화면 도움말' });
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('region', { name: '이 화면 도움말' });
    expect(within(panel).getByText('할 일 글')).toBeVisible();
    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: '이 화면 도움말' })).toBeNull();
  });

  it('키보드: Enter·Space로 여닫고, 판 안에서 Esc를 누르면 닫히며 초점이 ? 버튼으로 돌아간다', async () => {
    renderHeader('할 일 글');
    const button = screen.getByRole('button', { name: '이 화면 도움말' });
    button.focus();
    await userEvent.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard(' ');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    await userEvent.keyboard('{Enter}');

    const panel = screen.getByRole('region', { name: '이 화면 도움말' });
    const close = within(panel).getByRole('button', { name: '도움말 닫기' });
    close.focus();
    await userEvent.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it("'도움말 닫기'를 누르면 닫히고 초점이 ? 버튼으로 돌아간다", async () => {
    renderHeader('할 일 글');
    const button = screen.getByRole('button', { name: '이 화면 도움말' });
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: '도움말 닫기' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });
});
