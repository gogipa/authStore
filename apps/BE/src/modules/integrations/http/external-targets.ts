/**
 * 외부 호출 대상 표(GEN-01 허용 목록, F-BS-06). call_log.target 14종(ERD ck_call_log_target)마다 한 줄.
 * 표에 없는 호스트는 요청도 call_log 행도 만들지 않고 거부한다(ExternalHttpGateway).
 * - 환율 두 곳(P2-04, Proposed — 열린질문 P1-01): FX_KOREAEXIM = 한국수출입은행 환율 API(oapi.koreaexim.go.kr),
 *   FX_CUSTOMS = 공공데이터포털 관세청 관세환율(apis.data.go.kr). 둘 다 공식 API라 쉼·하루 상한이 없다.
 * - NOTICE_MONITOR·UPDATE_CHECK는 M2라 비워 둔다.
 * - AI_*_CLI는 HTTP가 아니라 하위 프로세스라 호스트가 없다(격리는 ai-engine/cli-isolation.ts).
 * - AI_GEMINI_API·AI_OPENAI_API(이미지 생성 대체 경로)는 P3-02에서 정한다.
 * - 라쿠텐 상품 이미지(P3-01, Proposed — 열린질문 P1-01·P3-01): RAKUTEN_IMAGE = 상품 페이지 JSON `media.images[]`·
 *   Item Search 이미지 URL의 CDN(tshop.r10s.jp·image.rakuten.co.jp·thumbnail.image.rakuten.co.jp). ⑤ 원본 이미지 받기만 쓴다.
 *   공개 정적 파일이라 비공식 수집(24시간 쉼)으로 보지 않고, 하루 상한도 없다(RAKUTEN_PAGE 110에 넣지 않는다). 대신 직렬
 *   큐·1초 간격으로 보낸다. 호스트는 M0 S2 실측 뒤 다시 본다. V3 마이그레이션이 CHECK에 값을 더했다(ERD v0.6).
 */

export const CALL_LOG_TARGETS = [
  'COMMERCE_API',
  'RAKUTEN_API',
  'RAKUTEN_PAGE',
  'RAKUTEN_IMAGE',
  'DATALAB',
  'FX_KOREAEXIM',
  'FX_CUSTOMS',
  'NOTICE_MONITOR',
  'UPDATE_CHECK',
  'AI_CLAUDE_CLI',
  'AI_AGY_CLI',
  'AI_CODEX_CLI',
  'AI_GEMINI_API',
  'AI_OPENAI_API',
] as const;
export type CallLogTarget = (typeof CALL_LOG_TARGETS)[number];

export function isCallLogTarget(value: unknown): value is CallLogTarget {
  return typeof value === 'string' && (CALL_LOG_TARGETS as readonly string[]).includes(value);
}

/** 하루 상한 이름. 값은 DAILY_LIMIT_PROVIDER가 준다(P1-03부터 설정 파일) */
export type DailyLimitKey = 'RAKUTEN_PAGE_PER_DAY' | 'DATALAB_PER_DAY';

export interface ExternalTargetSpec {
  /** 화면 문구용 이름(오류 message의 {대상}) */
  label: string;
  /** 허용 호스트(소문자, 정확히 일치). 비어 있으면 HTTP로 부르지 않는 대상 */
  hosts: readonly string[];
  /** 같은 대상 요청 사이 최소 간격(ms). 앞 요청이 끝난 때부터 잰다(Proposed, 06-2 §9) */
  minIntervalMs: number;
  /** 공식 API가 아닌 수집(데이터랩·라쿠텐 상품 페이지). 403·418·429면 24시간 쉰다(F-BS-10) */
  unofficial: boolean;
  /** 하루 상한이 있으면 그 이름(F-BS-09, RK-04) */
  dailyLimitKey?: DailyLimitKey;
  /** 호출하는 쪽이 넣을 수 있는 Referer 값(DATALAB만, PRD §8.1) */
  allowedReferer?: string;
}

/** 데이터랩 요청의 Referer(PRD §8.1, 없으면 404). 이 값만 허용한다 */
export const DATALAB_REFERER = 'https://datalab.naver.com/shoppingInsight/sCategory.naver';

export const EXTERNAL_TARGETS: Readonly<Record<CallLogTarget, ExternalTargetSpec>> = {
  COMMERCE_API: {
    label: '네이버 커머스API',
    hosts: ['api.commerce.naver.com'],
    minIntervalMs: 0,
    unofficial: false,
  },
  RAKUTEN_API: {
    label: '라쿠텐 API',
    // 구 도메인 app.rakuten.co.jp는 금지(PRD §8.2)
    hosts: ['openapi.rakuten.co.jp'],
    minIntervalMs: 1500,
    unofficial: false,
  },
  RAKUTEN_PAGE: {
    label: '라쿠텐 상품 페이지',
    hosts: ['item.rakuten.co.jp'],
    minIntervalMs: 3000,
    unofficial: true,
    dailyLimitKey: 'RAKUTEN_PAGE_PER_DAY',
  },
  RAKUTEN_IMAGE: {
    label: '라쿠텐 상품 이미지',
    // P3-01(Proposed): 페이지 JSON media.images[](tshop.r10s.jp·image.rakuten.co.jp)와 API 이미지(thumbnail.image.rakuten.co.jp)
    hosts: ['tshop.r10s.jp', 'image.rakuten.co.jp', 'thumbnail.image.rakuten.co.jp'],
    minIntervalMs: 1000,
    unofficial: false,
  },
  DATALAB: {
    label: '데이터랩',
    hosts: ['datalab.naver.com'],
    minIntervalMs: 2000,
    unofficial: true,
    dailyLimitKey: 'DATALAB_PER_DAY',
    allowedReferer: DATALAB_REFERER,
  },
  FX_KOREAEXIM: {
    label: '한국수출입은행 환율',
    hosts: ['oapi.koreaexim.go.kr'],
    minIntervalMs: 0,
    unofficial: false,
  },
  FX_CUSTOMS: {
    label: '관세청 관세환율',
    hosts: ['apis.data.go.kr'],
    minIntervalMs: 0,
    unofficial: false,
  },
  NOTICE_MONITOR: { label: '공지 모니터링', hosts: [], minIntervalMs: 0, unofficial: false },
  UPDATE_CHECK: { label: '새 버전 확인', hosts: [], minIntervalMs: 0, unofficial: false },
  AI_CLAUDE_CLI: { label: 'Claude Code', hosts: [], minIntervalMs: 0, unofficial: false },
  AI_AGY_CLI: { label: 'Antigravity CLI', hosts: [], minIntervalMs: 0, unofficial: false },
  AI_CODEX_CLI: { label: 'Codex', hosts: [], minIntervalMs: 0, unofficial: false },
  AI_GEMINI_API: { label: 'Gemini API', hosts: [], minIntervalMs: 0, unofficial: false },
  AI_OPENAI_API: { label: 'OpenAI API', hosts: [], minIntervalMs: 0, unofficial: false },
};

/** 모든 대상의 허용 호스트(F-BS-07 호스트 검사 테스트가 쓴다) */
export function allAllowedHosts(): ReadonlySet<string> {
  return new Set(Object.values(EXTERNAL_TARGETS).flatMap((t) => t.hosts));
}

/** 24시간 쉼을 일으키는 응답 코드(비공식 수집만, F-BS-10) */
export const COOLDOWN_HTTP_STATUSES: readonly number[] = [403, 418, 429];
/** 쉼 길이(기본 24시간) */
export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
