import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { DEMO_TEXT } from '@/features/guide';
import { applyProgressEvent } from '@/shared/api/events';
import { browserStorage } from '@/shared/lib/browserStorage';
import { DemoContext, type DemoInfo } from '@/shared/lib/demo';
import type { DemoWorld } from './demoWorld';

export interface DemoProvidersProps {
  children: ReactNode;
  /** 체험 전용 QueryClient(보통 앱 캐시와 섞이지 않게 따로) */
  queryClient: QueryClient;
  /** 따라 하기 모델(`createDemoApi().world`) */
  world: DemoWorld;
}

/** 브라우저 저장소(체험은 메모리)를 비운다 — 처음부터 다시 하면 '다시 보지 않기'·설정 마법사 표시도 처음 그대로 */
function clearMemoryStorage(): void {
  for (const kind of ['local', 'session'] as const) {
    try {
      browserStorage(kind).clear();
    } catch {
      // 저장소를 못 쓰는 환경이면 지울 것도 없다
    }
  }
}

/**
 * 체험 공급자(D-31·D-32): 체험 표시(`DemoContext` — 띠·탭 제목·입구 숨김·바깥 링크 끄기·따라 하기 진행) + 따로 만든 QueryClient.
 * 진행 알림 연결(EventSource)은 열지 않는다(서버가 없다). 그 자리를 모델이 대신한다:
 * - 모델이 내보내는 알림(수집 진행 등)을 같은 무효화 표·구독자에 적용한다(`applyProgressEvent`)
 * - 모델이 바뀔 때마다(누른 일·지연 뒤 결과) 모든 조회를 다시 읽게 한다 — 실제 앱에서 SSE가 하던 일
 * 데이터는 `installApiRuntime`이 바꾼 모델 전송에서 온다(startDemo).
 */
export function DemoProviders({ children, queryClient, world }: DemoProvidersProps) {
  useEffect(() => {
    const offEvents = world.onEvent((name, data) => applyProgressEvent([queryClient], name, data));
    const offChanges = world.subscribe(() => void queryClient.invalidateQueries());
    return () => {
      offEvents();
      offChanges();
    };
  }, [world, queryClient]);

  const info = useMemo<DemoInfo>(
    () => ({
      externalLinkNote: DEMO_TEXT.externalLink,
      guide: {
        subscribe: world.subscribe,
        getSnapshot: world.progress,
        reset: () => {
          world.reset();
          clearMemoryStorage();
          void queryClient.resetQueries();
        },
      },
    }),
    [world, queryClient],
  );

  return (
    <DemoContext value={info}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </DemoContext>
  );
}
