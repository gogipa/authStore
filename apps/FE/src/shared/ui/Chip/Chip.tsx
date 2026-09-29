import type { ReactNode } from 'react';
import { cx } from '@/shared/lib/cx';
import styles from './Chip.module.css';

/**
 * 칩 색 묶음(04-3 §3 Chip).
 * - outline: AI 생성 · 비교 안 함 · 수동
 * - neutral: 직접 입력 · 템플릿 제안 · 임시
 * - waiting: 재확인 필요 · 오래됨 · 저장 전
 * - accent: 사용 중 · 선택됨
 * - idle: 설치 안 됨
 * '템플릿 제안'·'임시'·'수동'의 tone은 보드에서 읽은 값이다(디자인 사전에는 없음, 오너 검토).
 */
export type ChipTone = 'outline' | 'neutral' | 'waiting' | 'accent' | 'idle';

export interface ChipProps {
  tone: ChipTone;
  children: ReactNode;
}

/** 단계 상태가 아닌 칩(공통부품 §C 아래쪽). 단계 상태는 StatusChip을 쓴다. */
export function Chip({ tone, children }: ChipProps) {
  return <span className={cx(styles.chip, styles[tone])}>{children}</span>;
}
