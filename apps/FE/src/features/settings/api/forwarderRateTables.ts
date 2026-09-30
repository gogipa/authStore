import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/shared/api/client';
import { request } from '@/shared/api/errors';
import { qk } from '@/shared/api/queryKeys';
import type { operations } from '@/shared/api/schema';

export type ForwarderRateTablesParams = NonNullable<
  operations['listForwarderRateTables']['parameters']['query']
>;

/** settings 태그 요금표 queryKey. settings 태그라 `settings.reloaded`도 무효화한다 */
export const forwarderRateTablesKeys = {
  all: qk('settings', 'listForwarderRateTables'),
  list: (params: ForwarderRateTablesParams = {}) =>
    qk('settings', 'listForwarderRateTables', params),
  detailAll: qk('settings', 'getForwarderRateTable'),
  detail: (rateTableId: number) => qk('settings', 'getForwarderRateTable', { rateTableId }),
};

/** 요금표 버전 목록(`GET /forwarder-rate-tables`) */
export function useForwarderRateTablesQuery(params: ForwarderRateTablesParams = {}) {
  return useQuery({
    queryKey: forwarderRateTablesKeys.list(params),
    queryFn: ({ signal }) =>
      request(() => api.GET('/forwarder-rate-tables', { params: { query: params }, signal })),
  });
}

/** 요금표 버전 상세(구간 무게 오름차순). id가 없으면 부르지 않는다 */
export function useForwarderRateTableQuery(rateTableId: number | null | undefined) {
  return useQuery({
    queryKey: forwarderRateTablesKeys.detail(rateTableId ?? 0),
    enabled: typeof rateTableId === 'number' && rateTableId > 0,
    queryFn: ({ signal }) =>
      request(() =>
        api.GET('/forwarder-rate-tables/{rateTableId}', {
          params: { path: { rateTableId: rateTableId! } },
          signal,
        }),
      ),
  });
}

/**
 * 활성 요금표(목록 `active=true` 한 건 → 그 상세). 활성이 없으면 `table`이 null(판정은 기본 15,000원 가정값).
 */
export function useActiveForwarderRateTable() {
  const list = useForwarderRateTablesQuery({ active: true, size: 1 });
  const activeId = list.data?.content[0]?.id ?? null;
  const detail = useForwarderRateTableQuery(activeId);
  return {
    summary: list.data ? (list.data.content[0] ?? null) : undefined,
    table: activeId === null ? (list.data ? null : undefined) : detail.data,
    isPending: list.isPending || (activeId !== null && detail.isPending),
    error: list.error ?? detail.error ?? null,
  };
}

export interface ImportForwarderRateTableInput {
  file: File;
  forwarderName?: string;
}

/**
 * 요금표 CSV 가져오기(`POST /forwarder-rate-tables`, multipart `file`·`forwarderName`). 201 새 버전·200 같은 파일(reused).
 * 성공하면 응답 상세를 캐시에 넣고 목록을 다시 읽는다. 재실행 필요가 생겼으면 step-engine 태그도 다시 읽는다.
 * 실패: 413 `PAYLOAD_TOO_LARGE`, 422 `IMPORT_PARSE_FAILED`(fieldErrors row{줄}.{열})·`IMPORT_EMPTY`·`UNSUPPORTED_FILE_TYPE`.
 */
export function useImportForwarderRateTableMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, forwarderName }: ImportForwarderRateTableInput) =>
      request(() =>
        api.POST('/forwarder-rate-tables', {
          body: { file: file.name, ...(forwarderName ? { forwarderName } : {}) },
          bodySerializer: () => {
            const form = new FormData();
            form.append('file', file, file.name);
            if (forwarderName) form.append('forwarderName', forwarderName);
            return form;
          },
        }),
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(
        forwarderRateTablesKeys.detail(result.rateTable.id),
        result.rateTable,
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: forwarderRateTablesKeys.all }),
        queryClient.invalidateQueries({ queryKey: forwarderRateTablesKeys.detailAll }),
        ...(result.rerunRequiredStepCount > 0
          ? [queryClient.invalidateQueries({ queryKey: ['step-engine'] })]
          : []),
      ]);
    },
  });
}
