import type { ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 'md' | 'sm';

interface StyleProps {
  /** primary는 한 화면에 하나만(디자인 시스템 README). 기본은 secondary. */
  variant?: ButtonVariant;
  /** md 36px(주요 버튼), sm 32px(표 안 버튼). */
  size?: ButtonSize;
}

function buttonClass({ variant = 'secondary', size = 'md' }: StyleProps, extra?: string) {
  return [styles.button, styles[variant], styles[size], extra].filter(Boolean).join(' ');
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & StyleProps;

/** 버튼(공통부품_마크업.md §I). 꺼진 버튼은 옆이나 아래에 꺼진 이유를 보이는 글로 함께 둔다. */
export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={buttonClass({ variant, size }, className)} {...rest} />;
}

export type ButtonLinkProps = LinkProps & StyleProps;

/** 버튼 모양의 화면 이동 링크. `<a>` 안에 button을 넣지 않고 링크 자체를 꾸민다. */
export function ButtonLink({ variant, size, className, ...rest }: ButtonLinkProps) {
  return <Link className={buttonClass({ variant, size }, className)} {...rest} />;
}
