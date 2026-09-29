import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable, type DataTableColumn } from './DataTable';
import { moduleClassNames } from '@/test/cssModules';

interface Row {
  rank: number;
  keyword: string;
  price: number;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'rank', header: '순위', num: 'count', value: (r) => r.rank, width: 64 },
  { key: 'keyword', header: '키워드', cell: (r) => r.keyword },
  { key: 'price', header: '판매가', num: 'krw', value: (r) => r.price },
  { key: 'note', header: '메모', align: 'right', cell: () => '—' },
];

const ROWS: Row[] = [
  { rank: 1, keyword: '뉴발란스 530', price: 159000 },
  { rank: 2, keyword: '아식스 젤카야노14', price: 167300 },
];

describe('DataTable', () => {
  it('숫자 열은 오른쪽 정렬(.right)이고 Num으로 그린다', () => {
    render(<DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.rank} aria-label="키워드" />);
    const table = screen.getByRole('table', { name: '키워드' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((h) => moduleClassNames(h).includes('right'))).toEqual([
      true,
      false,
      true,
      true,
    ]);
    const priceCell = within(table).getByText('167,300원').closest('td');
    expect(moduleClassNames(priceCell)).toContain('right');
    expect(moduleClassNames(within(table).getByText('뉴발란스 530').closest('td'))).not.toContain(
      'right',
    );
  });

  it('selected 행에 .selected', () => {
    render(
      <DataTable
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.rank}
        isRowSelected={(r) => r.rank === 2}
        aria-label="키워드"
      />,
    );
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows.map((row) => moduleClassNames(row).includes('selected'))).toEqual([false, true]);
  });

  it('행이 없으면 빈 글을 보인다', () => {
    render(<DataTable columns={COLUMNS} rows={[]} rowKey={(r) => r.rank} aria-label="키워드" />);
    expect(screen.getByText('표시할 항목이 없습니다.')).toBeInTheDocument();
  });
});
