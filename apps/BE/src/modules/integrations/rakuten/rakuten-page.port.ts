/**
 * 라쿠텐 상품 페이지 요청 포트(F-BS-36, PRD §8.2 RK-04). sourcing 모듈이 이 포트로만 상품 페이지를 받는다.
 * - 관문 target=RAKUTEN_PAGE: **직렬 큐 하나**, 3초 이상 간격, 앱 고유 UA, 보내기 직전 call_log 1행(실패도 하루 상한에 센다),
 *   하루 상한(설정 110, 409 DAILY_LIMIT_REACHED + Retry-After), 403·418·429면 곧바로 멈추고 24시간 쉰다(409
 *   EXTERNAL_CALL_COOLDOWN — 다시 보내지 않는다). 신규 소싱·URL 입구·재고 확인·재조회가 모두 이 큐를 쓴다
 * - 캐시하지 않는다(재조회는 늘 새로 받는다). 본문은 바이트 그대로 준다(EUC-JP — 푸는 것은 sourcing 파서)
 * - 테스트는 `overrideProvider(RAKUTEN_PAGE_PORT)`로 가짜 포트를 끼우거나 가짜 fetch 뒤에 가짜 라쿠텐을 둔다
 */
export const RAKUTEN_PAGE_PORT = Symbol('RAKUTEN_PAGE_PORT');

export interface RakutenPageResponse {
  httpStatus: number;
  /** 받은 바이트 그대로(원본 파일로 저장·해시한다) */
  bytes: Buffer;
  /** 요청 시작 시각(rakuten_item.collected_at) */
  fetchedAt: Date;
  callLogId: number;
}

export interface RakutenPageCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
}

export interface RakutenPagePort {
  fetchPage(url: string, ctx?: RakutenPageCallContext): Promise<RakutenPageResponse>;
}
