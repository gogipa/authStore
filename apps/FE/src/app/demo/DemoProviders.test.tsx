import { QueryClient, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { onProgressEvent } from '@/shared/api/events';
import { browserStorage, installMemoryStorage } from '@/shared/lib/browserStorage';
import { useDemo } from '@/shared/lib/demo';
import { createDemoApi } from './demoApi';
import { DemoProviders } from './DemoProviders';
import { createDemoQueryClient } from './startDemo';

/** 체험 공급자(D-32): 모델이 바뀌면 모든 조회를 다시 읽고, 알림은 구독자에게 가고, 처음부터 다시는 모두 되돌린다 */
const offs: (() => void)[] = [];
afterEach(() => {
  for (const off of offs.splice(0)) off();
});

function Probe({
  onReady,
}: {
  onReady: (guide: NonNullable<ReturnType<typeof useDemo>>['guide']) => void;
}) {
  const demo = useDemo();
  if (demo) onReady(demo.guide);
  const progress = useSyncExternalStore(demo!.guide.subscribe, demo!.guide.getSnapshot);
  return <p>진행 {progress.done}</p>;
}

describe('DemoProviders', () => {
  it('모델이 바뀌면(맡긴 결과가 나오면) 이미 읽은 조회를 다시 읽는다', async () => {
    const demo = createDemoApi({ delays: { short: 0, medium: 0, long: 0 } });
    const queryClient: QueryClient = createDemoQueryClient();
    let reads = 0;
    function Reader() {
      const query = useQuery({
        queryKey: ['probe'],
        queryFn: () => {
          reads += 1;
          return Promise.resolve(reads);
        },
      });
      return <p>읽은 횟수 {query.data ?? '-'}</p>;
    }
    render(
      <DemoProviders queryClient={queryClient} world={demo.world}>
        <Reader />
      </DemoProviders>,
    );
    await screen.findByText('읽은 횟수 1');
    act(() => demo.world.changed());
    await screen.findByText('읽은 횟수 2');
    // staleTime이 무한이라 모델이 바뀌지 않으면 다시 읽지 않는다
    await new Promise((r) => setTimeout(r, 30));
    expect(reads).toBe(2);
  });

  it('모델이 낸 알림(수집 진행)은 화면 구독자(onProgressEvent)에게 간다 — EventSource 없이', async () => {
    const demo = createDemoApi();
    const received: number[] = [];
    offs.push(
      onProgressEvent('keyword-collection.progress', (data) => received.push(data.requestsDone)),
    );
    render(
      <DemoProviders queryClient={createDemoQueryClient()} world={demo.world}>
        <p>안</p>
      </DemoProviders>,
    );
    demo.world.emit('keyword-collection.progress', {
      keywordSnapshotId: 7,
      cid: '50000173',
      page: 1,
      pagesPerCid: 5,
      requestsDone: 1,
      requestsTotal: 10,
    });
    expect(received).toEqual([1]);
  });

  it('guide.reset은 모델·메모리 저장소·읽은 조회를 모두 되돌린다', async () => {
    offs.push(installMemoryStorage());
    const demo = createDemoApi({ delays: { short: 0, medium: 0, long: 0 } });
    const queryClient = createDemoQueryClient();
    queryClient.setQueryData(['x'], 'old');
    let guide: Parameters<Parameters<typeof Probe>[0]['onReady']>[0] | undefined;
    render(
      <DemoProviders queryClient={queryClient} world={demo.world}>
        <Probe onReady={(g) => (guide = g)} />
      </DemoProviders>,
    );
    browserStorage('local').setItem('autostore.guide.workFlowHidden', '1');
    browserStorage('session').setItem('autostore.guide.setupWizardShown', '1');
    demo.world.s.keywords.selected[101] = Date.now();
    act(() => demo.world.changed());
    await screen.findByText('진행 1');

    act(() => guide!.reset());
    await screen.findByText('진행 0');
    expect(demo.world.s.keywords.selected).toEqual({});
    expect(browserStorage('local').length).toBe(0);
    expect(browserStorage('session').length).toBe(0);
    await waitFor(() => expect(queryClient.getQueryData(['x'])).toBeUndefined());
  });
});
