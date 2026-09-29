import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconSize } from '../Icon/Icon';
import type { IconName } from '../Icon/icons';
import styles from './IconButton.module.css';

export type IconButtonSize = 'md' | 'sm';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'aria-label'
> {
  icon: IconName;
  /** 필수: 아이콘만 있는 버튼은 이름이 없으면 화면 읽기 프로그램이 읽을 수 없다(화면시안_명세 §1). */
  'aria-label': string;
  /** md 28px(명령 복사) · sm 24px(태그 삭제). */
  size?: IconButtonSize;
}

const ICON_SIZE: Record<IconButtonSize, IconSize> = { md: 16, sm: 14 };

/** 아이콘만 있는 버튼(복사·태그 삭제·펼치기). */
export function IconButton({
  icon,
  size = 'md',
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={[styles.button, styles[size], className].filter(Boolean).join(' ')}
      {...rest}
    >
      <Icon name={icon} size={ICON_SIZE[size]} />
    </button>
  );
}
