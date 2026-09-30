/**
 * ① 키워드 상수(PRD §8.1, ERD §3.2 keyword_snapshot·keyword CHECK, 05-2 keywords).
 */

/** 데이터랩 cid: 여성신발 50000173 · 남성신발 50000174(PRD §8.1). 버튼 수집 기본 순서도 이대로다 */
export const DATALAB_CID = { WOMEN: '50000173', MEN: '50000174' } as const;

/** cid 화면 이름(여성신발·남성신발) */
export const DATALAB_CID_LABEL: Readonly<Record<string, string>> = {
  [DATALAB_CID.WOMEN]: '여성신발',
  [DATALAB_CID.MEN]: '남성신발',
};

/** 붙여넣기에서 고를 수 있는 cid(05-2 KeywordPasteRequest). null = 모름 */
export const PASTE_CIDS = [DATALAB_CID.WOMEN, DATALAB_CID.MEN] as const;

/** 수집 방식(ck_kws_method) */
export const KEYWORD_SNAPSHOT_METHODS = ['BUTTON', 'PASTE'] as const;
export type KeywordSnapshotMethod = (typeof KEYWORD_SNAPSHOT_METHODS)[number];

/** 결과 상태(ck_kws_status) */
export const KEYWORD_SNAPSHOT_STATUSES = ['RUNNING', 'COMPLETED', 'ABORTED'] as const;
export type KeywordSnapshotStatus = (typeof KEYWORD_SNAPSHOT_STATUSES)[number];

/** 수집 범위(ck_kws_rank_limit). 100위 = cid당 5페이지, 500위 = cid당 25페이지(F-KW-01·02) */
export const RANK_LIMITS = [100, 500] as const;
export type RankLimit = (typeof RANK_LIMITS)[number];
export const DEFAULT_RANK_LIMIT: RankLimit = 100;

/**
 * 이상 응답 사유 8종(F-KW-04, PRD §8.1). 이면 자동 재시도 없이 곧바로 멈춘다(ABORTED).
 * 앞 5종은 '데이터랩 구조 변경 의심'(05-2 structureChangeSuspected), 뒤 3종은 막힘(24시간 쉼).
 */
export const ANOMALY_ABORT_REASONS = [
  'NO_RANKS_KEY',
  'HTTP_404',
  'NOT_JSON',
  'RETURN_CODE',
  'COUNT_MISMATCH',
  'HTTP_403',
  'HTTP_418',
  'HTTP_429',
] as const;
export type AnomalyAbortReason = (typeof ANOMALY_ABORT_REASONS)[number];

/** 구조 변경 의심 사유(앞 5종) */
export const STRUCTURE_CHANGE_REASONS: readonly AnomalyAbortReason[] = [
  'NO_RANKS_KEY',
  'HTTP_404',
  'NOT_JSON',
  'RETURN_CODE',
  'COUNT_MISMATCH',
];

/**
 * 이상 응답이 아닌 중단 사유(P2-01 Proposed, 새 마이그레이션 `20260930000000_keyword_abort_reasons`, ERD §3.2 v0.5).
 * - NETWORK_ERROR: 응답을 받지 못함(시간 초과·연결 실패 — 관문 502 EXTERNAL_API_ERROR)
 * - APP_RESTART: 수집 중 앱이 꺼져 재시작 때 RUNNING 묶음을 닫음
 * - INTERRUPTED: 그 밖에 도중에 멈춤(하루 상한·쉼에 막힘, 앱 내부 오류)
 * 구조 변경 의심이 아니고, 자동으로 다시 하지 않는다(오너가 '수집'을 다시 누르거나 붙여넣기).
 */
export const INTERRUPT_ABORT_REASONS = ['NETWORK_ERROR', 'APP_RESTART', 'INTERRUPTED'] as const;
export type InterruptAbortReason = (typeof INTERRUPT_ABORT_REASONS)[number];

/** 모든 중단 사유(ck_kws_abort_reason, v0.5) */
export const KEYWORD_ABORT_REASONS = [
  ...ANOMALY_ABORT_REASONS,
  ...INTERRUPT_ABORT_REASONS,
] as const;
export type KeywordAbortReason = AnomalyAbortReason | InterruptAbortReason;

export function isStructureChangeReason(reason: string | null | undefined): boolean {
  return (STRUCTURE_CHANGE_REASONS as readonly string[]).includes(reason ?? '');
}

/** 제외 사유(ck_keyword_excluded). M1은 아동화 키워드 하나 */
export const KEYWORD_EXCLUDED_REASON_CHILD = 'CHILD';

/** 붙여넣기 글 상한(05-2 KeywordPasteRequest.text maxLength, 넘으면 413 PAYLOAD_TOO_LARGE) */
export const PASTE_TEXT_MAX_LENGTH = 100_000;

/** 키워드 글자 상한(keyword.keyword varchar(100)) */
export const KEYWORD_MAX_LENGTH = 100;

/** 응답 range 원문 상한(keyword_snapshot.response_range varchar(40)) */
export const RESPONSE_RANGE_MAX_LENGTH = 40;

/** ALREADY_IN_PROGRESS details.job(05-3) */
export const KEYWORD_COLLECTION_JOB = 'KEYWORD_COLLECTION';
/** ALREADY_IN_PROGRESS {작업} 문구(Proposed) */
export const KEYWORD_COLLECTION_JOB_LABEL = '데이터랩 수집';

/** 수집 시작 잠금(pg_advisory_xact_lock 키 — 메타 동기화 8010808과 다른 값) */
export const KEYWORD_COLLECTION_LOCK_SQL = 'SELECT pg_advisory_xact_lock(8010201)';

/** 감사 기록 SETTING_CHANGED detail.setting(아동 단어 더하기) */
export const CHILD_KEYWORD_AUDIT_SETTING = 'CHILD_KEYWORD_TERMS';

/** 201·202 Location(API_PREFIX 'api/v1' 포함) */
export function keywordSnapshotLocation(id: number): string {
  return `/api/v1/keyword-snapshots/${id}`;
}

const MAX_ID = 2_147_483_647;

/** 경로 id(1 이상 int4). 아니면 null(부르는 쪽이 404로 답한다 — P1-01·P1-04와 같은 방식) */
export function parsePathId(raw: unknown): number | null {
  const text = typeof raw === 'number' ? String(raw) : raw;
  if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text)) {
    const id = Number(text);
    if (id <= MAX_ID) return id;
  }
  return null;
}
