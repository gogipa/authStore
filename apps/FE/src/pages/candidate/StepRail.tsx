import { Link } from 'react-router';
import {
  GATE_LABEL,
  STEP_RAIL,
  STEP_SCREEN,
  stepPath,
  type RailRow,
  type StepScreen,
} from '@/shared/lib/steps';
import styles from './StepRail.module.css';

interface StepRailProps {
  candidateId: string;
  currentScreen?: StepScreen;
}

/**
 * 단계 레일(공통부품_마크업.md §G). 행과 순서는 shared/lib/steps.ts의 STEP_RAIL에서 만든다.
 * 현재 화면을 맡는 첫 행에 aria-current="step"을 단다(판정 화면이면 ③, 콘텐츠면 ⑥, 최종 승인이면 ⑧).
 * 단계 상태 칩과 게이트 통과 여부는 후보 API를 붙이는 단계에서 넣는다.
 */
function rowScreen(row: RailRow): StepScreen | undefined {
  if (row.kind === 'gate') return undefined;
  return row.kind === 'group' ? row.screen : STEP_SCREEN[row.code];
}

export function StepRail({ candidateId, currentScreen }: StepRailProps) {
  const currentIndex = currentScreen
    ? STEP_RAIL.findIndex((row) => rowScreen(row) === currentScreen)
    : -1;

  return (
    <nav aria-label="단계" className={styles.rail}>
      {STEP_RAIL.map((row, index) => {
        if (row.kind === 'gate') {
          return (
            <div key={row.gate} className={styles.gate}>
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <rect
                  x="2"
                  y="2"
                  width="6"
                  height="6"
                  transform="rotate(45 5 5)"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              {row.gate} {GATE_LABEL[row.gate]}
            </div>
          );
        }

        const to =
          row.kind === 'group'
            ? `/candidates/${encodeURIComponent(candidateId)}/${row.screen}`
            : stepPath(candidateId, row.code);
        const current = index === currentIndex;
        const sub = row.kind === 'step' && row.sub;

        return (
          <Link
            key={row.kind === 'step' ? row.code : row.no}
            to={to}
            aria-current={current ? 'step' : undefined}
            className={[styles.row, sub ? styles.sub : null, current ? styles.current : null]
              .filter(Boolean)
              .join(' ')}
          >
            {sub ? null : <span className={styles.no}>{row.no}</span>}
            <span className={styles.label}>{sub ? `${row.no} ${row.label}` : row.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
