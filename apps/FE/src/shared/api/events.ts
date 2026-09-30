import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { API_BASE_URL } from './client';
import { qk } from './queryKeys';
import type { components } from './schema';

/**
 * SSE 진행 알림 구독(03-2 §6.3, 05-1 §1.3·§3, 05-2 `streamProgressEvents`).
 *
 * - 앱 전체에 `EventSource('/api/v1/events')`는 하나다. 여러 곳이 `connectProgressEvents`를 불러도 연결을 나눠 쓴다.
 * - 이벤트가 오면 `EVENT_INVALIDATIONS` 표의 쿼리를 **무효화만** 한다. 캐시에 값을 직접 쓰지 않는다.
 * - 연결이 끊겼다가 다시 붙으면 활성 쿼리를 모두 다시 읽는다. 서버가 놓친 이벤트를 다시 보내지 않기 때문이다
 *   (05-2 x-decision §7.1-3).
 * - 202 작업의 결과를 폴링하지 않는다. 결과는 이 알림 → 조회 API 재조회로 받는다.
 */

type ProgressEventFrame = components['schemas']['ProgressEventFrame'];

/** 05-1 §3에서 마일스톤이 M2인 이벤트. M1 구독 대상에서 뺀다. */
type M2ProgressEventName =
  | 'batch-run.item-updated'
  | 'image-asset.derived'
  | 'smartstore-product.changed'
  | 'smartstore-product-sync.completed'
  | 'system-check.completed'
  | 'credential.expiring'
  | 'notice-monitor.changed';

/** M1 이벤트 이름 22개. schema.d.ts의 `ProgressEventFrame`에서 파생한다(명세가 바뀌면 타입이 따라온다). */
export type ProgressEventName = Exclude<ProgressEventFrame['event'], M2ProgressEventName>;

/** 이벤트 이름별 data 타입. */
export type ProgressEventData<N extends ProgressEventName> = Extract<
  ProgressEventFrame,
  { event: N }
>['data'];

/** M1 이벤트 이름 목록(05-2 oneOf 순서). 빠지거나 더해지면 events.test.ts의 타입 검사가 깨진다. */
export const PROGRESS_EVENT_NAMES = [
  'step-run.status-changed',
  'candidate-step.changed',
  'candidate.status-changed',
  'gate.passed',
  'gate.invalidated',
  'continuous-run.stopped',
  'keyword-collection.progress',
  'keyword-collection.completed',
  'keyword-collection.aborted',
  'sourcing.search-completed',
  'sourcing.row-updated',
  'sourcing.page-fetch-finished',
  'call-usage.changed',
  'generation-run.updated',
  'content-field.recheck-flagged',
  'registration.status-changed',
  'registration-switch.changed',
  'commerce-meta-sync.completed',
  'settings.reloaded',
  'fx-rate.updated',
  'auth.failed',
  'ai-cli-check.completed',
] as const satisfies readonly ProgressEventName[];

export type EventInvalidations = {
  [N in ProgressEventName]?: (data: ProgressEventData<N>) => QueryKey[];
};

/**
 * 이벤트 → 무효화할 queryKey 표. 도메인 훅을 만드는 실행 문서가 자기 이벤트를 이 표에 더한다.
 * - P1-02: `call-usage.changed`
 * - P1-03: `settings.reloaded` → settings 태그 전체(`GET /settings` 등). 다시 읽기가 실패해도 오므로
 *   (settingsSnapshotId null) 화면의 검사 결과가 바로 바뀐다.
 * - P1-04: `candidate.status-changed` → 후보 목록·그 후보 상세·상태별 수·이어서 할 곳·그 후보 상태 이력·재실행 필요 모아 보기
 *   (제외되면 그 후보의 단계가 모아 보기에서 빠진다). `candidate-step.changed` → 후보 목록(단계 점)·그 후보 상세·
 *   이어서 할 곳·재실행 필요 모아 보기. 키는 features/step-engine의 `stepEngineKeys`와 같은 모양이다
 *   (shared는 features를 부르지 않아 여기서 qk로 만든다).
 * - P1-05: `step-run.status-changed`·`candidate-step.changed` → 그 후보의 단계 레일·버전 이력·바뀐 입력, 실행 한 건,
 *   그 후보 상세·목록·재실행 필요 모아 보기(+ 이어서 할 곳). `settings.reloaded`가 재실행 필요 단계를 만들었으면
 *   (`rerunRequiredStepCount` > 0) step-engine 태그 전체도 다시 읽는다(설정 변경 전파).
 * - P1-06: `continuous-run.stopped`·`gate.passed`·`gate.invalidated` → 그 후보의 게이트 목록·상세·단계 레일, 후보 목록·
 *   이어서 할 곳(+ 멈춘 묶음 `getContinuousRun`). 묶음 안 실행의 `step-run.status-changed`(stepChainId)는 그 묶음도
 *   다시 읽는다(연속 실행 띠의 진행).
 * - P1-07: `auth.failed` → 커머스API 인증 상태(`getAuthStatus`). 재발급까지 실패하면 원인 안내가 바로 바뀐다.
 * - P1-08: `commerce-meta-sync.completed` → 메타 동기화 상태(`getLatestCommerceMetaSyncRuns`)와 주소록·반품 택배사 캐시
 *   목록 전체(P1-09 프로필의 선택 목록). 대상 하나가 끝날 때마다 온다.
 * - P1-09: `commerce-meta-sync.completed` → 구매대행 프로필(`getPurchaseAgencyProfile`)도 다시 읽는다(주소록이 사라지거나
 *   해외가 아니게 되면 `addressWarnings`가 바뀐다). 프로필·발송 택배사 목록은 settings 태그라 `settings.reloaded`도 무효화한다.
 * - P1-11: `ai-cli-check.completed` → AI 엔진 최신 점검(`getLatestAiCliChecks`)·점검 이력(`listAiCliChecks` 전체). 엔진마다 1건
 *   온다. AGY면 AI 엔진 설정(`getAiEngineSettings`)도 다시 읽는다(감지 때 `agy models` 목록을 다시 받는다). AI 엔진 저장의
 *   `settings.reloaded`는 위 settings 태그 무효화에 들어 있다.
 * - P2-01: `keyword-collection.progress` → 그 묶음·묶음 안 키워드(페이지마다 줄이 늘어난다). `.completed`·`.aborted` →
 *   묶음 목록·그 묶음·묶음 안 키워드·수집 상태. `settings.reloaded`의 changedKeys에 `safety.childKeywords`가 있으면
 *   아동 단어 목록(`listChildKeywordTerms`)도. 진행률 숫자(페이지 수)는 캐시가 아니라 `onProgressEvent` 구독으로 받는다.
 * - P2-02: `sourcing.search-completed` → 그 후보의 ② 비교표(`getSourcingComparison`). `sourcing.row-updated`·
 *   `sourcing.page-fetch-finished`(data에 후보 id가 없다) → 비교표 전체. `step-run.status-changed`가 ②(SOURCING)면 그 후보의
 *   비교표도 다시 읽는다(URL로 만들기·재조회·성인용 확인 뒤 ②가 끝날 때 머리 행이 바뀐다).
 * - P2-03: 비교표 queryKey가 조회 조건을 더 가진다(`{ candidateId, stepRunId, includeNoMatch, sort }`) — 위 키는 부분 일치로
 *   모두 닿는다. `gate.invalidated` → 그 후보 비교표도(다른 샵을 고르면 G2가 무효가 된다 — '다른 샵을 고르면 판정(G2)을 다시
 *   통과해야 합니다'). 행 수정(PATCH)은 SSE 없이 응답으로 캐시를 고친다.
 * - P2-04: `fx-rate.updated`(새 최신 환율·수집 실패·±20% 차이) → 환율 최신값(`getLatestFxRates`)·이력(`listFxRates` 전체).
 *   새 최신값이 ③을 재실행 필요로 만들면 그 후보마다 `candidate-step.changed`가 따로 온다. 요금표 가져오기는 SSE가 없고
 *   응답으로 캐시를 고친다.
 * - P2-05: `step-run.status-changed`가 ③(PRICING)이면 그 후보의 판정(`getPriceJudgement`)·국내 기준가 이력. `gate.passed`·
 *   `gate.invalidated` → 그 후보 판정도(G2 줄·확정한 값). 국내 기준가 입력·'비교 없이 확정'은 응답 뒤 훅이 무효화한다.
 * - P2-06: `step-run.status-changed`가 ④(CATEGORY)이면 그 후보의 카테고리 결정(`getCategoryDecision` — 입력 대기·완료·성별
 *   재확인으로 다시 뽑은 후보). `candidate-step.changed`(어느 단계든) → 그 후보의 카테고리 결정도(성별이 바뀌면 ③·⑥-3·⑦의
 *   '재실행 필요'와 함께 온다). 리프 고르기·성별 재확인은 응답 뒤 훅이 무효화한다.
 */
function stepEngineStepKeys(candidateId: number): QueryKey[] {
  return [
    qk('step-engine', 'listCandidateSteps', { candidateId }),
    qk('step-engine', 'listCandidateStepRuns', { candidateId }),
    qk('step-engine', 'getCandidateStepStaleDiff', { candidateId }),
    qk('step-engine', 'getCandidate', { candidateId }),
    qk('step-engine', 'listCandidates'),
    qk('step-engine', 'getCandidateResumeTarget'),
    qk('step-engine', 'listAttentionCandidateSteps'),
  ];
}

function keywordSnapshotKeys(keywordSnapshotId: number): QueryKey[] {
  return [
    qk('keywords', 'getKeywordSnapshot', { keywordSnapshotId }),
    qk('keywords', 'listSnapshotKeywords', { keywordSnapshotId }),
  ];
}

function keywordCollectionEndKeys(keywordSnapshotId: number): QueryKey[] {
  return [
    qk('keywords', 'listKeywordSnapshots'),
    ...keywordSnapshotKeys(keywordSnapshotId),
    qk('keywords', 'getKeywordCollectionStatus'),
  ];
}

function gateKeys(candidateId: number): QueryKey[] {
  return [
    qk('step-engine', 'listCandidateGates', { candidateId }),
    qk('step-engine', 'getCandidate', { candidateId }),
    qk('step-engine', 'listCandidateSteps', { candidateId }),
    qk('step-engine', 'listCandidates'),
    qk('step-engine', 'getCandidateResumeTarget'),
  ];
}

export const EVENT_INVALIDATIONS: EventInvalidations = {
  'call-usage.changed': () => [qk('integrations', 'getCallUsage')],
  'settings.reloaded': ({ rerunRequiredStepCount, changedKeys }) => [
    ['settings'],
    ...(rerunRequiredStepCount > 0 ? [['step-engine']] : []),
    ...(changedKeys.includes('safety.childKeywords')
      ? [qk('keywords', 'listChildKeywordTerms')]
      : []),
  ],
  'candidate.status-changed': ({ candidateId }) => [
    qk('step-engine', 'listCandidates'),
    qk('step-engine', 'getCandidate', { candidateId }),
    qk('step-engine', 'getCandidateStatusCounts'),
    qk('step-engine', 'getCandidateResumeTarget'),
    qk('step-engine', 'listCandidateStatusHistory', { candidateId }),
    qk('step-engine', 'listAttentionCandidateSteps'),
  ],
  'candidate-step.changed': ({ candidateId }) => [
    ...stepEngineStepKeys(candidateId),
    qk('step-engine', 'getStepRun'),
    qk('category', 'getCategoryDecision', { candidateId }),
  ],
  'step-run.status-changed': ({ candidateId, stepRunId, stepChainId, stepCode }) => [
    ...stepEngineStepKeys(candidateId),
    qk('step-engine', 'getStepRun', { stepRunId }),
    ...(stepChainId != null ? [qk('step-engine', 'getContinuousRun', { stepChainId })] : []),
    qk('step-engine', 'listCandidateGates', { candidateId }),
    ...(stepCode === 'SOURCING' ? [qk('sourcing', 'getSourcingComparison', { candidateId })] : []),
    ...(stepCode === 'PRICING'
      ? [
          qk('pricing', 'getPriceJudgement', { candidateId }),
          qk('pricing', 'listDomesticPrices', { candidateId }),
        ]
      : []),
    ...(stepCode === 'CATEGORY' ? [qk('category', 'getCategoryDecision', { candidateId })] : []),
  ],
  'continuous-run.stopped': ({ candidateId, stepChainId }) => [
    qk('step-engine', 'getContinuousRun', { stepChainId }),
    ...gateKeys(candidateId),
  ],
  'gate.passed': ({ candidateId }) => [
    ...gateKeys(candidateId),
    qk('pricing', 'getPriceJudgement', { candidateId }),
  ],
  'gate.invalidated': ({ candidateId }) => [
    ...gateKeys(candidateId),
    qk('sourcing', 'getSourcingComparison', { candidateId }),
    qk('pricing', 'getPriceJudgement', { candidateId }),
  ],
  'auth.failed': () => [qk('system', 'getAuthStatus')],
  'ai-cli-check.completed': ({ engineCode }) => [
    qk('system', 'getLatestAiCliChecks'),
    qk('system', 'listAiCliChecks'),
    ...(engineCode === 'AGY' ? [qk('settings', 'getAiEngineSettings')] : []),
  ],
  'keyword-collection.progress': ({ keywordSnapshotId }) => keywordSnapshotKeys(keywordSnapshotId),
  'sourcing.search-completed': ({ candidateId }) => [
    qk('sourcing', 'getSourcingComparison', { candidateId }),
  ],
  'sourcing.row-updated': () => [qk('sourcing', 'getSourcingComparison')],
  'sourcing.page-fetch-finished': () => [qk('sourcing', 'getSourcingComparison')],
  'keyword-collection.completed': ({ keywordSnapshotId }) =>
    keywordCollectionEndKeys(keywordSnapshotId),
  'keyword-collection.aborted': ({ keywordSnapshotId }) =>
    keywordCollectionEndKeys(keywordSnapshotId),
  'fx-rate.updated': () => [qk('pricing', 'getLatestFxRates'), qk('pricing', 'listFxRates')],
  'commerce-meta-sync.completed': () => [
    qk('integrations', 'getLatestCommerceMetaSyncRuns'),
    qk('integrations', 'listCommerceAddressbooks'),
    qk('integrations', 'listCommerceReturnDeliveryCompanies'),
    qk('settings', 'getPurchaseAgencyProfile'),
  ],
};

export const PROGRESS_EVENTS_URL = `${API_BASE_URL}/events`;

/** 브라우저 EventSource에서 이 모듈이 쓰는 부분. 테스트는 src/test/fakeEventSource.ts를 넣는다. */
export interface EventSourceLike {
  readonly readyState: number;
  addEventListener(type: string, listener: (event: Event) => void): void;
  close(): void;
}

export type EventSourceFactory = new (url: string) => EventSourceLike;

/** EventSource.CLOSED — 브라우저가 더는 스스로 다시 붙지 않는 상태. */
const READY_STATE_CLOSED = 2;

/**
 * 브라우저가 스스로 다시 붙지 않을 때(서버가 200이 아닌 응답을 줌: 개발 프록시 502 등) 새 연결을 여는 간격.
 * 끝 값을 계속 쓴다. Proposed(03-2 §6.3).
 */
export const DEFAULT_RECONNECT_DELAYS_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 30_000];

export interface ConnectProgressEventsOptions {
  /** 기본은 `globalThis.EventSource`. 없으면(jsdom 등) 연결하지 않는다. */
  EventSourceImpl?: EventSourceFactory;
  reconnectDelaysMs?: readonly number[];
}

interface SharedConnection {
  Impl: EventSourceFactory;
  reconnectDelaysMs: readonly number[];
  source: EventSourceLike | null;
  /** 구독한 QueryClient와 구독 수. 보통 하나다. */
  clients: Map<QueryClient, number>;
  /** 오류가 난 뒤 아직 다시 읽지 않았다. 다음 open 때 활성 쿼리를 모두 다시 읽는다. */
  needsResync: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

let shared: SharedConnection | null = null;

function eachClient(connection: SharedConnection, fn: (client: QueryClient) => void) {
  for (const client of connection.clients.keys()) fn(client);
}

/** 이벤트 data를 받는 구독자(진행률처럼 캐시에 두지 않는 값을 화면 상태로 받을 때, P2-01) */
type ProgressEventListener = (data: unknown) => void;
const dataListeners = new Map<ProgressEventName, Set<ProgressEventListener>>();

/**
 * 진행 알림 한 종류의 data를 받는다(P2-01 Proposed, 06-3 §9). 연결은 `connectProgressEvents`가 연 하나를 같이 쓴다
 * (이 함수는 연결을 열지 않는다). 무효화 표(EVENT_INVALIDATIONS)가 끝난 뒤 부른다. 돌려준 함수로 구독을 푼다.
 * 서버 값을 캐시에 쓰는 데 쓰지 않는다(그건 조회 API 재조회로 받는다) — 진행률처럼 조회 API가 없는 값에만 쓴다.
 */
export function onProgressEvent<N extends ProgressEventName>(
  name: N,
  listener: (data: ProgressEventData<N>) => void,
): () => void {
  const set = dataListeners.get(name) ?? new Set<ProgressEventListener>();
  dataListeners.set(name, set);
  const wrapped: ProgressEventListener = (data) => listener(data as ProgressEventData<N>);
  set.add(wrapped);
  return () => {
    set.delete(wrapped);
  };
}

function handleProgressEvent(connection: SharedConnection, name: ProgressEventName, event: Event) {
  const resolve = EVENT_INVALIDATIONS[name] as ((data: unknown) => QueryKey[]) | undefined;
  const listeners = dataListeners.get(name);
  if (!resolve && (!listeners || listeners.size === 0)) return;
  let data: unknown;
  try {
    data = JSON.parse(String((event as MessageEvent).data));
  } catch {
    console.warn(`진행 알림 ${name}의 data를 읽지 못해 건너뜁니다.`);
    return;
  }
  if (resolve) {
    const keys = resolve(data);
    eachClient(connection, (client) => {
      for (const queryKey of keys) void client.invalidateQueries({ queryKey });
    });
  }
  for (const listener of listeners ?? []) {
    try {
      listener(data);
    } catch (error) {
      console.warn(`진행 알림 ${name} 구독자가 실패했습니다.`, error);
    }
  }
}

function openSource(connection: SharedConnection) {
  const source = new connection.Impl(PROGRESS_EVENTS_URL);
  connection.source = source;

  source.addEventListener('open', () => {
    if (shared !== connection || connection.source !== source) return;
    connection.reconnectAttempt = 0;
    if (connection.needsResync) {
      connection.needsResync = false;
      // 끊긴 동안 놓친 이벤트는 다시 오지 않는다 → 화면에 보이는 쿼리를 모두 다시 읽는다.
      eachClient(connection, (client) => void client.invalidateQueries({ refetchType: 'active' }));
    }
  });

  source.addEventListener('error', () => {
    if (shared !== connection || connection.source !== source) return;
    connection.needsResync = true;
    if (source.readyState !== READY_STATE_CLOSED) return; // 브라우저가 스스로 다시 붙는다.
    source.close();
    connection.source = null;
    const delays = connection.reconnectDelaysMs;
    const delay = delays[Math.min(connection.reconnectAttempt, delays.length - 1)] ?? 30_000;
    connection.reconnectAttempt += 1;
    connection.reconnectTimer = setTimeout(() => {
      connection.reconnectTimer = null;
      if (shared === connection) openSource(connection);
    }, delay);
  });

  for (const name of PROGRESS_EVENT_NAMES) {
    source.addEventListener(name, (event) => {
      if (shared !== connection || connection.source !== source) return;
      handleProgressEvent(connection, name, event);
    });
  }
}

function closeShared(connection: SharedConnection) {
  if (connection.reconnectTimer !== null) clearTimeout(connection.reconnectTimer);
  connection.reconnectTimer = null;
  connection.source?.close();
  connection.source = null;
  if (shared === connection) shared = null;
}

/**
 * 진행 알림 연결에 QueryClient를 붙인다. 앱 전체에서 연결은 하나이고, 마지막 구독이 풀리면 닫는다.
 * 돌려준 함수를 부르면 구독을 푼다(여러 번 불러도 한 번만 푼다).
 */
export function connectProgressEvents(
  queryClient: QueryClient,
  options: ConnectProgressEventsOptions = {},
): () => void {
  const Impl =
    options.EventSourceImpl ??
    (globalThis as { EventSource?: EventSourceFactory }).EventSource ??
    undefined;
  if (!Impl) return () => {};

  if (!shared) {
    shared = {
      Impl,
      reconnectDelaysMs: options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS,
      source: null,
      clients: new Map(),
      needsResync: false,
      reconnectAttempt: 0,
      reconnectTimer: null,
    };
    openSource(shared);
  }
  const connection = shared;
  connection.clients.set(queryClient, (connection.clients.get(queryClient) ?? 0) + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const count = (connection.clients.get(queryClient) ?? 1) - 1;
    if (count > 0) connection.clients.set(queryClient, count);
    else connection.clients.delete(queryClient);
    if (connection.clients.size === 0) closeShared(connection);
  };
}
