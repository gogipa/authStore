/**
 * 외부 호출 대상 표(GEN-01 허용 목록, F-BS-06). call_log.target 13종(ERD ck_call_log_target)마다 한 줄.
 * 표에 없는 호스트는 요청도 call_log 행도 만들지 않고 거부한다(ExternalHttpGateway).
 * - 환율 두 곳(FX_KOREAEXIM·FX_CUSTOMS)의 호스트는 P2-04에서 더한다.
 * - NOTICE_MONITOR·UPDATE_CHECK는 M2라 비워 둔다.
 * - AI_*_CLI는 HTTP가 아니라 하위 프로세스라 호스트가 없다(격리는 ai-engine/cli-isolation.ts).
 * - AI_GEMINI_API·AI_OPENAI_API(이미지 생성 대체 경로)는 P3-02에서 정한다.
 * - 라쿠텐 상품 이미지 호스트와 그 대상은 정하지 않았다(P3-01 전에 정한다, _열린질문 P1-01).
 */

export const CALL_LOG_TARGETS = [
  'COMMERCE_API',
  'RAKUTEN_API',
  'RAKUTEN_PAGE',
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
  DATALAB: {
    label: '데이터랩',
    hosts: ['datalab.naver.com'],
    minIntervalMs: 2000,
    unofficial: true,
    dailyLimitKey: 'DATALAB_PER_DAY',
    allowedReferer: DATALAB_REFERER,
  },
  FX_KOREAEXIM: { label: '한국수출입은행 환율', hosts: [], minIntervalMs: 0, unofficial: false },
  FX_CUSTOMS: { label: '관세청 관세환율', hosts: [], minIntervalMs: 0, unofficial: false },
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
