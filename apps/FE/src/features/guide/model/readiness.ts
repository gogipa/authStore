import type { PurchaseAgencyProfile } from '@/features/settings';
import {
  engineCheckViews,
  firstRunAiEngineState,
  SECRET_LABEL,
  systemSecretPath,
  type AiCliCheck,
  type AiCliCheckLatestList,
  type SecretKey,
  type SecretStatusList,
} from '@/features/system';
import { AI_ENGINE_LABEL } from '@/shared/lib/aiEngine';
import { formatKstTimeOrDate } from '@/shared/lib/format';
import {
  fillText,
  PROFILE_FIELD_LABEL,
  READINESS_INFO,
  READINESS_ITEMS,
  READINESS_TEXT,
  type GuideLink,
  type ReadinessItemKey,
} from '../content';

/** 항목 상태: 완료 · 할 일 · 확인 중(받는 중) · 확인 못함(조회 실패) */
export type ReadinessState = 'done' | 'todo' | 'loading' | 'error';

export interface ReadinessItemView {
  key: ReadinessItemKey;
  label: string;
  state: ReadinessState;
  text: string;
  link: GuideLink;
}

/** 쿼리 하나의 결과(받는 중이면 data·error 둘 다 없음) */
export interface QueryResult<T> {
  data: T | undefined;
  /** 실패했으면 화면 문구(오류 봉투 message) */
  error: string | null;
}

export interface ReadinessInput {
  secrets: QueryResult<SecretStatusList>;
  aiLatest: QueryResult<AiCliCheckLatestList>;
  /** 점검 이력(감지 행 뒤에 가려진 마지막 연결 테스트를 찾는다). 없으면 최신 행만 본다 */
  aiHistory?: readonly AiCliCheck[];
  profile: QueryResult<PurchaseAgencyProfile>;
  /** 지금 시각(통과 시각이 오늘인지 가른다). 없으면 부를 때 시각. 테스트용 */
  now?: Date;
}

const COMMERCE_KEYS: readonly SecretKey[] = ['COMMERCE_CLIENT_ID', 'COMMERCE_CLIENT_SECRET'];
const RAKUTEN_KEYS: readonly SecretKey[] = ['RAKUTEN_APPLICATION_ID', 'RAKUTEN_ACCESS_KEY'];

function pendingOrError<T>(key: ReadinessItemKey, query: QueryResult<T>): ReadinessItemView | null {
  const { label, link } = READINESS_ITEMS[key];
  if (query.error !== null) return { key, label, state: 'error', text: query.error, link };
  if (query.data === undefined) {
    return { key, label, state: 'loading', text: READINESS_TEXT.loading, link };
  }
  return null;
}

function secretsItem(
  key: 'COMMERCE_KEYS' | 'RAKUTEN_KEYS',
  keys: readonly SecretKey[],
  query: QueryResult<SecretStatusList>,
): ReadinessItemView {
  const early = pendingOrError(key, query);
  if (early) return early;
  const item = READINESS_ITEMS[key];
  const configured = new Set(
    (query.data?.items ?? []).filter((s) => s.configured).map((s) => s.secretKey),
  );
  const missing = keys.filter((k) => !configured.has(k));
  if (missing.length === 0) {
    return { key, label: item.label, state: 'done', text: item.done, link: item.doneLink };
  }
  return {
    key,
    label: item.label,
    state: 'todo',
    text: fillText(item.todo, {
      keys: missing.map((k) => SECRET_LABEL[k].name ?? SECRET_LABEL[k].service).join(', '),
    }),
    // 첫 빠진 키의 행을 열고 초점을 둔다(시스템 상태 `#secret-<키>`)
    link: { label: item.link.label, to: systemSecretPath(missing[0]) },
  };
}

/**
 * AI 엔진 연결: 첫 실행 'AI 엔진 고르기'(F-SY-23)와 같은 판단 — 선택 엔진의 마지막 연결 테스트가 통과면 완료. 지금 설치·로그인을
 * 다시 확인하지 않으므로, 통과 시각이 오늘이 아니면 날짜를 붙여(`MM-DD HH:mm`) 오래된 통과가 방금 것처럼 보이지 않게 한다.
 */
function aiEngineItem(input: ReadinessInput): ReadinessItemView {
  const early = pendingOrError('AI_ENGINE', input.aiLatest);
  if (early) return early;
  const item = READINESS_ITEMS.AI_ENGINE;
  const state = firstRunAiEngineState(engineCheckViews(input.aiLatest.data, input.aiHistory));
  if (state.done) {
    return {
      key: 'AI_ENGINE',
      label: item.label,
      state: 'done',
      text: fillText(item.done, {
        engine: AI_ENGINE_LABEL[state.engine],
        model: state.model,
        time: formatKstTimeOrDate(state.at, input.now),
      }),
      link: item.link,
    };
  }
  return {
    key: 'AI_ENGINE',
    label: item.label,
    state: 'todo',
    text: state.recommended
      ? fillText(item.todoRecommended, { engine: AI_ENGINE_LABEL[state.recommended] })
      : item.todoNone,
    link: item.link,
  };
}

/**
 * 썸네일 생성 도구(agy, D-19): agy가 설치됐고 마지막 연결 테스트가 통과면 완료(Proposed — 이미지 생성 전용 점검 API가 M1에 없어,
 * 같은 로그인을 쓰는 agy 연결 테스트로 본다). 고른 AI 엔진과 관계없이 본다.
 */
function imageToolItem(input: ReadinessInput): ReadinessItemView {
  const early = pendingOrError('IMAGE_TOOL', input.aiLatest);
  if (early) return early;
  const item = READINESS_ITEMS.IMAGE_TOOL;
  const view = engineCheckViews(input.aiLatest.data, input.aiHistory).find(
    (v) => v.engineCode === 'AGY',
  );
  const base = { key: 'IMAGE_TOOL' as const, label: item.label, link: item.link };
  const latest = view?.latest ?? null;
  if (!latest) return { ...base, state: 'todo', text: item.notChecked };
  if (!latest.installed) return { ...base, state: 'todo', text: item.notInstalled };
  const smoke = view?.lastSmoke ?? null;
  if (smoke?.smokeStatus === 'PASSED') {
    return {
      ...base,
      state: 'done',
      text: fillText(item.done, {
        version: latest.cliVersion ?? '',
        time: formatKstTimeOrDate(smoke.checkedAt, input.now),
      }).replace(/ {2,}/g, ' '),
    };
  }
  if (smoke?.smokeStatus === 'FAILED' || latest.authStatus === 'NOT_LOGGED_IN') {
    return { ...base, state: 'todo', text: item.failed };
  }
  return { ...base, state: 'todo', text: item.untested };
}

function profileItem(query: QueryResult<PurchaseAgencyProfile>): ReadinessItemView {
  const early = pendingOrError('PROFILE', query);
  if (early) return early;
  const item = READINESS_ITEMS.PROFILE;
  const missing = query.data?.missingFields ?? [];
  if (missing.length === 0) {
    return { key: 'PROFILE', label: item.label, state: 'done', text: item.done, link: item.link };
  }
  return {
    key: 'PROFILE',
    label: item.label,
    state: 'todo',
    text: fillText(item.todo, {
      count: missing.length,
      fields: missing.map((f) => PROFILE_FIELD_LABEL[f] ?? f).join(', '),
    }),
    link: item.link,
  };
}

/**
 * 대시보드 '시작 준비'(F-DB-10, D-29)의 센 항목 5개. 이미 있는 M1 API만 읽는다(키 저장 여부·AI 엔진 점검·구매대행 프로필).
 * 순서는 content.ts `READINESS_ITEM_KEYS`와 같다.
 */
export function readinessItems(input: ReadinessInput): ReadinessItemView[] {
  return [
    secretsItem('COMMERCE_KEYS', COMMERCE_KEYS, input.secrets),
    secretsItem('RAKUTEN_KEYS', RAKUTEN_KEYS, input.secrets),
    aiEngineItem(input),
    imageToolItem(input),
    profileItem(input.profile),
  ];
}

/** 완료 수와 전체 수. 센 항목이 모두 완료면 카드가 접힌다 */
export function readinessProgress(items: readonly ReadinessItemView[]) {
  const done = items.filter((item) => item.state === 'done').length;
  return { done, total: items.length, allDone: items.length > 0 && done === items.length };
}

/** 세지 않는 '등록 API 차단' 줄 글(켜짐·꺼짐·확인 전) */
export function switchInfoText(apiBlocked: boolean | undefined): string {
  if (apiBlocked === true) return READINESS_INFO.SWITCH.on;
  if (apiBlocked === false) return READINESS_INFO.SWITCH.off;
  return READINESS_INFO.SWITCH.unknown;
}
