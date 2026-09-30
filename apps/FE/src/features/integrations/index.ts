/**
 * integrations 도메인(OpenAPI 태그 `integrations`)의 공개 API. 밖에서는 `@/features/integrations`로만 가져온다.
 * P1-02: 오늘 외부 조회 현황(getCallUsage). 나머지 연산(call-logs 등)은 SCR-11 화면을 만드는 문서가 더한다.
 * P1-08: 메타데이터 동기화 상태·지금 동기화(MetaSyncPanel)와 주소록·반품 택배사 캐시 훅(P1-09 프로필이 쓴다).
 *   카테고리·원산지 훅은 쓰는 작업(P2-06·P3-04)이 여기에 더한다.
 */
export { callUsageQueryKey, useCallUsageQuery } from './api/useCallUsageQuery';
export { findCallUsage, formatUsageCount } from './model/callUsage';
export type { CallLogTarget, CallUsageByTarget, CallUsageList } from './model/callUsage';
export {
  commerceMetaSyncStatusQueryKey,
  useCommerceMetaSyncStatusQuery,
  useStartCommerceMetaSyncMutation,
} from './api/commerceMetaSync';
export {
  commerceAddressbooksQueryKey,
  commerceReturnDeliveryCompaniesQueryKey,
  useCommerceAddressbooksQuery,
  useCommerceReturnDeliveryCompaniesQuery,
} from './api/commerceCaches';
export type {
  CommerceAddressbooksParams,
  CommerceReturnDeliveryCompaniesParams,
} from './api/commerceCaches';
export {
  hasRunningMetaSync,
  lastMetaSyncSuccess,
  META_SYNC_ROW_GROUPS,
  META_SYNC_STATE_CHIP,
  META_SYNC_TARGET_LABEL,
  META_SYNC_TARGETS,
  metaSyncRows,
  metaSyncTargetView,
} from './model/metaSyncRows';
export type {
  CommerceMetaSyncRun,
  CommerceMetaSyncStatusList,
  CommerceMetaSyncTarget,
  CommerceMetaSyncTargetStatus,
  MetaSyncRowView,
  MetaSyncState,
  MetaSyncTargetView,
} from './model/metaSyncRows';
export { MetaSyncPanel, META_SYNC_RUNNING_REASON } from './components/MetaSyncPanel/MetaSyncPanel';
export type { MetaSyncPanelProps } from './components/MetaSyncPanel/MetaSyncPanel';
