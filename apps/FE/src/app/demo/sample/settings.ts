import {
  aiCliCheck,
  aiCliCheckLatestList,
  aiEngineSettings,
  detectedOnly,
} from '@/test/fixtures/aiEngine';
import { callUsageList } from '@/test/fixtures/callUsage';
import {
  addressbookEntry,
  metaSyncStatusList,
  returnDeliveryCompanyEntry,
} from '@/test/fixtures/commerceMeta';
import { filledProfile } from '@/test/fixtures/purchaseAgencyProfile';
import { settingsView } from '@/test/fixtures/settings';
import { storageUsage } from '@/test/fixtures/storageUsage';
import { authStatus, secretStatusList } from '@/test/fixtures/system';
import { DEMO_IDS, MINUTES_AGO as M, type DemoClock } from './story';
import type { Accepted, Ok, Schema } from './types';
import { pageOf } from './util';

type AiCliCheck = Schema<'AiCliCheck'>;

/** 설정 파일(검사 통과 — 앱을 켤 때 읽음) */
export function settings(clock: DemoClock): Ok<'/settings'> {
  return {
    ...settingsView(),
    id: DEMO_IDS.settingsSnapshot,
    firstLoadedAt: clock.ago(M.appStarted),
    lastLoadedAt: clock.ago(M.appStarted),
  };
}

/** AI 엔진: Claude Code(sonnet) 선택 — 연결 테스트 통과 뒤 저장 */
export function aiEngine(clock: DemoClock): Ok<'/settings/ai-engine'> {
  return { ...aiEngineSettings(), updatedAt: clock.ago(M.aiEngineSaved) };
}

/**
 * AI CLI 점검 이력(최신순): 앱을 켤 때 감지(SKIPPED) → 오너가 Claude Code·agy 연결 테스트(통과). Codex는 설치하지 않았다.
 * agy는 썸네일 생성 도구(D-19)라 연결 테스트가 통과면 시작 준비 '썸네일 생성 도구'가 완료다.
 */
export function aiCliHistory(clock: DemoClock): AiCliCheck[] {
  const startup = clock.ago(M.appStarted);
  return [
    aiCliCheck({
      id: 106,
      engineCode: 'AGY',
      trigger: 'MANUAL',
      cliVersion: '1.2.9',
      authStatus: 'UNKNOWN',
      smokeStatus: 'PASSED',
      model: 'gemini-3.8-flash-medium',
      latencyMs: 9_800,
      checkedAt: clock.ago(M.aiTestAgy),
    }),
    aiCliCheck({
      id: 105,
      engineCode: 'CLAUDE',
      trigger: 'MANUAL',
      checkedAt: clock.ago(M.aiTestClaude),
    }),
    detectedOnly('CODEX', {
      id: 103,
      installed: false,
      binPath: null,
      cliVersion: null,
      versionSupported: null,
      authStatus: 'UNKNOWN',
      errorCode: 'NOT_INSTALLED',
      errorMessage: 'codex 명령을 찾지 못했습니다.',
      checkedAt: startup,
    }),
    detectedOnly('AGY', {
      id: 102,
      cliVersion: '1.2.9',
      authStatus: 'UNKNOWN',
      checkedAt: startup,
    }),
    detectedOnly('CLAUDE', { id: 101, checkedAt: startup }),
  ];
}

export function aiCliLatest(clock: DemoClock): Ok<'/ai-cli-checks/latest'> {
  const history = aiCliHistory(clock);
  const latestOf = (code: Schema<'AiEngineCode'>) =>
    history.find((row) => row.engineCode === code) ?? null;
  return aiCliCheckLatestList(
    { CLAUDE: latestOf('CLAUDE'), AGY: latestOf('AGY'), CODEX: latestOf('CODEX') },
    'CLAUDE',
  );
}

/**
 * AI 엔진 감지 접수(`POST /ai-cli-checks`, `smokeTest: false` — AI 엔진 화면을 열 때·[다시 감지]·시스템 상태 [다시 점검]. 호출 비용이
 * 없는 확인이다). 실제 앱은 202 뒤 엔진마다 SSE로 결과가 오지만 체험은 결과를 보내지 않는다 — 위 이력(Claude Code·agy 연결 테스트
 * 통과)이 그대로 최신 결과다. 연결 테스트(`smokeTest: true`)는 사용자가 누르는 실행이라 여기로 오지 않는다(demoApi — 403 체험 글).
 */
export function aiCliDetectAccepted(
  clock: DemoClock,
  request: Partial<Schema<'AiCliCheckRequest'>>,
): Accepted<'/ai-cli-checks'> {
  return {
    engineCodes: request.engineCodes?.length ? request.engineCodes : ['CLAUDE', 'AGY', 'CODEX'],
    smokeTest: false,
    trigger: request.trigger ?? 'MANUAL',
    status: 'RUNNING',
    acceptedAt: clock.ago(0),
  };
}

export function aiCliCheckPage(
  clock: DemoClock,
  query: { engineCode: string | null; page: number; size: number },
): Ok<'/ai-cli-checks'> {
  const rows = aiCliHistory(clock).filter((row) =>
    query.engineCode ? row.engineCode === query.engineCode : true,
  );
  return pageOf(rows, query.page, query.size);
}

/** 발송 택배사(예시 2개 — fixture의 '가짜 발송 택배사' 이름 대신 보기 좋은 이름) */
const DISPATCH_CODE = 'CJGLS';

/**
 * 구매대행 프로필(필수 10칸 모두 채움). 상호·A/S·수입자는 fixture 자리표시자(`[내 상호]` 등)이고, 보낼 때 예시 가게 값으로
 * 바뀐다(demoApi `fillShop` — sample/shop)
 */
export function purchaseAgencyProfile(clock: DemoClock): Ok<'/purchase-agency-profile'> {
  const at = clock.ago(M.profileSaved);
  return filledProfile({
    dispatchDeliveryCompanyCode: DISPATCH_CODE,
    createdAt: at,
    updatedAt: at,
  });
}

export function dispatchDeliveryCompanies(): Ok<'/dispatch-delivery-companies'> {
  return {
    items: [
      { code: DISPATCH_CODE, name: 'CJ대한통운', source: '체험 예시' },
      { code: 'HANJIN', name: '한진택배', source: '체험 예시' },
    ],
  };
}

/** 커머스API 주소록 캐시: 해외 출고지(1) · 국내 반품지(2) */
export function commerceAddressbooks(
  clock: DemoClock,
  query: { overseas: boolean | null; page: number; size: number },
): Ok<'/commerce-addressbooks'> {
  const syncedAt = clock.ago(M.metaSynced);
  const all = [
    addressbookEntry({ id: 1, syncedAt }),
    addressbookEntry({
      id: 2,
      addressBookNo: '100000002',
      name: '[반품지] 국내 반품·교환 주소',
      addressType: 'REFUND_OR_EXCHANGE',
      isOverseas: false,
      addressSummary: '[반품지 주소] [동·호수]',
      syncedAt,
    }),
  ];
  const rows = query.overseas === null ? all : all.filter((a) => a.isOverseas === query.overseas);
  return pageOf(rows, query.page, query.size);
}

export function commerceReturnDeliveryCompanies(
  clock: DemoClock,
  query: { page: number; size: number },
): Ok<'/commerce-return-delivery-companies'> {
  const syncedAt = clock.ago(M.metaSynced);
  return pageOf(
    [
      returnDeliveryCompanyEntry({ id: 1, syncedAt }),
      returnDeliveryCompanyEntry({ id: 2, code: 'HANJIN', name: '한진택배', syncedAt }),
    ],
    query.page,
    query.size,
  );
}

/** 커머스API 메타 동기화: 8개 대상 모두 성공 */
export function commerceMetaSyncLatest(clock: DemoClock): Ok<'/commerce-meta-sync-runs/latest'> {
  const list = metaSyncStatusList();
  const at = clock.ago(M.metaSynced);
  return {
    items: list.items.map((item, index) => ({
      ...item,
      latestRun: item.latestRun
        ? { ...item.latestRun, id: index + 1, startedAt: at, finishedAt: at }
        : null,
      lastSucceededAt: at,
    })),
  };
}

/** 비밀 키 6개 모두 저장됨 */
export function secrets(clock: DemoClock): Ok<'/secrets'> {
  const list = secretStatusList();
  return {
    items: list.items.map((item) => ({ ...item, updatedAt: clock.ago(M.secretsSaved) })),
  };
}

/** 커머스API 토큰: 발급 성공, 3시간 유효 */
export function commerceAuthStatus(clock: DemoClock): Ok<'/auth-status'> {
  return authStatus({
    lastCheckedAt: clock.ago(M.authChecked),
    tokenExpiresAt: clock.ago(M.authChecked - 180),
    lastTraceId: 'demo-trace-token-200',
  });
}

export function storage(clock: DemoClock): Ok<'/storage-usage'> {
  return storageUsage({ measuredAt: clock.ago(M.storageMeasured) });
}

/** 오늘 외부 호출 수(따라 하기가 늘린다 — 빈 상태에서는 모두 0) */
export interface CallUsageCounts {
  /** 데이터랩 요청 수(수집 한 번 = 페이지 10) */
  datalab: number;
  /** 라쿠텐 검색 API 호출 수 */
  rakutenApi: number;
  /** 라쿠텐 상품 페이지 조회 수(② 비교표 검증 행) */
  rakutenPage: number;
  /** 커머스API 호출 수(토큰·메타 동기화·이미지 업로드·등록) */
  commerce: number;
}

/**
 * 오늘 외부 호출 수(한국 날짜). 앱을 켜기 전에 한 커머스API 호출(토큰·메타 동기화)만 처음부터 있고, 나머지는 따라 하기에서
 * 단계를 할 때마다 늘어난다.
 */
export function callUsage(clock: DemoClock, counts: CallUsageCounts): Ok<'/call-usage'> {
  const kstDate = clock.kstDate();
  const base = callUsageList(counts.rakutenPage);
  return {
    items: base.items.map((item) => {
      switch (item.target) {
        case 'COMMERCE_API':
          return { ...item, kstDate, count: counts.commerce };
        case 'RAKUTEN_API':
          return { ...item, kstDate, count: counts.rakutenApi };
        case 'RAKUTEN_PAGE':
          return {
            ...item,
            kstDate,
            countsByFetchReason: {
              SOURCING: counts.rakutenPage,
              URL_ENTRY: 0,
              STOCK_CHECK: 0,
              REFETCH: 0,
              SYNC: 0,
            },
          };
        case 'DATALAB':
          return {
            ...item,
            kstDate,
            count: counts.datalab,
            remaining: (item.dailyLimit ?? 0) - counts.datalab,
          };
        default:
          return { ...item, kstDate };
      }
    }),
  };
}
