import type { GateCode, StepCode } from '@/shared/lib/steps';
import type { StepStatus } from '@/shared/ui';
import { groupStepStatus } from './stepDots';
import type { CandidateCreationPath, CandidateStepRailItem } from './types';

/**
 * SCR-12 단계 표 행(CandidateWork.dc.html '단계' 표). 열: 단계·상태·마지막 실행·입력 출처·버전·동작.
 * ⑥은 묶음 줄('실행' = ⑥-1 → ⑥-2 → ⑥-3, COPY + throughStepCode=NOTICE_HTML)과 펼침 하위 줄 ⑥-1~⑥-3이다.
 * 게이트 줄은 ③ 아래 G2, ⑦ 아래 G3, ⑧ 아래 G4(공통부품 §G와 같은 자리).
 */
export type StepTableRow =
  | { kind: 'step'; code: StepCode; no: string; label: string; source: string }
  | {
      kind: 'group';
      no: string;
      label: string;
      source: string;
      children: readonly { code: StepCode; no: string; label: string; source: string }[];
    }
  | { kind: 'gate'; gate: Extract<GateCode, 'G2' | 'G3' | 'G4'>; text: string };

/** ⑥ 묶음 하위 단계 */
export const CONTENT_GROUP_CODES: readonly StepCode[] = ['COPY', 'NOTICE_RAW', 'NOTICE_HTML'];

export const STEP_TABLE_ROWS: readonly StepTableRow[] = [
  { kind: 'step', code: 'SOURCING', no: '②', label: '소싱', source: '키워드 검색어' },
  { kind: 'step', code: 'PRICING', no: '③', label: '판정', source: '② 소싱 산출물' },
  {
    kind: 'gate',
    gate: 'G2',
    text: '판정(G2)을 통과해야 ④부터 연속 실행할 수 있습니다. 그 전에는 단계를 하나씩 실행합니다.',
  },
  { kind: 'step', code: 'CATEGORY', no: '④', label: '카테고리', source: '② 소싱 산출물' },
  { kind: 'step', code: 'THUMBNAIL', no: '⑤', label: '썸네일', source: '② 원본 이미지' },
  {
    kind: 'group',
    no: '⑥',
    label: '상세 콘텐츠',
    source: '② 소싱 산출물 외',
    children: [
      { code: 'COPY', no: '⑥-1', label: '카피', source: '② 상품명·설명' },
      { code: 'NOTICE_RAW', no: '⑥-2', label: '원산지·소재', source: '② 속성·선택 색상' },
      { code: 'NOTICE_HTML', no: '⑥-3', label: '고시·HTML', source: '⑥-1·⑥-2 · ③ 판매 사이즈' },
    ],
  },
  { kind: 'step', code: 'TAGS', no: '⑦', label: '태그', source: '키워드 · ② 산출물' },
  {
    kind: 'gate',
    gate: 'G3',
    text: '⑤에서 대표 썸네일을 고르면 통과합니다. 선택본·레퍼런스·기준 상품이 바뀌면 다시 골라야 합니다.',
  },
  { kind: 'step', code: 'UPLOAD', no: '⑧', label: '이미지 업로드', source: '⑤ 선택본 · ⑥-3' },
  {
    kind: 'gate',
    gate: 'G4',
    text: '필수 단계가 모두 끝나고 G2·G3을 통과하면 여정이 승인대기로 바뀝니다. 등록을 요청한 뒤에는 단계 실행과 값 수정이 잠깁니다.',
  },
  { kind: 'step', code: 'REGISTER', no: '⑨', label: '등록', source: '②~⑧ 현재 버전' },
];

/** 표에 나오는 단계 코드(흐름 순서, ⑥ 하위 포함) */
export const STEP_TABLE_CODES: readonly StepCode[] = STEP_TABLE_ROWS.flatMap((row) =>
  row.kind === 'step' ? [row.code] : row.kind === 'group' ? row.children.map((c) => c.code) : [],
);

/** ② 입력 출처 글: 생성 경로에 따라(키워드 검색어 · 검색어 · 라쿠텐 URL) */
export function sourcingSourceText(creationPath: CandidateCreationPath): string {
  switch (creationPath) {
    case 'KEYWORD':
      return '키워드 검색어';
    case 'SEARCH_QUERY':
      return '검색어';
    case 'RAKUTEN_URL':
      return '라쿠텐 URL';
    case 'DIRECT_INPUT':
      return '직접 입력';
  }
}

/**
 * 입력 출처 글(F-CW-11 '앞 단계 / 직접 입력'): 표의 기본 글 + 현재 버전이 오너 입력 시작 조건을 읽었으면 ' · 직접 입력'.
 */
export function inputSourceText(base: string, item: CandidateStepRailItem | undefined): string {
  const direct = item?.inputs.some(
    (input) =>
      input.isStartCondition &&
      input.sourceType === 'OWNER_INPUT' &&
      !input.inputKey.startsWith('candidate.'),
  );
  return direct ? `${base} · 직접 입력` : base;
}

/** 마지막 실행 시각(끝났으면 끝난 시각, 아니면 시작 시각). 없으면 null */
export function lastRunAt(item: CandidateStepRailItem | undefined): string | null {
  const run = item?.currentRun;
  if (!run) return null;
  return run.endedAt ?? run.startedAt;
}

/** 실행 버튼 글: 한 번도 안 돌았으면 '실행', 아니면 '다시 실행' */
export function runButtonLabel(status: StepStatus): string {
  return status === 'NOT_RUN' ? '실행' : '다시 실행';
}

/** ⑥ 묶음 상태(P1-04 규칙: 실패 > 재실행 필요 > 입력 대기 > 실행중 > 미실행 > 완료) */
export function contentGroupStatus(
  items: readonly (CandidateStepRailItem | undefined)[],
): StepStatus {
  return groupStepStatus(items.map((item) => item?.status ?? 'NOT_RUN'));
}

/** 묶음의 마지막 실행 시각(하위 단계 중 가장 늦은 것) */
export function groupLastRunAt(
  items: readonly (CandidateStepRailItem | undefined)[],
): string | null {
  const times = items.map(lastRunAt).filter((t): t is string => t !== null);
  if (times.length === 0) return null;
  return times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b));
}

/** 레일 칸을 단계 코드로 찾는 표 */
export function railByCode(
  items: readonly CandidateStepRailItem[] | undefined,
): Partial<Record<StepCode, CandidateStepRailItem>> {
  const map: Partial<Record<StepCode, CandidateStepRailItem>> = {};
  for (const item of items ?? []) map[item.stepCode] = item;
  return map;
}
