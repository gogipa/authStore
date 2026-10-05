import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import { useStepGuideVisible } from '../../model/stepGuideVisible';
import styles from './NowMark.module.css';

export interface NowMarkProps {
  /** 지금 할 일이 이 자리에 있는가 */
  active: boolean;
  /** 표시 글('지금 여기') */
  label: string;
  /** 버튼처럼 줄 안에 놓는 자리면 true(기본은 한 줄을 다 차지하는 칸) */
  inline?: boolean;
  children: ReactNode;
}

/**
 * '지금 여기' 표시(D-36): 지금 할 일(`StepIntro`의 '지금 할 일')이 있는 자리를 accent 테두리와 작은 이름표로 짚는다.
 * 켜고 꺼도 안의 칸은 다시 만들어지지 않는다(입력 중인 값을 지키려고 늘 같은 껍데기를 둔다). 안이 비면 감춘다.
 * 이름표는 눈으로만 본다 — 화면 읽기 프로그램에는 '지금 할 일' 줄이 알린다.
 */
export function NowMark({ active, label, inline = false, children }: NowMarkProps) {
  // 체험에서만 표시한다(D-43). 껍데기는 늘 그려 안의 칸 상태를 지킨다
  const visible = useStepGuideVisible();
  const shown = active && visible;
  return (
    <div className={cx(styles.mark, inline && styles.inline, shown && styles.active)}>
      {shown ? (
        <span className={styles.chip} aria-hidden="true">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}
