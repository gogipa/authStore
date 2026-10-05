import type { ProgressEventName } from '@/shared/api/events';
import type { DemoProgress } from '@/shared/lib/demo';
import { categoryRunner } from './world/domains/category';
import { copyRunner, noticeHtmlRunner, noticeRawRunner } from './world/domains/content';
import { pricingRunner } from './world/domains/pricing';
import { sourcingRunner } from './world/domains/sourcing';
import { tagsRunner } from './world/domains/tags';
import { thumbnailRunner } from './world/domains/thumbnail';
import { uploadRunner } from './world/domains/upload';
import { createDemoClock } from './world/clock';
import { candidateNotFound } from './world/errors';
import { computeProgress } from './world/progress';
import type { DelayKind, StepRunner } from './world/runner';
import { initialWorldState, type CandidateRec, type WorldState } from './world/state';
import type { StepCode } from './world/steps';
import type { DemoClock } from './sample/story';
import { DEMO_IDS, type StoryKey } from './sample/story';

/** 예시 여정 id */
export const DEMO_CANDIDATE_ID = DEMO_IDS.candidate;

/** 단계가 결과를 내기까지 걸리는 시간(밀리초). 브라우저는 0.4~1.5초, 테스트는 0 */
export interface DemoDelays {
  short: number;
  medium: number;
  long: number;
}

export const DEFAULT_DELAYS: DemoDelays = { short: 450, medium: 900, long: 1400 };

export interface DemoWorldOptions {
  /** 지금 시각(ms). 기본 `Date.now` */
  now?: () => number;
  delays?: DemoDelays;
}

/** 모델이 내보내는 진행 알림(SSE에 해당). 화면 구독자(`onProgressEvent`)와 무효화 표가 받는다 — 체험 앱이 `applyProgressEvent`로 적용한다 */
export type WorldEventListener = (name: ProgressEventName, data: unknown) => void;

interface Task {
  due: number;
  fn: () => void;
  handle: ReturnType<typeof setTimeout>;
}

/**
 * 따라 하기 체험(D-32)의 메모리 모델: 예시 여정 하나가 ①→⑨를 거치는 모습을 실제 BE의 규칙대로 되풀이한다.
 * - 상태(`s`)는 브라우저 메모리에만 있다(저장·전송 없음). 처음부터 다시(`reset`)는 빈 상태로 되돌린다.
 * - 눌러서 하는 일은 라우트(`demoApi`)가 이 모델을 바꾸고, 결과(입력 대기·완료)는 짧은 지연 뒤 모델이 스스로 바꾼다(`schedule`).
 * - 바뀔 때마다 `changed()`가 구독자(띠·QueryClient 무효화)에게 알린다.
 */
export class DemoWorld {
  s: WorldState;
  readonly runners: Partial<Record<StepCode, StepRunner>>;
  readonly delays: DemoDelays;
  private readonly nowFn: () => number;
  private readonly tasks = new Set<Task>();
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<WorldEventListener>();
  private snapshot: DemoProgress;
  private clockInstance: DemoClock;

  constructor(options: DemoWorldOptions = {}) {
    this.nowFn = options.now ?? Date.now;
    this.delays = options.delays ?? DEFAULT_DELAYS;
    this.runners = {
      SOURCING: sourcingRunner,
      PRICING: pricingRunner,
      CATEGORY: categoryRunner,
      THUMBNAIL: thumbnailRunner,
      COPY: copyRunner,
      NOTICE_RAW: noticeRawRunner,
      NOTICE_HTML: noticeHtmlRunner,
      TAGS: tagsRunner,
      UPLOAD: uploadRunner,
    };
    this.s = initialWorldState(this.nowFn());
    this.clockInstance = this.makeClock();
    this.snapshot = computeProgress(this);
  }

  private makeClock(): DemoClock {
    return createDemoClock(this.s.startedAt, () => this.s.times, this.nowFn);
  }

  now(): number {
    return this.nowFn();
  }

  /** 예시 데이터를 만드는 시계('몇 분 전'을 실제로 일어난 시각으로 바꿔 준다) */
  get clock(): DemoClock {
    return this.clockInstance;
  }

  /** 이야기 시각표의 일이 일어났다고 남긴다(같은 일이 또 일어나면 새 시각으로 덮는다) */
  mark(key: StoryKey, at: number = this.nowFn()): void {
    this.s.times[key] = at;
  }

  delay(kind: DelayKind): number {
    return this.delays[kind];
  }

  /** 지연 뒤에 할 일을 맡긴다. 처음부터 다시(`reset`)가 취소한다. 일이 끝나면 `changed()`를 부른다 */
  schedule(delay: DelayKind | number, fn: () => void): void {
    const ms = typeof delay === 'number' ? delay : this.delays[delay];
    const task: Task = {
      due: this.nowFn() + ms,
      fn,
      handle: setTimeout(() => this.run(task), ms),
    };
    this.tasks.add(task);
  }

  private run(task: Task): void {
    if (!this.tasks.delete(task)) return;
    clearTimeout(task.handle);
    task.fn();
    this.changed();
  }

  /** 맡겨 둔 일을 기다리지 않고 지금 모두 한다(테스트). 일이 새 일을 맡기면 그것도 한다 */
  flush(): void {
    for (let guard = 0; this.tasks.size > 0 && guard < 10_000; guard += 1) {
      const next = [...this.tasks].sort((a, b) => a.due - b.due)[0]!;
      this.run(next);
    }
  }

  get pendingTasks(): number {
    return this.tasks.size;
  }

  // ── 알림 ──

  emit(name: ProgressEventName, data: unknown): void {
    for (const listener of this.eventListeners) listener(name, data);
  }

  onEvent(listener: WorldEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** 모델이 바뀌었다고 알린다(라우트의 상태 변경 요청 뒤·맡겨 둔 일 뒤). 진행 스냅샷은 바뀔 때만 새 객체가 된다 */
  changed(): void {
    const next = computeProgress(this);
    const prev = this.snapshot;
    const same =
      prev.done === next.done &&
      prev.total === next.total &&
      prev.candidateId === next.candidateId &&
      prev.registered === next.registered &&
      prev.busy === next.busy &&
      prev.next?.id === next.next?.id &&
      prev.next?.path === next.next?.path &&
      JSON.stringify(prev.next?.params) === JSON.stringify(next.next?.params);
    if (!same) this.snapshot = next;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  progress = (): DemoProgress => this.snapshot;

  /** 처음부터 다시: 맡겨 둔 일을 모두 취소하고 빈 상태로 되돌린다 */
  reset(): void {
    for (const task of this.tasks) clearTimeout(task.handle);
    this.tasks.clear();
    this.s = initialWorldState(this.nowFn());
    this.clockInstance = this.makeClock();
    this.snapshot = computeProgress(this);
    for (const listener of this.listeners) listener();
  }

  // ── 여정 ──

  hasCandidate(idText: string): boolean {
    return this.s.candidate !== null && String(this.s.candidate.id) === idText;
  }

  /** 예시 여정. 아직 만들기 전이면 실제 BE처럼 404 `CANDIDATE_NOT_FOUND` */
  candidate(): CandidateRec {
    if (!this.s.candidate) throw candidateNotFound();
    return this.s.candidate;
  }
}
