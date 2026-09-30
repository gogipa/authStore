import type { components } from '@/shared/api/schema';
import type { ChipTone, IconName } from '@/shared/ui';

export type CommerceMetaSyncTarget = components['schemas']['CommerceMetaSyncTarget'];
export type CommerceMetaSyncRun = components['schemas']['CommerceMetaSyncRun'];
export type CommerceMetaSyncTargetStatus = components['schemas']['CommerceMetaSyncTargetStatus'];
export type CommerceMetaSyncStatusList = components['schemas']['CommerceMetaSyncStatusList'];

/** 대상 8개(05-2 enum 순서) */
export const META_SYNC_TARGETS = [
  'CATEGORY',
  'CATEGORY_DETAIL',
  'STANDARD_OPTIONS',
  'PRODUCT_ATTRIBUTES',
  'ORIGIN_AREA',
  'ADDRESSBOOK',
  'PROVIDED_NOTICE',
  'RETURN_DELIVERY_COMPANY',
] as const satisfies readonly CommerceMetaSyncTarget[];

/** 대상별 이름(대상별 펼침에 쓴다) */
export const META_SYNC_TARGET_LABEL: Readonly<Record<CommerceMetaSyncTarget, string>> = {
  CATEGORY: '카테고리 목록',
  CATEGORY_DETAIL: '카테고리 상세',
  STANDARD_OPTIONS: '표준옵션',
  PRODUCT_ATTRIBUTES: '상품 속성',
  PROVIDED_NOTICE: '상품정보고시(신발)',
  ORIGIN_AREA: '원산지 코드',
  ADDRESSBOOK: '주소록',
  RETURN_DELIVERY_COMPANY: '반품 택배사',
};

/**
 * 패널 줄 묶기(Proposed P1-08, 화면시안_명세 §6 SCR-11). 보드는 3줄(카테고리·주소록·택배사)이고 대상은 8개라,
 * '카테고리' 줄에 카테고리 목록·상세·표준옵션·속성·고시·원산지 6개를 묶는다.
 */
export const META_SYNC_ROW_GROUPS = [
  {
    key: 'category',
    label: '카테고리',
    targets: [
      'CATEGORY',
      'CATEGORY_DETAIL',
      'STANDARD_OPTIONS',
      'PRODUCT_ATTRIBUTES',
      'PROVIDED_NOTICE',
      'ORIGIN_AREA',
    ],
  },
  { key: 'addressbook', label: '주소록', targets: ['ADDRESSBOOK'] },
  { key: 'returnDeliveryCompany', label: '택배사', targets: ['RETURN_DELIVERY_COMPANY'] },
] as const satisfies readonly {
  key: string;
  label: string;
  targets: readonly CommerceMetaSyncTarget[];
}[];

/** 줄 상태: 동기화 중 · 실패 · 받기 전(돈 적 없음) · 성공 */
export type MetaSyncState = 'running' | 'failed' | 'never' | 'succeeded';

/** '가장 나쁜 상태'의 순서(큰 것이 이긴다) */
const STATE_RANK: Readonly<Record<MetaSyncState, number>> = {
  succeeded: 0,
  never: 1,
  failed: 2,
  running: 3,
};

/** 상태 칩(성공=done, 실패=failed, 동기화 중=running, 받기 전=idle). 보드는 '성공'만 그렸다(나머지 글자는 Proposed) */
export const META_SYNC_STATE_CHIP: Readonly<
  Record<MetaSyncState, { tone: ChipTone; icon: IconName; label: string }>
> = {
  succeeded: { tone: 'done', icon: 'check', label: '성공' },
  failed: { tone: 'failed', icon: 'alert', label: '실패' },
  running: { tone: 'running', icon: 'progress', label: '동기화 중' },
  never: { tone: 'idle', icon: 'circle', label: '받기 전' },
};

export interface MetaSyncTargetView {
  target: CommerceMetaSyncTarget;
  label: string;
  state: MetaSyncState;
  /** 줄에 보일 시각(ISO): 성공 = 마지막 성공, 실패 = 끝난 시각, 동기화 중 = 시작 시각, 받기 전 = null */
  time: string | null;
  errorMessage: string | null;
}

export interface MetaSyncRowView {
  key: (typeof META_SYNC_ROW_GROUPS)[number]['key'];
  label: string;
  state: MetaSyncState;
  /** 성공 = 가장 오래된 성공 시각, 실패 = 가장 늦게 끝난 실패, 동기화 중 = 가장 이른 시작, 받기 전 = null */
  time: string | null;
  targets: MetaSyncTargetView[];
}

function stateOf(status: CommerceMetaSyncTargetStatus | undefined): MetaSyncState {
  const run = status?.latestRun;
  if (!run) return 'never';
  if (run.status === 'RUNNING') return 'running';
  if (run.status === 'FAILED') return 'failed';
  return 'succeeded';
}

function timeOf(status: CommerceMetaSyncTargetStatus | undefined, state: MetaSyncState) {
  const run = status?.latestRun;
  if (!run) return null;
  if (state === 'running') return run.startedAt;
  if (state === 'failed') return run.finishedAt;
  return status?.lastSucceededAt ?? run.finishedAt;
}

const byTime = (a: string, b: string) => new Date(a).getTime() - new Date(b).getTime();

/** 대상 하나의 화면 값 */
export function metaSyncTargetView(
  target: CommerceMetaSyncTarget,
  status: CommerceMetaSyncTargetStatus | undefined,
): MetaSyncTargetView {
  const state = stateOf(status);
  return {
    target,
    label: META_SYNC_TARGET_LABEL[target],
    state,
    time: timeOf(status, state),
    errorMessage: state === 'failed' ? (status?.latestRun?.errorMessage ?? null) : null,
  };
}

/** latest 응답 → 패널 줄 3개(묶은 대상의 가장 나쁜 상태와 그 상태의 시각) */
export function metaSyncRows(list: CommerceMetaSyncStatusList): MetaSyncRowView[] {
  const byTarget = new Map(list.items.map((item) => [item.target, item]));
  return META_SYNC_ROW_GROUPS.map((group) => {
    const targets = group.targets.map((t) => metaSyncTargetView(t, byTarget.get(t)));
    const state = targets.reduce<MetaSyncState>(
      (worst, t) => (STATE_RANK[t.state] > STATE_RANK[worst] ? t.state : worst),
      'succeeded',
    );
    const times = targets
      .filter((t) => t.state === state && t.time !== null)
      .map((t) => t.time as string)
      .sort(byTime);
    const time =
      state === 'never' || times.length === 0
        ? null
        : state === 'failed'
          ? times[times.length - 1]!
          : times[0]!;
    return { key: group.key, label: group.label, state, time, targets };
  });
}

/** 동기화 중인 대상이 있는지('지금 동기화'를 끈다) */
export function hasRunningMetaSync(list: CommerceMetaSyncStatusList | undefined): boolean {
  return !!list?.items.some((item) => item.latestRun?.status === 'RUNNING');
}

/** 캡션 '마지막 {HH:MM} 성공'의 시각: 대상들 가운데 가장 최근 성공(없으면 null) */
export function lastMetaSyncSuccess(list: CommerceMetaSyncStatusList | undefined): string | null {
  const times = (list?.items ?? [])
    .map((item) => item.lastSucceededAt)
    .filter((t): t is string => t !== null)
    .sort(byTime);
  return times.at(-1) ?? null;
}
