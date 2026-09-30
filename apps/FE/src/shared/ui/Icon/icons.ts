/**
 * 선 아이콘 경로 표(24 격자). 모양은 시안 보드의 인라인 SVG를 그대로 옮겼다.
 * 런타임에 아이콘 글꼴·CDN을 부르지 않는다(README 공통 규칙). 새 아이콘은 보드에 그린 뒤 여기에 더한다.
 */
export type IconShape =
  | { readonly tag: 'path'; readonly d: string }
  | {
      readonly tag: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx?: number;
    }
  | { readonly tag: 'circle'; readonly cx: number; readonly cy: number; readonly r: number };

const path = (d: string): IconShape => ({ tag: 'path', d });

export const ICONS = {
  // ── 공통부품 §A 왼쪽 내비 ──
  /** 대시보드 */
  grid: [
    { tag: 'rect', x: 3.5, y: 3.5, width: 7, height: 7, rx: 1 },
    { tag: 'rect', x: 13.5, y: 3.5, width: 7, height: 7, rx: 1 },
    { tag: 'rect', x: 3.5, y: 13.5, width: 7, height: 7, rx: 1 },
    { tag: 'rect', x: 13.5, y: 13.5, width: 7, height: 7, rx: 1 },
  ],
  /** 키워드 */
  search: [{ tag: 'circle', cx: 11, cy: 11, r: 6.5 }, path('M20 20l-4.3-4.3')],
  /** 후보 작업 */
  list: [path('M9 6h11M9 12h11M9 18h11'), path('M4 6h.01M4 12h.01M4 18h.01')],
  /** 등록 상품 */
  package: [
    path('M3.5 7.5L12 3.5l8.5 4-8.5 4-8.5-4z'),
    path('M3.5 7.5v9l8.5 4 8.5-4v-9'),
    path('M12 11.5v9'),
  ],
  /** 설정 */
  sliders: [
    path('M4 7h9M17 7h3M4 17h3M11 17h9'),
    { tag: 'circle', cx: 15, cy: 7, r: 2 },
    { tag: 'circle', cx: 9, cy: 17, r: 2 },
  ],
  /** 시스템 상태 */
  activity: [path('M3 12h4l3-7 4 14 3-7h4')],

  // ── 공통부품 §C 상태 칩 ──
  /** 완료 */
  check: [path('M5 12.5l4.5 4.5L19 7.5')],
  /** 실행중(원호) */
  progress: [path('M12 3a9 9 0 1 1-9 9')],
  /** 입력 대기(막대 두 개) */
  pause: [path('M9 5v14M15 5v14')],
  /** 재실행 필요(되돌림 화살표) */
  undo: [path('M4 5v5h5'), path('M5 15a7.5 7.5 0 1 0 1.2-7.4L4 10')],
  /** 실패·경고(느낌표 삼각형). 경고·차단 안내 띠도 쓴다 */
  alert: [path('M12 3.5l9.5 17h-19z'), path('M12 10v4.5M12 17.5v.5')],
  /** 미실행(빈 원) */
  circle: [{ tag: 'circle', cx: 12, cy: 12, r: 7.5 }],

  // ── 그 밖(AiEngine·Tags·CandidateWork 보드) ──
  /** 복사 */
  copy: [
    { tag: 'rect', x: 8.5, y: 8.5, width: 11, height: 11, rx: 2 },
    path('M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5'),
  ],
  /** 삭제(태그 삭제) */
  close: [path('M7 7l10 10M17 7L7 17')],
  /** 펼치기 */
  'chevron-down': [path('M6 9l6 6 6-6')],
  /** 접기 */
  'chevron-up': [path('M6 15l6-6 6 6')],
  /** 정보(안내 띠) */
  info: [{ tag: 'circle', cx: 12, cy: 12, r: 8.5 }, path('M12 11v5.5M12 7.5v.5')],
  /** 멈춤(AiEngine 보드 '다른 엔진으로 넘어가지 않고 멈춥니다' 안내 띠, P1-11) */
  'pause-circle': [{ tag: 'circle', cx: 12, cy: 12, r: 8.5 }, path('M9.5 9v6M14.5 9v6')],
  /** 다시 감지(AiEngine 보드 머리 보조 버튼, P1-11) */
  refresh: [path('M20 5v5h-5'), path('M19 15a7.5 7.5 0 1 1-1.2-7.4L20 10')],
  /** 이동(Settings 보드 'AI 엔진 설정' 링크) */
  'arrow-right': [path('M5 12h14M13 6l6 6-6 6')],
  /** 잠금(Settings 보드 '더할 수만 있고 뺄 수 없습니다' 안내 띠) */
  lock: [
    { tag: 'rect', x: 5, y: 10.5, width: 14, height: 10, rx: 2 },
    path('M8 10.5V7.5a4 4 0 0 1 8 0v3'),
  ],
  /** 새 창 링크(Sourcing 보드 비교표 '샵 A 상품을 라쿠텐에서 보기', P2-03) */
  external: [
    path('M14 4h6v6'),
    path('M20 4l-9 9'),
    path('M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'),
  ],
  /** 신발(후보 머리 썸네일 자리, 공통부품 §F) */
  shoe: [
    path('M3 16.5V13l3-1 3.5-4 2 .5 1 2.5 5 1.5c2 .6 3.5 1.8 3.5 3.5v.5H3z'),
    path('M3 16.5h18v1.5H3z'),
  ],
} as const satisfies Record<string, readonly IconShape[]>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
