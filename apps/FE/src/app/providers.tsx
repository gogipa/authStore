import { QueryClientProvider, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { connectProgressEvents, type EventSourceFactory } from '@/shared/api/events';
import { queryClient as defaultQueryClient } from '@/shared/api/queryClient';

export interface ProgressEventsProviderProps {
  children: ReactNode;
  /** 테스트에서 가짜 EventSource(src/test/fakeEventSource.ts)를 넣는다. 기본은 브라우저 EventSource. */
  EventSourceImpl?: EventSourceFactory;
  /** 브라우저가 다시 붙기를 포기했을 때 새 연결을 여는 간격(ms). 기본은 events.ts의 값. */
  reconnectDelaysMs?: readonly number[];
}

/**
 * 진행 알림(SSE) 구독(03-2 §6.3). 마운트할 때 `/api/v1/events`에 붙고 언마운트할 때 닫는다.
 * 앱 전체에서 연결은 하나다: 이 공급자가 여러 개여도 `connectProgressEvents`가 연결을 나눠 쓴다.
 * 이벤트는 관련 쿼리를 무효화만 한다(캐시에 값을 쓰지 않는다).
 */
export function ProgressEventsProvider({
  children,
  EventSourceImpl,
  reconnectDelaysMs,
}: ProgressEventsProviderProps) {
  const queryClient = useQueryClient();
  useEffect(
    () => connectProgressEvents(queryClient, { EventSourceImpl, reconnectDelaysMs }),
    [queryClient, EventSourceImpl, reconnectDelaysMs],
  );
  return children;
}

interface AppProvidersProps {
  children: ReactNode;
  /** 테스트에서 따로 만든 QueryClient를 넣을 때 쓴다. */
  queryClient?: QueryClient;
  /** 테스트에서 가짜 EventSource를 넣을 때 쓴다. */
  EventSourceImpl?: EventSourceFactory;
}

/** 앱 공급자: 서버 값은 TanStack Query에만 둔다(전역 클라이언트 스토어 없음, 03-2 §6.1). */
export function AppProviders({
  children,
  queryClient = defaultQueryClient,
  EventSourceImpl,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ProgressEventsProvider EventSourceImpl={EventSourceImpl}>{children}</ProgressEventsProvider>
    </QueryClientProvider>
  );
}
