import type { DemoWorld } from '../demoWorld';
import { accept, get, NOT_AVAILABLE, READ_ONLY, type DemoRoute } from '../router';
import {
  type CallUsageCounts,
  aiCliCheckPage,
  aiCliDetectAccepted,
  aiCliLatest,
  aiEngine,
  callUsage,
  commerceAddressbooks,
  commerceAuthStatus,
  commerceMetaSyncLatest,
  commerceReturnDeliveryCompanies,
  dispatchDeliveryCompanies,
  purchaseAgencyProfile,
  secrets,
  settings,
  storage,
} from '../sample/settings';
import {
  forwarderRateTable,
  forwarderRateTablePage,
  fxLatest,
  fxRatePage,
} from '../sample/pricing';
import { DEMO_IDS } from '../sample/story';
import type { Schema } from '../sample/types';
import { pageOf } from '../sample/util';
import { boolOf, intOf, pageQuery } from './query';

/** 오늘 외부 호출 수: 앱을 켜기 전 커머스API 호출 4건에서 시작해, 한 일만큼 늘어난다 */
function usageCounts(world: DemoWorld): CallUsageCounts {
  const s = world.s;
  const collected = Object.values(s.keywords.snapshot?.pagesDone ?? {}).reduce((a, b) => a + b, 0);
  const searches = s.steps.SOURCING.runs.filter((run) => run.status !== 'RUNNING').length;
  return {
    datalab: collected,
    rakutenApi: searches * 2,
    rakutenPage: s.sourcing.pageFetches,
    commerce:
      4 +
      (s.steps.UPLOAD.runs.length > 0 ? 2 : 0) +
      s.registration.records.filter((rec) => rec.status !== 'VALIDATED').length * 2 +
      s.registration.records.length,
  };
}

/**
 * 설정·시스템 상태·AI 엔진·환율 조회(체험을 켤 때 모두 '완료'인 예시, 따라 하기 동안 바뀌지 않는다 — 시작 준비가 5/5로 보인다).
 * 눌러서 바꾸는 설정(저장·연결 테스트·동기화 …)은 따라 하기 길이 아니라 403 체험 글이다.
 */
export const settingsRoutes: DemoRoute[] = [
  get('/settings', ({ world }) => settings(world.clock)),
  get('/settings/ai-engine', ({ world }) => aiEngine(world.clock)),
  get('/purchase-agency-profile', ({ world }) => purchaseAgencyProfile(world.clock)),
  get('/dispatch-delivery-companies', () => dispatchDeliveryCompanies()),
  get('/forwarder-rate-tables', ({ world, query }) => {
    const active = boolOf(query.get('active'));
    const all = forwarderRateTablePage(world.clock).content.filter((t) =>
      active === null ? true : t.isActive === active,
    );
    const { page, size } = pageQuery(query);
    return pageOf(all, page, size);
  }),
  get('/forwarder-rate-tables/{rateTableId}', ({ world, params }) => {
    return intOf(params.rateTableId, -1) === DEMO_IDS.forwarderRateTable
      ? forwarderRateTable(world.clock)
      : NOT_AVAILABLE;
  }),
  get('/commerce-addressbooks', ({ world, query }) =>
    commerceAddressbooks(world.clock, {
      overseas: boolOf(query.get('overseas')),
      ...pageQuery(query),
    }),
  ),
  get('/commerce-return-delivery-companies', ({ world, query }) =>
    commerceReturnDeliveryCompanies(world.clock, pageQuery(query)),
  ),
  get('/commerce-meta-sync-runs/latest', ({ world }) => commerceMetaSyncLatest(world.clock)),
  get('/secrets', ({ world }) => secrets(world.clock)),
  get('/auth-status', ({ world }) => commerceAuthStatus(world.clock)),
  get('/storage-usage', ({ world }) => storage(world.clock)),
  get('/ai-cli-checks/latest', ({ world }) => aiCliLatest(world.clock)),
  // AI 엔진 화면은 열 때 세 엔진을 감지한다(smokeTest false). 403이면 열자마자 저장 바에 체험 글이 뜬다 — 접수로 답하고, 결과는
  // 위 예시(연결 테스트 통과)가 그대로다. 연결 테스트(smokeTest true — 카드 [연결 테스트]·[저장])는 누르는 실행이라 체험 글
  accept('/ai-cli-checks', async ({ world, json }) => {
    const body = await json<Schema<'AiCliCheckRequest'>>();
    return body.smokeTest === false ? aiCliDetectAccepted(world.clock, body) : READ_ONLY;
  }),
  get('/ai-cli-checks', ({ world, query }) =>
    aiCliCheckPage(world.clock, { engineCode: query.get('engineCode'), ...pageQuery(query, 100) }),
  ),
  get('/call-usage', ({ world }) => callUsage(world.clock, usageCounts(world))),
  get('/fx-rates/latest', ({ world }) => fxLatest(world.clock)),
  get('/fx-rates', ({ world, query }) =>
    fxRatePage(world.clock, {
      rateKind: query.get('rateKind'),
      currency: query.get('currency'),
      size: pageQuery(query).size,
    }),
  ),
];
