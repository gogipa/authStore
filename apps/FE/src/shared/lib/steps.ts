import type { components } from '@/shared/api/schema';

/**
 * 단계 코드(ERD §4.2, OpenAPI StepCode)와 화면 경로의 대응표.
 * 후보 작업 화면(/candidates/:candidateId/<화면>)의 단계 레일과 "현재 단계로 이동"이 이 표를 쓴다.
 */
export type StepCode = components['schemas']['StepCode'];

export const STEP_CODES = [
  'SOURCING',
  'PRICING',
  'CATEGORY',
  'THUMBNAIL',
  'COPY',
  'NOTICE_RAW',
  'NOTICE_HTML',
  'TAGS',
  'UPLOAD',
  'REGISTER',
] as const satisfies readonly StepCode[];

/** 단계 화면 경로 조각. 라우터의 자식 경로 이름과 같다. */
export type StepScreen = 'sourcing' | 'judgement' | 'thumbnail' | 'content' | 'tags' | 'approval';

export const STEP_SCREENS = [
  'sourcing',
  'judgement',
  'thumbnail',
  'content',
  'tags',
  'approval',
] as const satisfies readonly StepScreen[];

/** 단계 코드 → 화면. 한 화면이 여러 단계를 맡는다(③④ 판정, ⑥-1~⑥-3 콘텐츠, ⑧⑨ 최종 승인). */
export const STEP_SCREEN: Record<StepCode, StepScreen> = {
  SOURCING: 'sourcing',
  PRICING: 'judgement',
  CATEGORY: 'judgement',
  THUMBNAIL: 'thumbnail',
  COPY: 'content',
  NOTICE_RAW: 'content',
  NOTICE_HTML: 'content',
  TAGS: 'tags',
  UPLOAD: 'approval',
  REGISTER: 'approval',
};

/** 화면 안 위치(해시). 시안의 Judgement.dc.html#category를 따른다. */
const STEP_HASH: Partial<Record<StepCode, string>> = {
  CATEGORY: 'category',
};

export const DEFAULT_STEP: StepCode = 'SOURCING';

export type GateCode = 'G1' | 'G2' | 'G3' | 'G4' | 'G5';

export const GATE_LABEL: Record<GateCode, string> = {
  G1: '키워드 선택',
  G2: '판정 확정',
  G3: '썸네일 선택',
  G4: '최종 승인',
  G5: '전시 켜기',
};

/** 단계 레일 한 줄. 순서와 이름은 공통부품_마크업.md §G를 따른다. */
export type RailRow =
  | { kind: 'step'; code: StepCode; no: string; label: string; sub?: boolean }
  | { kind: 'group'; no: string; label: string; screen: StepScreen }
  | { kind: 'gate'; gate: GateCode };

export const STEP_RAIL: readonly RailRow[] = [
  { kind: 'step', code: 'SOURCING', no: '②', label: '소싱' },
  { kind: 'step', code: 'PRICING', no: '③', label: '판정' },
  { kind: 'gate', gate: 'G2' },
  { kind: 'step', code: 'CATEGORY', no: '④', label: '카테고리' },
  { kind: 'step', code: 'THUMBNAIL', no: '⑤', label: '썸네일' },
  { kind: 'group', no: '⑥', label: '상세 콘텐츠', screen: 'content' },
  { kind: 'step', code: 'COPY', no: '⑥-1', label: '카피', sub: true },
  { kind: 'step', code: 'NOTICE_RAW', no: '⑥-2', label: '원산지·소재', sub: true },
  { kind: 'step', code: 'NOTICE_HTML', no: '⑥-3', label: '고시·HTML', sub: true },
  { kind: 'step', code: 'TAGS', no: '⑦', label: '태그' },
  { kind: 'gate', gate: 'G3' },
  { kind: 'step', code: 'UPLOAD', no: '⑧', label: '이미지 업로드' },
  { kind: 'gate', gate: 'G4' },
  { kind: 'step', code: 'REGISTER', no: '⑨', label: '등록' },
];

export function isStepCode(value: unknown): value is StepCode {
  return typeof value === 'string' && (STEP_CODES as readonly string[]).includes(value);
}

export function isStepScreen(value: unknown): value is StepScreen {
  return typeof value === 'string' && (STEP_SCREENS as readonly string[]).includes(value);
}

/** 후보 안에서 단계 화면으로 가는 상대 경로(예: 'judgement#category'). */
export function stepRelativePath(code: StepCode): string {
  const hash = STEP_HASH[code];
  return hash ? `${STEP_SCREEN[code]}#${hash}` : STEP_SCREEN[code];
}

/** 단계 화면의 절대 경로(예: '/candidates/12/judgement#category'). */
export function stepPath(candidateId: string | number, code: StepCode): string {
  return `/candidates/${encodeURIComponent(String(candidateId))}/${stepRelativePath(code)}`;
}
