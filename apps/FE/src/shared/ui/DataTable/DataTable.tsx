import type { Key, ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Num } from '../Num/Num';
import type { NumUnit, NumValue } from '../Num/formatNum';
import styles from './DataTable.module.css';

export type DataTableAlign = 'left' | 'right';

interface DataTableColumnBase {
  /** 열 이름(React key). */
  key: string;
  header: ReactNode;
  /** left(기본) · right. 숫자 열(`num`)은 늘 right. */
  align?: DataTableAlign;
  /** 열 폭(예: 64, '20%'). 비우면 남은 폭을 나눈다. */
  width?: number | string;
}

/** 칸을 직접 그리는 열. */
interface DataTableCellColumn<Row> extends DataTableColumnBase {
  cell: (row: Row, index: number) => ReactNode;
  num?: never;
  value?: never;
}

/** 숫자 열: `Num`으로 그리고 오른쪽 정렬한다(공통부품 §J). */
interface DataTableNumColumn<Row> extends DataTableColumnBase {
  num: NumUnit;
  value: (row: Row) => NumValue;
  cell?: never;
}

export type DataTableColumn<Row> = DataTableCellColumn<Row> | DataTableNumColumn<Row>;

export interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row, index: number) => Key;
  /** 참이면 그 행에 `.selected`(accent-soft 바탕). */
  isRowSelected?: (row: Row) => boolean;
  /** 행이 없을 때 표 안에 보일 글. */
  empty?: ReactNode;
  /** 표 이름(보이는 제목이 있으면 `aria-labelledby`를 쓴다). */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  className?: string;
}

function columnAlign<Row>(column: DataTableColumn<Row>): DataTableAlign {
  return column.num !== undefined ? 'right' : (column.align ?? 'left');
}

/** 표(화면시안_명세 §3): 머리 행 36px(surface-sunk), 행 40px, 셀 좌우 12px, 선택 행 accent-soft. */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  isRowSelected,
  empty = '표시할 항목이 없습니다.',
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: DataTableProps<Row>) {
  const hasWidths = columns.some((column) => column.width !== undefined);
  return (
    <div className={cx(styles.frame, className)}>
      <table className={styles.table} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {hasWidths ? (
          <colgroup>
            {columns.map((column) => (
              <col key={column.key} style={{ width: column.width }} />
            ))}
          </colgroup>
        ) : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(styles.th, columnAlign(column) === 'right' && styles.right)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={cx(styles.td, styles.empty)}>
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={isRowSelected?.(row) ? styles.selected : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cx(styles.td, columnAlign(column) === 'right' && styles.right)}
                  >
                    {column.num !== undefined ? (
                      <Num value={column.value(row)} unit={column.num} />
                    ) : (
                      column.cell(row, index)
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
