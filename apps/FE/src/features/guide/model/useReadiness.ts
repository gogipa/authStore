import { useRegistrationSwitch } from '@/features/registration';
import { usePurchaseAgencyProfileQuery } from '@/features/settings';
import {
  AI_CLI_HISTORY_SIZE,
  useAiCliChecksQuery,
  useLatestAiCliChecksQuery,
  useSecretsQuery,
} from '@/features/system';
import {
  readinessItems,
  readinessProgress,
  type QueryResult,
  type ReadinessItemView,
} from './readiness';

function result<T>(query: {
  data: T | undefined;
  error: { message: string } | null;
}): QueryResult<T> {
  return { data: query.data, error: query.error ? query.error.message : null };
}

export interface Readiness {
  /** 센 항목 5개(content.ts `READINESS_ITEM_KEYS` 순서) */
  items: ReadinessItemView[];
  done: number;
  total: number;
  allDone: boolean;
  /** 받는 중인 항목이 있다 */
  loading: boolean;
  /** 아직 남은 일이 있다: 센 항목 중 '할 일'이나 '확인 못함'이 하나라도(대시보드 카드의 [설정 마법사]를 보인다) */
  remaining: boolean;
  /** 등록 API 차단(세지 않는 참고 줄). 받는 중·실패면 undefined */
  apiBlocked: boolean | undefined;
}

/**
 * 시작 준비(D-29) 상태: 대시보드 '시작 준비' 카드(F-DB-10)와 설정 마법사(F-GD-04)가 같이 쓴다.
 * 이미 있는 M1 조회만 읽는다(`GET /secrets`·`/ai-cli-checks/latest`·`/ai-cli-checks`·`/purchase-agency-profile`·
 * `/registration-switch`). 감지·연결 테스트 같은 점검을 새로 돌리지 않는다.
 */
export function useReadiness(): Readiness {
  const secrets = useSecretsQuery();
  const aiLatest = useLatestAiCliChecksQuery();
  const aiHistory = useAiCliChecksQuery({ size: AI_CLI_HISTORY_SIZE });
  const profile = usePurchaseAgencyProfileQuery();
  const registrationSwitch = useRegistrationSwitch();

  const items = readinessItems({
    secrets: result(secrets),
    aiLatest: result(aiLatest),
    aiHistory: aiHistory.data?.content,
    profile: result(profile),
  });
  return {
    items,
    ...readinessProgress(items),
    loading: items.some((item) => item.state === 'loading'),
    remaining: items.some((item) => item.state === 'todo' || item.state === 'error'),
    apiBlocked: registrationSwitch.isError ? undefined : registrationSwitch.data?.apiBlocked,
  };
}
