import { ICONS, type IconName, type IconShape } from './icons';
import styles from './Icon.module.css';

/** 시안에 쓰인 크기(px). 12 칩 · 14 태그 삭제·펼침 · 16 기본 · 18 내비 · 20 안내 띠 · 28 여정 머리 */
export type IconSize = 12 | 14 | 16 | 18 | 20 | 28;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  /** 선 두께. 기본 1.5(디자인 README). 상태 칩 아이콘만 2.5(공통부품 §C). */
  strokeWidth?: 1.5 | 2.5;
  className?: string;
}

function renderShape(shape: IconShape, key: number) {
  switch (shape.tag) {
    case 'path':
      return <path key={key} d={shape.d} />;
    case 'rect':
      return (
        <rect
          key={key}
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
        />
      );
    case 'circle':
      return <circle key={key} cx={shape.cx} cy={shape.cy} r={shape.r} />;
  }
}

/**
 * 선 아이콘(인라인 SVG, 24 격자, currentColor). 늘 장식이다(aria-hidden).
 * 뜻을 전해야 하면 옆에 보이는 글을 두거나 IconButton의 aria-label을 쓴다.
 */
export function Icon({ name, size = 16, strokeWidth = 1.5, className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
      className={[styles.icon, className].filter(Boolean).join(' ')}
    >
      {ICONS[name].map(renderShape)}
    </svg>
  );
}
