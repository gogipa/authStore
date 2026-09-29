import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { AppProviders, ProgressEventsProvider } from './providers';
import { FakeEventSource } from '@/test/fakeEventSource';
import { callUsageChanged } from '@/test/fixtures/callUsage';
import { createTestQueryClient } from '@/test/renderRoute';

describe('ProgressEventsProvider', () => {
  it('공급자가 둘이어도 EventSource는 1개이고 URL은 /api/v1/events다', () => {
    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ProgressEventsProvider EventSourceImpl={FakeEventSource}>
          <ProgressEventsProvider EventSourceImpl={FakeEventSource}>
            <span>화면</span>
          </ProgressEventsProvider>
        </ProgressEventsProvider>
      </QueryClientProvider>,
    );
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest().url).toBe('/api/v1/events');
  });

  it("call-usage.changed가 오면 ['integrations','getCallUsage']를 무효화만 한다(캐시에 쓰지 않는다)", () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const setData = vi.spyOn(queryClient, 'setQueryData');
    render(
      <AppProviders queryClient={queryClient} EventSourceImpl={FakeEventSource}>
        <span>화면</span>
      </AppProviders>,
    );
    const source = FakeEventSource.latest();

    source.emit('call-usage.changed', callUsageChanged(39));
    source.emit('no-such.event', { x: 1 });

    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['integrations', 'getCallUsage'] });
    expect(setData).not.toHaveBeenCalled();
  });

  it('끊겼다가 다시 붙으면(fail → reopen) 활성 쿼리를 모두 다시 읽는다', () => {
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    render(
      <AppProviders queryClient={queryClient} EventSourceImpl={FakeEventSource}>
        <span>화면</span>
      </AppProviders>,
    );
    const source = FakeEventSource.latest();
    source.open();
    source.fail();
    source.reopen();
    expect(invalidate).toHaveBeenCalledWith({ refetchType: 'active' });
  });

  it('언마운트하면 close()가 불린다', () => {
    const queryClient = createTestQueryClient();
    const view = render(
      <AppProviders queryClient={queryClient} EventSourceImpl={FakeEventSource}>
        <span>화면</span>
      </AppProviders>,
    );
    const source = FakeEventSource.latest();
    expect(source.closeCount).toBe(0);
    view.unmount();
    expect(source.closeCount).toBe(1);
    expect(source.closed).toBe(true);
  });
});
