import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FX_FETCH_FAILED_WARNING, fxLatest, fxRecord } from '@/test/fixtures/pricing';
import { FxRateSummary } from './FxRateSummary';

const cells = () =>
  within(screen.getByRole('list', { name: '최신 환율' })).getAllByRole('listitem');

describe('FxRateSummary(P2-04 — SCR-10 환율 탭·SCR-04 ③)', () => {
  it("rateValue 876 · unit 100 → '8.76원/엔', 칸 머리 '원가 환율 · 자동 09:00', 3종 순서", () => {
    render(<FxRateSummary latest={fxLatest()} />);
    expect(cells().map((li) => li.textContent)).toEqual([
      '원가 환율 · 자동 09:008.76원/엔',
      '과세환율(엔) · 자동 09:008.76원/엔',
      '과세환율(달러) · 자동 09:001,358.72원/달러',
    ]);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('warnings에 FX_FETCH_FAILED → 경고 띠(Banner warning)에 서버 문구 그대로', () => {
    render(<FxRateSummary latest={fxLatest([FX_FETCH_FAILED_WARNING])} />);
    const banner = screen.getByRole('status');
    expect(within(banner).getByText(FX_FETCH_FAILED_WARNING.message)).toBeInTheDocument();
  });

  it('값이 없는 종류는 — 와 없음, 원가만 보이게 고를 수 있고 직접 넣기 단추는 그 종류를 알린다', async () => {
    const onManualInput = vi.fn();
    render(
      <FxRateSummary
        latest={{ items: [fxRecord()], warnings: [] }}
        series={['COST/JPY', 'CUSTOMS/USD']}
        onManualInput={onManualInput}
      />,
    );
    expect(cells().map((li) => li.textContent)).toEqual([
      '원가 환율 · 자동 09:008.76원/엔직접 넣기',
      '과세환율(달러) · 없음—직접 넣기',
    ]);
    await userEvent.click(within(cells()[1]!).getByRole('button', { name: '직접 넣기' }));
    expect(onManualInput).toHaveBeenCalledWith('CUSTOMS/USD');
  });

  it('받는 중에는 칸 머리가 받는 중', () => {
    render(<FxRateSummary latest={undefined} pending series={['COST/JPY']} />);
    expect(cells()[0]).toHaveTextContent('원가 환율 · 받는 중—');
  });
});
