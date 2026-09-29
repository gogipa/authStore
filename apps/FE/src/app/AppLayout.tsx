import { Outlet } from 'react-router';
import { AppNav } from './AppNav';
import styles from './AppLayout.module.css';

/** 앱 틀: 왼쪽 내비 + 본문(공통부품_마크업.md §A). */
export function AppLayout() {
  return (
    <div className={styles.shell}>
      <AppNav />
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
