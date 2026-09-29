import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { Icon } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import styles from './Banner.module.css';

/** info 정보(accent-soft) · warning 경고(waiting-soft) · blocked 차단(failed-soft). 04-3 §3 Banner. */
export type BannerTone = 'info' | 'warning' | 'blocked';

const TONE_ICON: Record<BannerTone, IconName> = {
  info: 'info',
  warning: 'alert',
  blocked: 'alert',
};

/** 보드의 쓰임: 설명 안내는 note, 지금 상태 경고·차단은 status(Approval·Products·Settings 보드). */
const TONE_ROLE: Record<BannerTone, 'note' | 'status'> = {
  info: 'note',
  warning: 'status',
  blocked: 'status',
};

export interface BannerProps {
  tone: BannerTone;
  children: ReactNode;
  /** 기본 아이콘(info → 정보, warning·blocked → 경고 삼각형)을 바꿀 때. */
  icon?: IconName;
  /** 기본 역할을 바꿀 때(예: 방금 생긴 오류는 'alert'). */
  role?: 'note' | 'status' | 'alert';
  /** 오른쪽 버튼·링크 슬롯. */
  actions?: ReactNode;
  className?: string;
}

/** 안내 띠(화면시안_명세 §3): radius 8, 안쪽 12·16, 아이콘 20px + 글(ink). */
export function Banner({ tone, children, icon, role, actions, className }: BannerProps) {
  return (
    <div role={role ?? TONE_ROLE[tone]} className={cx(styles.banner, styles[tone], className)}>
      <span className={styles.icon}>
        <Icon name={icon ?? TONE_ICON[tone]} size={20} />
      </span>
      <div className={styles.body}>{children}</div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
