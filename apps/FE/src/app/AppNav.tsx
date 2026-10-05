import { NavLink } from 'react-router';
import { findCallUsage, formatUsageCount, useCallUsageQuery } from '@/features/integrations';
import { navSwitchText, useRegistrationSwitch } from '@/features/registration';
import { APP_NAME } from '@/shared/lib/appName';
import { cx } from '@/shared/lib/cx';
import { EMPTY_VALUE } from '@/shared/lib/format';
import { Icon, type IconName } from '@/shared/ui';
import styles from './AppNav.module.css';

interface NavItem {
  to: string;
  label: string;
  /** true면 경로가 정확히 같을 때만 현재 항목. '설정'은 하위 'AI 엔진'에서 현재 항목이 아니다. */
  end?: boolean;
  /** '설정' 아래 하위 항목(아이콘 없음). */
  sub?: boolean;
  icon?: IconName;
}

// 순서·라벨·아이콘은 docs/design/spec/공통부품_마크업.md §A 그대로다(아이콘 모양은 shared/ui/Icon/icons.ts).
// 맨 아래 '사용 안내'는 D-29로 더했다(화면시안_명세 §8).
// 여정(/candidates)은 end가 없어 단계 화면(/candidates/:id/...)에서도 현재 항목이다.
const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: '대시보드', end: true, icon: 'grid' },
  { to: '/keywords', label: '키워드', icon: 'search' },
  { to: '/candidates', label: '여정', icon: 'list' },
  { to: '/products', label: '등록 상품', icon: 'package' },
  { to: '/settings', label: '설정', end: true, icon: 'sliders' },
  { to: '/settings/ai-engine', label: 'AI 엔진', sub: true },
  { to: '/system', label: '시스템 상태', icon: 'activity' },
  // D-29: 맨 아래 '사용 안내'(SCR-14). 보드에 없는 항목이라 화면시안_명세 §8에 적었다
  { to: '/guide', label: '사용 안내', icon: 'help' },
];

/**
 * '오늘 페이지 조회 38/110'(공통부품 §A 글자 그대로). RAKUTEN_PAGE 항목의 count/dailyLimit이다.
 * 받는 중이거나 조회에 실패하면 빈 값 표시 '—'(Proposed, P1-02 규칙 12).
 * SSE `call-usage.changed`가 오면 쿼리가 무효화되어 다시 읽는다.
 */
function PageFetchUsage() {
  const { data, isError } = useCallUsageQuery();
  const usage = isError ? undefined : findCallUsage(data, 'RAKUTEN_PAGE');
  return (
    <span className={styles.caption}>
      오늘 페이지 조회{' '}
      <span className={styles.mono}>{usage ? formatUsageCount(usage) : EMPTY_VALUE}</span>
    </span>
  );
}

/**
 * '등록 API 차단 켜짐 · 드라이런'(공통부품 §A·Approval 보드 상태 상자, P4-03). `getRegistrationSwitch`의 값이고 SSE
 * `registration-switch.changed`가 다시 읽힌다. 켜짐이면 경고 색(waiting), 꺼짐이면 실행 색(accent — Proposed), 받는 중·실패면 '확인 전'.
 */
function RegistrationSwitchChip() {
  const { data, isError } = useRegistrationSwitch();
  const state = isError ? undefined : data;
  return (
    <span
      className={cx(
        styles.statusChip,
        state?.apiBlocked === true && styles.blocked,
        state?.apiBlocked === false && styles.live,
      )}
      data-api-blocked={state ? String(state.apiBlocked) : undefined}
    >
      {navSwitchText(state)}
    </span>
  );
}

/** 왼쪽 주 메뉴. NavLink가 현재 항목에 aria-current="page"를 단다. */
export function AppNav() {
  return (
    <nav aria-label="주 메뉴" className={styles.nav}>
      <div className={styles.brand}>
        <span className={styles.appName}>{APP_NAME}</span>
        <span className={styles.caption}>로컬 · 오너</span>
      </div>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cx(styles.item, item.sub && styles.sub, isActive && styles.active)
          }
        >
          {item.icon ? <Icon name={item.icon} size={18} /> : null}
          {item.label}
        </NavLink>
      ))}
      {/* 안전장치 상태 상자: 등록 API 차단(P4-03 getRegistrationSwitch) · 오늘 페이지 조회 */}
      <div className={styles.statusBox}>
        <RegistrationSwitchChip />
        <PageFetchUsage />
      </div>
    </nav>
  );
}
