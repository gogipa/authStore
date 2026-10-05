import type { components } from '@/shared/api/schema';
import { formatKstMonthDayTime, formatKstTime, formatKstTimeOrDate } from '@/shared/lib/format';

export type KeywordSnapshot = components['schemas']['KeywordSnapshot'];
export type KeywordSnapshotDetail = components['schemas']['KeywordSnapshotDetail'];
export type KeywordSnapshotPage = components['schemas']['KeywordSnapshotPage'];
export type KeywordSnapshotCreateRequest = components['schemas']['KeywordSnapshotCreateRequest'];
export type KeywordCollectionAccepted = components['schemas']['KeywordCollectionAccepted'];
export type RankedKeyword = components['schemas']['RankedKeyword'];
export type RankedKeywordPage = components['schemas']['RankedKeywordPage'];
export type KeywordCollectionStatus = components['schemas']['KeywordCollectionStatus'];
export type ChildKeywordTerm = components['schemas']['ChildKeywordTerm'];
export type ChildKeywordTermList = components['schemas']['ChildKeywordTermList'];
export type ChildKeywordTermCreated = components['schemas']['ChildKeywordTermCreated'];
export type KeywordCollectionProgressEvent =
  components['schemas']['KeywordCollectionProgressEvent'];
export type KeywordCollectionCompletedEvent =
  components['schemas']['KeywordCollectionCompletedEvent'];
export type KeywordCollectionAbortedEvent = components['schemas']['KeywordCollectionAbortedEvent'];
export type KeywordAbortReason = KeywordCollectionAbortedEvent['abortReason'];
export type RankLimit = 100 | 500;

/** 데이터랩 cid(PRD §8.1): 여성신발 50000173 · 남성신발 50000174. 버튼 수집 순서도 이대로다 */
export const DATALAB_CIDS = ['50000173', '50000174'] as const;
export type DatalabCid = (typeof DATALAB_CIDS)[number];

export const DATALAB_CID_LABEL: Readonly<Record<string, string>> = {
  '50000173': '여성신발',
  '50000174': '남성신발',
};

/** cid 화면 이름. 붙여넣기에서 '모름'(null)이면 '분야 모름' */
export function cidLabel(cid: string | null | undefined): string {
  if (cid == null) return '분야 모름';
  return DATALAB_CID_LABEL[cid] ?? cid;
}

/** 수집 범위 → cid당 페이지(한 페이지 20개, PRD §8.1). 서버 설정이 다르면 진행 알림의 pagesPerCid가 맞다 */
export function pagesPerCidFor(rankLimit: RankLimit): number {
  return rankLimit / 20;
}

/** '구조 변경 의심' 사유(05-2 structureChangeSuspected) */
export const STRUCTURE_CHANGE_REASONS: readonly string[] = [
  'NO_RANKS_KEY',
  'HTTP_404',
  'NOT_JSON',
  'RETURN_CODE',
  'COUNT_MISMATCH',
];

/** 중단 사유 짧은 이름(수집 상태 줄·경고 띠, Proposed) */
export const ABORT_REASON_LABEL: Readonly<Record<string, string>> = {
  NO_RANKS_KEY: '순위 목록 없음',
  HTTP_404: '주소 없음(404)',
  NOT_JSON: '응답 형식 다름',
  RETURN_CODE: '오류 응답',
  COUNT_MISMATCH: '건수·순위 불일치',
  HTTP_403: '요청 거절(403)',
  HTTP_418: '요청 거절(418)',
  HTTP_429: '요청 과다(429)',
  NETWORK_ERROR: '응답 없음',
  APP_RESTART: '앱 재시작',
  INTERRUPTED: '도중에 멈춤',
};

export function abortReasonLabel(reason: string | null | undefined): string {
  if (!reason) return '';
  return ABORT_REASON_LABEL[reason] ?? reason;
}

export function isStructureChangeReason(reason: string | null | undefined): boolean {
  return STRUCTURE_CHANGE_REASONS.includes(reason ?? '');
}

/**
 * 중단 경고 문구(Proposed — 시안에 없음). 구조 변경 의심은 '데이터랩 구조 변경 의심'으로 시작한다(F-KW-04).
 * 403·418·429는 쉼이 끝나는 시각을 붙인다.
 */
export function abortMessage(
  reason: string | null | undefined,
  blockedUntil?: string | null,
): string {
  const label = abortReasonLabel(reason);
  if (isStructureChangeReason(reason)) {
    return `데이터랩 구조 변경 의심: 응답 모양이 예상과 달라 수집을 멈췄습니다(${label}). 데이터랩 화면에서 순위를 복사해 붙여 넣어 주세요.`;
  }
  if (reason === 'HTTP_403' || reason === 'HTTP_418' || reason === 'HTTP_429') {
    const until = blockedUntil ? ` ${formatKstMonthDayTime(blockedUntil)}까지 쉽니다.` : '';
    return `데이터랩이 요청을 막아 수집을 멈췄습니다(${label}).${until} 그동안은 순위 붙여넣기를 써 주세요.`;
  }
  if (reason === 'NETWORK_ERROR') {
    return '데이터랩 응답을 받지 못해 수집을 멈췄습니다. 잠시 뒤 다시 수집하거나 순위를 붙여 넣어 주세요.';
  }
  if (reason === 'APP_RESTART') {
    return '앱이 다시 시작되어 수집이 중단되었습니다. 다시 수집하거나 순위를 붙여 넣어 주세요.';
  }
  return '수집이 도중에 멈췄습니다. 다시 수집하거나 순위를 붙여 넣어 주세요.';
}

/**
 * '데이터랩 수집' 머리 오른쪽 줄(보드: '마지막 수집 13:30 · 출처 데이터랩 · 2초 간격 · 이상 없음').
 * 마지막 버튼 수집이 없으면 '아직 수집하지 않았습니다', 중단이면 '중단: {사유}'(Proposed).
 */
export function collectionStatusLine(
  status: KeywordCollectionStatus,
  now: Date = new Date(),
): string {
  const interval = `${status.requestIntervalSeconds}초 간격`;
  if (status.collecting) return `수집 중 · 출처 데이터랩 · ${interval}`;
  if (!status.lastCollectedAt) return `아직 수집하지 않았습니다 · 출처 데이터랩 · ${interval}`;
  const result =
    status.lastStatus === 'ABORTED'
      ? `중단: ${abortReasonLabel(status.lastAbortReason)}`
      : '이상 없음';
  // 오늘이 아니면 날짜를 붙인다 — 며칠 전 수집이 방금 것처럼 보이지 않게(Proposed)
  return `마지막 수집 ${formatKstTimeOrDate(status.lastCollectedAt, now)} · 출처 데이터랩 · ${interval} · ${result}`;
}

/** 표가 보이는 묶음의 출처 줄 — 칩 이름표(`label`)와 옆 글(`detail`) */
export interface SnapshotOrigin {
  label: string;
  detail: string;
  tone: 'accent' | 'outline' | 'running' | 'waiting';
}

/**
 * 키워드 표가 '방금 새로 받은 순위'인지 '지난번에 받아 둔 순위'인지 알리는 줄(Proposed). 화면을 열면 가장 최근 묶음을 먼저 보이므로
 * 수집을 누르기 전의 표는 늘 저장해 둔 것이다 — `fresh`는 이 화면에서 방금 [수집]·붙여넣기로 만든 묶음일 때만 true.
 * 시각은 오늘이면 '오늘 11:10', 다른 날이면 '10-03 21:16'. `now`는 테스트용.
 */
export function snapshotOrigin(
  snapshot: Pick<KeywordSnapshot, 'collectedAt' | 'method' | 'status'>,
  fresh: boolean,
  now: Date = new Date(),
): SnapshotOrigin {
  const sameDay =
    formatKstMonthDayTime(snapshot.collectedAt).slice(0, 5) ===
    formatKstMonthDayTime(now).slice(0, 5);
  const when = sameDay
    ? `오늘 ${formatKstTime(snapshot.collectedAt)}`
    : formatKstMonthDayTime(snapshot.collectedAt);
  const pasted = snapshot.method === 'PASTE';
  const how = pasted ? '붙여넣음' : '데이터랩에서 받음';
  if (snapshot.status === 'RUNNING') {
    return {
      label: '지금 받는 중',
      detail: `${when}에 시작 · 끝나면 순위가 채워집니다`,
      tone: 'running',
    };
  }
  if (snapshot.status === 'ABORTED') {
    return {
      label: '중간에 멈춘 수집',
      detail: `${when}에 시작 · 받은 만큼만 보입니다`,
      tone: 'waiting',
    };
  }
  if (fresh) {
    return {
      label: pasted ? '방금 붙여넣은 순위' : '방금 새로 받은 순위',
      detail: `${when}에 ${how}`,
      tone: 'accent',
    };
  }
  return {
    label: pasted ? '지난번에 붙여넣은 순위' : '지난번에 받아 둔 순위',
    detail: `${when}에 ${how} · 새 순위가 필요하면 위 [수집]을 누르세요`,
    tone: 'outline',
  };
}

/** '수집' 버튼이 꺼진 이유 글(05-2 disabledReasonCode). 쉼이면 끝나는 시각을 보인다 */
export function collectDisabledReason(status: KeywordCollectionStatus): string | null {
  if (status.disabledReasonCode === 'ALREADY_IN_PROGRESS') {
    return '수집 중입니다. 끝나면 다시 누를 수 있습니다.';
  }
  if (status.disabledReasonCode === 'EXTERNAL_CALL_COOLDOWN') {
    const until = status.blockedUntil ? formatKstMonthDayTime(status.blockedUntil) : '';
    return `데이터랩이 요청을 막아 ${until}까지 쉽니다. 그동안은 순위 붙여넣기를 써 주세요.`;
  }
  return null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * 이번에 수집할 기간(서버 규칙과 같다 — BE keywords/collection-period.ts, F-KW-03): 종료일 = 어제(KST),
 * 시작일 = 종료일의 달력 기준 1개월 전(없는 날은 그 달 마지막 날). 화면의 읽기 전용 '기간' 칸에 보인다.
 */
export function expectedCollectionPeriod(now: Date): { startDate: string; endDate: string } {
  const endDate = new Date(now.getTime() - DAY_MS + KST_OFFSET_MS).toISOString().slice(0, 10);
  const [y, m, d] = endDate.split('-').map(Number) as [number, number, number];
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { startDate: `${year}-${pad2(month)}-${pad2(Math.min(d, lastDay))}`, endDate };
}
