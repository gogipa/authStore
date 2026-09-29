import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { components } from './schema';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageChanged } from '@/test/fixtures/callUsage';
import {
  connectProgressEvents,
  EVENT_INVALIDATIONS,
  PROGRESS_EVENT_NAMES,
  PROGRESS_EVENTS_URL,
  type ProgressEventData,
  type ProgressEventName,
} from './events';

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  return { queryClient, invalidate };
}

const disposers: Array<() => void> = [];
function connect(queryClient: QueryClient, reconnectDelaysMs?: number[]) {
  const dispose = connectProgressEvents(queryClient, {
    EventSourceImpl: FakeEventSource,
    reconnectDelaysMs,
  });
  disposers.push(dispose);
  return dispose;
}

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  vi.useRealTimers();
});

describe('진행 알림 이름', () => {
  it('M1 이벤트 22개이고 schema.d.ts의 ProgressEventFrame에서 온다', () => {
    expect(PROGRESS_EVENT_NAMES).toHaveLength(22);
    expect(new Set(PROGRESS_EVENT_NAMES).size).toBe(22);
    expectTypeOf<(typeof PROGRESS_EVENT_NAMES)[number]>().toEqualTypeOf<ProgressEventName>();
    expectTypeOf<ProgressEventData<'call-usage.changed'>>().toEqualTypeOf<
      components['schemas']['CallUsageChangedEvent']
    >();
  });

  it('무효화 표: call-usage.changed(P1-02), settings.reloaded(P1-03)', () => {
    expect(Object.keys(EVENT_INVALIDATIONS)).toEqual(['call-usage.changed', 'settings.reloaded']);
    expect(EVENT_INVALIDATIONS['call-usage.changed']?.(callUsageChanged())).toEqual([
      ['integrations', 'getCallUsage'],
    ]);
    // 다시 읽기 실패(settingsSnapshotId null)에도 settings 태그 전체를 다시 읽는다
    for (const valid of [true, false]) {
      expect(
        EVENT_INVALIDATIONS['settings.reloaded']?.({
          settingsSnapshotId: valid ? 3 : null,
          changedKeys: valid ? ['costs.targetMarginPct'] : [],
          valid,
          errors: valid ? [] : ['/costs/cardSurchargePct: 숫자여야 합니다.'],
          rerunRequiredStepCount: 0,
        }),
      ).toEqual([['settings']]);
    }
  });
});

describe('connectProgressEvents', () => {
  it('여러 번 연결해도 EventSource는 1개이고 URL은 /api/v1/events다', () => {
    const a = setup();
    const b = setup();
    connect(a.queryClient);
    connect(b.queryClient);
    connect(a.queryClient);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest().url).toBe('/api/v1/events');
    expect(PROGRESS_EVENTS_URL).toBe('/api/v1/events');
  });

  it("call-usage.changed가 오면 ['integrations','getCallUsage']를 무효화한다", () => {
    const { queryClient, invalidate } = setup();
    connect(queryClient);

    FakeEventSource.latest().emit('call-usage.changed', callUsageChanged(39));

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations', 'getCallUsage'] });
  });

  it('구독한 QueryClient 모두에 무효화를 보낸다', () => {
    const a = setup();
    const b = setup();
    connect(a.queryClient);
    connect(b.queryClient);

    FakeEventSource.latest().emit('call-usage.changed', callUsageChanged(39));

    expect(a.invalidate).toHaveBeenCalledTimes(1);
    expect(b.invalidate).toHaveBeenCalledTimes(1);
  });

  it('모르는 이벤트·표에 없는 이벤트·읽을 수 없는 data는 무시한다', () => {
    const { queryClient, invalidate } = setup();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    connect(queryClient);
    const source = FakeEventSource.latest();

    source.emit('unknown.event', { x: 1 });
    source.emit('step-run.status-changed', { candidateId: 1 });
    source.emitRaw('call-usage.changed', '{not json');

    expect(invalidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('처음 열릴 때는 다시 읽지 않는다', () => {
    const { queryClient, invalidate } = setup();
    connect(queryClient);
    FakeEventSource.latest().open();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('fail() 뒤 reopen()이면 활성 쿼리 전체를 무효화한다', () => {
    const { queryClient, invalidate } = setup();
    connect(queryClient);
    const source = FakeEventSource.latest();
    source.open();

    source.fail();
    expect(invalidate).not.toHaveBeenCalled();
    source.reopen();

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });
    // 브라우저가 스스로 다시 붙는 경우라 새 EventSource를 만들지 않는다.
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('브라우저가 포기하면(CLOSED) 간격을 두고 새 연결을 열고, 열리면 다시 읽는다', () => {
    vi.useFakeTimers();
    const { queryClient, invalidate } = setup();
    connect(queryClient, [1000, 5000]);
    const first = FakeEventSource.latest();

    first.fail({ closed: true });
    expect(first.closeCount).toBe(1);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    const second = FakeEventSource.latest();
    second.fail({ closed: true });
    vi.advanceTimersByTime(4999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    const third = FakeEventSource.latest();
    expect(FakeEventSource.instances).toHaveLength(3);

    third.open();
    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });
    // 닫힌 옛 연결의 이벤트는 무시한다.
    first.emit('call-usage.changed', callUsageChanged());
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('마지막 구독이 풀리면 close()를 부른다', () => {
    const a = setup();
    const b = setup();
    const disposeA = connect(a.queryClient);
    const disposeB = connect(b.queryClient);
    const source = FakeEventSource.latest();

    disposeA();
    disposeA(); // 두 번 불러도 한 번만 푼다
    expect(source.closeCount).toBe(0);
    disposeB();
    expect(source.closeCount).toBe(1);

    // 다시 연결하면 새 EventSource를 연다.
    connect(a.queryClient);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('다시 붙기를 기다리는 중에 구독이 풀리면 새 연결을 열지 않는다', () => {
    vi.useFakeTimers();
    const { queryClient } = setup();
    const dispose = connect(queryClient, [1000]);
    FakeEventSource.latest().fail({ closed: true });
    dispose();
    vi.advanceTimersByTime(5000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('EventSource가 없는 환경에서는 아무것도 하지 않는다', () => {
    const { queryClient } = setup();
    const original = (globalThis as { EventSource?: unknown }).EventSource;
    expect(original).toBeUndefined();
    const dispose = connectProgressEvents(queryClient);
    expect(FakeEventSource.instances).toHaveLength(0);
    dispose();
  });
});
