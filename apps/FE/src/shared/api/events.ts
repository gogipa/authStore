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
 */
export const EVENT_INVALIDATIONS: EventInvalidations = {
  'call-usage.changed': () => [qk('integrations', 'getCallUsage')],
  'settings.reloaded': () => [['settings']],
  'candidate.status-changed': ({ candidateId }) => [
    qk('step-engine', 'listCandidates'),
    qk('step-engine', 'getCandidate', { candidateId }),
    qk('step-engine', 'getCandidateStatusCounts'),
    qk('step-engine', 'getCandidateResumeTarget'),
    qk('step-engine', 'listCandidateStatusHistory', { candidateId }),
    qk('step-engine', 'listAttentionCandidateSteps'),
  ],
  'candidate-step.changed': ({ candidateId }) => [
    qk('step-engine', 'listCandidates'),
    qk('step-engine', 'getCandidate', { candidateId }),
    qk('step-engine', 'getCandidateResumeTarget'),
    qk('step-engine', 'listAttentionCandidateSteps'),
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

function handleProgressEvent(connection: SharedConnection, name: ProgressEventName, event: Event) {
  const resolve = EVENT_INVALIDATIONS[name] as ((data: unknown) => QueryKey[]) | undefined;
  if (!resolve) return;
  let data: unknown;
  try {
    data = JSON.parse(String((event as MessageEvent).data));
  } catch {
    console.warn(`진행 알림 ${name}의 data를 읽지 못해 건너뜁니다.`);
    return;
  }
  const keys = resolve(data);
  eachClient(connection, (client) => {
    for (const queryKey of keys) void client.invalidateQueries({ queryKey });
  });
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
