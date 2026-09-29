import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import styles from './AppNav.module.css';

interface NavItem {
  to: string;
  label: string;
  /** true면 경로가 정확히 같을 때만 현재 항목. '설정'은 하위 'AI 엔진'에서 현재 항목이 아니다. */
  end?: boolean;
  /** '설정' 아래 하위 항목(아이콘 없음). */
  sub?: boolean;
  icon?: ReactNode;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// 순서·라벨·아이콘은 docs/design/spec/공통부품_마크업.md §A 그대로다.
// 후보 작업(/candidates)은 end가 없어 단계 화면(/candidates/:id/...)에서도 현재 항목이다.
const NAV_ITEMS: readonly NavItem[] = [
  {
    to: '/',
    label: '대시보드',
    end: true,
    icon: (
      <Icon>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
      </Icon>
    ),
  },
  {
    to: '/keywords',
    label: '키워드',
    icon: (
      <Icon>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.3-4.3" />
      </Icon>
    ),
  },
  {
    to: '/candidates',
    label: '후보 작업',
    icon: (
      <Icon>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="M4 6h.01M4 12h.01M4 18h.01" />
      </Icon>
    ),
  },
  {
    to: '/products',
    label: '등록 상품',
    icon: (
      <Icon>
        <path d="M3.5 7.5L12 3.5l8.5 4-8.5 4-8.5-4z" />
        <path d="M3.5 7.5v9l8.5 4 8.5-4v-9" />
        <path d="M12 11.5v9" />
      </Icon>
    ),
  },
  {
    to: '/settings',
    label: '설정',
    end: true,
    icon: (
      <Icon>
        <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
        <circle cx="15" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </Icon>
    ),
  },
  { to: '/settings/ai-engine', label: 'AI 엔진', sub: true },
  {
    to: '/system',
    label: '시스템 상태',
    icon: (
      <Icon>
        <path d="M3 12h4l3-7 4 14 3-7h4" />
      </Icon>
    ),
  },
];

/** 왼쪽 주 메뉴. NavLink가 현재 항목에 aria-current="page"를 단다. */
export function AppNav() {
  return (
    <nav aria-label="주 메뉴" className={styles.nav}>
      <div className={styles.brand}>
        <span className={styles.appName}>신발 자동등록</span>
        <span className={styles.caption}>로컬 · 오너</span>
      </div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            [styles.item, item.sub ? styles.sub : null, isActive ? styles.active : null]
              .filter(Boolean)
              .join(' ')
          }
        >
          {item.icon}
          {item.label}
        </NavLink>
      ))}
      {/* 안전장치 상태 상자: 설정·시스템 API를 붙이는 단계에서 실제 값으로 바꾼다. */}
      <div className={styles.statusBox}>
        <span className={styles.statusChip}>등록 API 차단 · 확인 전</span>
        <span className={styles.caption}>
          오늘 페이지 조회 <span className={styles.mono}>—</span>
        </span>
      </div>
    </nav>
  );
}
