import type { ReactNode } from 'react';
import { GateBadge, Icon } from '@/shared/ui';
import type { CandidateGateView } from '../../model/gateViews';
import styles from './CandidateHeader.module.css';

export interface CandidateHeaderProps {
  /** 상품명(16px 600). 예: '아식스 젤카야노 14 · 크림/블랙'. */
  title: ReactNode;
  /** 이름 옆: 앵커 키 ID 칩, 성별·소싱 선택 등. */
  meta?: ReactNode;
  /** 게이트 표시(§D). 없으면 게이트 줄을 그리지 않는다. 값은 P1-05·P1-06이 넣는다. */
  gates?: readonly CandidateGateView[];
  /** 게이트 줄 옆 캡션(예: '라쿠텐 페이지 14:02 받음 · 20:02까지 유효'). */
  caption?: ReactNode;
  /**
   * 오른쪽 버튼 슬롯(04-3 §4의 2번). 단계 화면 틀은 '후보 목록'(공통부품 §F),
   * SCR-12 목록 화면은 '후보 제외'를 넣는다.
   */
  actions?: ReactNode;
}

/** 후보 머리(공통부품_마크업.md §F): 썸네일 자리 · 상품명 · 게이트 · 오른쪽 버튼. */
export function CandidateHeader({ title, meta, gates, caption, actions }: CandidateHeaderProps) {
  const hasSecondLine = (gates !== undefined && gates.length > 0) || caption !== undefined;
  return (
    <section aria-label="후보 정보" className={styles.header}>
      <div className={styles.thumb}>
        <Icon name="shoe" size={28} />
      </div>
      <div className={styles.text}>
        <div className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {meta}
        </div>
        {hasSecondLine ? (
          <div className={styles.gateRow}>
            {gates?.map((item) => (
              <GateBadge key={item.gate} gate={item.gate} state={item.state} />
            ))}
            {caption !== undefined ? <span className={styles.caption}>{caption}</span> : null}
          </div>
        ) : null}
      </div>
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
    </section>
  );
}
