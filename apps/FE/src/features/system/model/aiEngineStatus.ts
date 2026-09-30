import type { components } from '@/shared/api/schema';
import { EMPTY_VALUE } from '@/shared/lib/format';
import type { ChipTone, IconName } from '@/shared/ui';

export type AiEngineCode = components['schemas']['AiEngineCode'];
export type AiCliCheck = components['schemas']['AiCliCheck'];
export type AiCliCheckLatestItem = components['schemas']['AiCliCheckLatestItem'];
export type AiCliCheckLatestList = components['schemas']['AiCliCheckLatestList'];
export type AiCliCheckRequest = components['schemas']['AiCliCheckRequest'];
export type AiCliCheckAccepted = components['schemas']['AiCliCheckAccepted'];
export type AiCliCheckPage = components['schemas']['AiCliCheckPage'];
export type AiCliCheckTrigger = AiCliCheck['trigger'];

/** 엔진 표시 순서(05-2 AiCliCheckLatestList) */
export const AI_ENGINE_ORDER: readonly AiEngineCode[] = ['CLAUDE', 'AGY', 'CODEX'];

/** 첫 실행 추천 순서(F-SY-23, PRD §8.9 R4) */
export const AI_ENGINE_RECOMMEND_ORDER: readonly AiEngineCode[] = ['CLAUDE', 'CODEX', 'AGY'];

/**
 * 점검 이력을 한 번에 읽는 수(= 페이지 크기 최대). AI 엔진 페이지 이력 표([전체 이력])와 카드·시스템 상태의
 * '마지막 연결 테스트'가 같은 목록을 나눠 쓴다(Proposed).
 */
export const AI_CLI_HISTORY_SIZE = 100;

/** 저장 조건 창(R8). 화면은 버튼 상태 표시에만 쓰고 최종 판정은 BE(409 AI_ENGINE_NOT_VERIFIED)가 한다 */
export const AI_ENGINE_VERIFY_WINDOW_MS = 10 * 60 * 1000;

/** 계기 코드 → 한국어(AiEngine 보드 '최근 점검 이력' 계기 열) */
export const AI_CLI_CHECK_TRIGGER_LABEL: Readonly<Record<AiCliCheckTrigger, string>> = {
  STARTUP: '앱 시작',
  MANUAL: '직접 누름',
  BEFORE_SAVE: '저장 전',
  FIRST_RUN: '첫 실행',
};

/** 로그인 확인 명령(R6). agy는 확인 명령이 없다 */
export const AI_AUTH_COMMAND: Readonly<Partial<Record<AiEngineCode, string>>> = {
  CLAUDE: 'claude auth status',
  CODEX: 'codex login status',
};

const time = (row: Pick<AiCliCheck, 'checkedAt'>) => new Date(row.checkedAt).getTime();

/** a가 b보다 최신인가(checked_at, 같으면 id — BE 최신 행 규칙과 같다) */
function isNewer(a: AiCliCheck, b: AiCliCheck): boolean {
  const d = time(a) - time(b);
  return d !== 0 ? d > 0 : a.id > b.id;
}

function newest(rows: readonly AiCliCheck[]): AiCliCheck | null {
  let best: AiCliCheck | null = null;
  for (const row of rows) if (!best || isNewer(row, best)) best = row;
  return best;
}

/**
 * 10분 안에 그 엔진·텍스트 모델로 통과한 연결 테스트가 있는가(R8, 규칙 4 — 화면 표시용).
 * `checks`에는 최신 행·이력 행을 섞어 넣어도 된다(같은 행이 겹쳐도 괜찮다).
 */
export function hasRecentPass(
  checks: readonly (AiCliCheck | null | undefined)[],
  engine: AiEngineCode,
  model: string | null,
  now: number | Date,
): boolean {
  if (!model) return false;
  const since = (typeof now === 'number' ? now : now.getTime()) - AI_ENGINE_VERIFY_WINDOW_MS;
  return checks.some(
    (row) =>
      row != null &&
      row.engineCode === engine &&
      row.smokeStatus === 'PASSED' &&
      row.model === model &&
      time(row) >= since,
  );
}

/** 엔진 하나의 점검 모습(카드·시스템 상태가 같이 쓴다) */
export interface AiEngineCheckView {
  engineCode: AiEngineCode;
  /** 설정의 선택 엔진인지(저장된 값) */
  selected: boolean;
  /** 최신 행(감지만 한 행 포함). 점검한 적 없으면 null */
  latest: AiCliCheck | null;
  /** 마지막 연결 테스트(SKIPPED가 아닌 가장 최근 행). 감지 행 뒤에 가려진 결과를 이력에서 찾는다 */
  lastSmoke: AiCliCheck | null;
}

/** 최신 목록 + 이력 → 엔진 3개 모습(CLAUDE·AGY·CODEX 순서) */
export function engineCheckViews(
  latest: AiCliCheckLatestList | undefined,
  history: readonly AiCliCheck[] = [],
): AiEngineCheckView[] {
  return AI_ENGINE_ORDER.map((engineCode) => {
    const item = latest?.items.find((i) => i.engineCode === engineCode);
    const row = item?.latest ?? null;
    const rows = [...(row ? [row] : []), ...history].filter((r) => r.engineCode === engineCode);
    return {
      engineCode,
      selected: item?.selected ?? latest?.selectedEngine === engineCode,
      latest: newest(rows) ?? row,
      lastSmoke: newest(rows.filter((r) => r.smokeStatus !== 'SKIPPED')),
    };
  });
}

/**
 * 첫 실행 추천(F-SY-23, 규칙 14): 설치됐고 마지막 연결 테스트가 PASSED인 엔진 가운데 CLAUDE → CODEX → AGY 순서의 첫 번째.
 * 없으면 null. 있는 기록으로만 계산한다(추천하려고 연결 테스트를 부르지 않는다, R7).
 */
export function recommendEngine(views: readonly AiEngineCheckView[]): AiEngineCode | null {
  for (const code of AI_ENGINE_RECOMMEND_ORDER) {
    const view = views.find((v) => v.engineCode === code);
    if (view?.latest?.installed && view.lastSmoke?.smokeStatus === 'PASSED') return code;
  }
  return null;
}

/** 칩 하나(글자·색·아이콘 — 색만으로 상태를 알리지 않는다) */
export interface StatusChipView {
  tone: ChipTone;
  icon?: IconName;
  label: string;
}

const NOT_CHECKED: StatusChipView = { tone: 'idle', icon: 'circle', label: '감지 전' };

/** 설치 칩 */
export function installChip(latest: AiCliCheck | null): StatusChipView {
  if (!latest) return NOT_CHECKED;
  return latest.installed
    ? { tone: 'done', icon: 'check', label: '설치됨' }
    : { tone: 'idle', icon: 'circle', label: '설치 안 됨' };
}

/** 지원 버전 범위(P-13). 범위가 정해지지 않았으면 '지원 범위 미정'(Proposed) */
export function versionSupportText(supported: boolean | null | undefined): string {
  if (supported === true) return '지원 범위 안';
  if (supported === false) return '지원 범위 밖';
  return '지원 범위 미정';
}

/** 로그인 칩과 옆 글. `noteIsCommand`면 옆 글이 확인 명령(mono)이다 */
export interface AuthStatusViewResult {
  chip: StatusChipView;
  note: string;
  noteIsCommand: boolean;
}

/** 로그인 칩과 옆 글(확인 명령·안내, R6 — agy는 확인 명령이 없어 '연결 테스트로 확인') */
export function authStatusView(view: AiEngineCheckView): AuthStatusViewResult {
  const command = AI_AUTH_COMMAND[view.engineCode] ?? '';
  const withCommand = (chip: StatusChipView): AuthStatusViewResult => ({
    chip,
    note: command,
    noteIsCommand: command !== '',
  });
  const latest = view.latest;
  if (!latest) return { chip: NOT_CHECKED, note: '', noteIsCommand: false };
  if (latest.authStatus === 'OK') {
    return withCommand({ tone: 'done', icon: 'check', label: '로그인됨' });
  }
  if (latest.authStatus === 'NOT_LOGGED_IN') {
    return withCommand({ tone: 'failed', icon: 'alert', label: '로그인 필요' });
  }
  if (view.engineCode === 'AGY') {
    return view.lastSmoke?.smokeStatus === 'PASSED'
      ? {
          chip: { tone: 'done', icon: 'check', label: '로그인됨' },
          note: '연결 테스트로 확인함',
          noteIsCommand: false,
        }
      : {
          chip: { tone: 'neutral', label: '연결 테스트로 확인' },
          note: '확인 명령이 없습니다',
          noteIsCommand: false,
        };
  }
  return withCommand({ tone: 'neutral', label: '확인하지 못함' });
}

/** 연결 테스트 칩(마지막 연결 테스트) */
export function smokeChip(lastSmoke: AiCliCheck | null | undefined): StatusChipView {
  if (lastSmoke?.smokeStatus === 'PASSED') return { tone: 'done', icon: 'check', label: '통과' };
  if (lastSmoke?.smokeStatus === 'FAILED') return { tone: 'failed', icon: 'alert', label: '실패' };
  return { tone: 'idle', icon: 'circle', label: '테스트 안 함' };
}

/** 걸린 시간(초, 소수 한 자리): 12700 → '12.7초'. 없으면 '—' */
export function formatLatency(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return EMPTY_VALUE;
  return `${(Math.round(ms / 100) / 10).toFixed(1)}초`;
}

/** 시스템 상태 'AI 도구 상태' 줄의 칩(Proposed: 보드의 정상·테스트 안 함·설치 안 됨 + 실패·로그인 필요·점검 전) */
export function engineHealthChip(view: AiEngineCheckView): StatusChipView {
  const latest = view.latest;
  if (!latest) return { tone: 'idle', icon: 'circle', label: '점검 전' };
  if (!latest.installed) return { tone: 'idle', icon: 'circle', label: '설치 안 됨' };
  if (latest.authStatus === 'NOT_LOGGED_IN') {
    return { tone: 'failed', icon: 'alert', label: '로그인 필요' };
  }
  if (view.lastSmoke?.smokeStatus === 'FAILED') {
    return { tone: 'failed', icon: 'alert', label: '실패' };
  }
  if (view.lastSmoke?.smokeStatus === 'PASSED')
    return { tone: 'done', icon: 'check', label: '정상' };
  return { tone: 'idle', icon: 'circle', label: '테스트 안 함' };
}

/** 마지막 감지 시각(엔진 3개 최신 행 가운데 가장 늦은 것). 없으면 null */
export function lastCheckedAt(latest: AiCliCheckLatestList | undefined): string | null {
  const rows = (latest?.items ?? [])
    .map((i) => i.latest)
    .filter((r): r is AiCliCheck => r !== null);
  return newest(rows)?.checkedAt ?? null;
}

/** 첫 실행 'AI 엔진 고르기' 상태(F-SY-23, Proposed — 확정 기록 자리가 M1에 없어 선택 엔진의 마지막 연결 테스트로 판단) */
export type FirstRunAiEngineState =
  | { done: true; engine: AiEngineCode; model: string; at: string }
  | { done: false; recommended: AiEngineCode | null };

export function firstRunAiEngineState(views: readonly AiEngineCheckView[]): FirstRunAiEngineState {
  const selected = views.find((v) => v.selected);
  const smoke = selected?.lastSmoke;
  if (selected && smoke?.smokeStatus === 'PASSED' && smoke.model) {
    return { done: true, engine: selected.engineCode, model: smoke.model, at: smoke.checkedAt };
  }
  return { done: false, recommended: recommendEngine(views) };
}
