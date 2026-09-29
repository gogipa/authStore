import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { queryClient as defaultQueryClient } from '@/shared/api/queryClient';

interface AppProvidersProps {
  children: ReactNode;
  /** 테스트에서 따로 만든 QueryClient를 넣을 때 쓴다. */
  queryClient?: QueryClient;
}

export function AppProviders({ children, queryClient = defaultQueryClient }: AppProvidersProps) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
