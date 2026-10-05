import { Outlet } from 'react-router';
import { DemoBanner, StepGuideVisibleContext } from '@/features/guide';
import { useDemo } from '@/shared/lib/demo';
import { AppNav } from './AppNav';
import styles from './AppLayout.module.css';

/**
 * 앱 틀: 왼쪽 내비 + 본문(공통부품_마크업.md §A). 본문 맨 위에 체험 띠(D-31 — 체험 `/demo`에서만 그린다).
 * 단계 화면 안내 판과 '지금 여기' 표시도 체험에서만 그린다(D-43) — 그 여부를 `StepGuideVisibleContext`로 알린다.
 */
export function AppLayout() {
  const demo = useDemo();
  return (
    <div className={styles.shell}>
      <AppNav />
      <main className={styles.main}>
        <DemoBanner />
        <StepGuideVisibleContext.Provider value={demo !== null}>
          <Outlet />
        </StepGuideVisibleContext.Provider>
      </main>
    </div>
  );
}
