/**
 * 라쿠텐 Ichiba Item Search 포트(F-BS-34, PRD §8.2 RK-01). sourcing 모듈이 이 포트로만 Item Search를 부른다.
 * - 캐시를 먼저 본다(같은 검색 6시간, `rakuten_search_cache`). 적중하면 HTTP를 보내지 않고 키도 읽지 않는다
 * - 키는 키체인에서만 읽는다(없으면 409 SECRET_NOT_CONFIGURED). 요청 URL에만 넣고 캐시·해시·call_log에는 남기지 않는다
 * - 관문 target=RAKUTEN_API(직렬·1.5초 간격). 429·503은 지수 백오프로 최대 3회 다시 보내고, 그래도 실패하거나 다른 2xx 아님이면
 *   `RakutenApiError`(errorCode·한국어 문구, F-SO-03)를 던진다. 응답 없음·시간 초과는 관문의 502 EXTERNAL_API_ERROR
 * - 테스트는 `overrideProvider(RAKUTEN_SEARCH_PORT)`로 가짜 포트를 끼우거나, 가짜 fetch(HTTP_FETCH) 뒤에 가짜 라쿠텐을 둔다
 */
export const RAKUTEN_SEARCH_PORT = Symbol('RAKUTEN_SEARCH_PORT');

/** 검색 요청 하나 */
export interface RakutenSearchQuery {
  /** 검색어(keyword). itemCode 조회면 비운다 */
  keyword?: string | null;
  /** 샵 코드(shopCode, F-BS-37 식별자 보완) */
  shopCode?: string | null;
  /** 상품 코드(itemCode `샵코드:상품ID`, F-SO-07 장르 보완) */
  itemCode?: string | null;
  /** 1부터. 기본 1 */
  page?: number;
  /**
   * ② 소싱 검색 조건(설정 genreId·minPrice·NGKeyword와 가격 낮은순·재고·이미지 있음)을 붙이는가. 기본 true.
   * 식별자·장르 보완 조회(itemCode·샵 코드 조회)는 false — 그 상품을 찾는 것이 목적이라 거르지 않는다
   */
  sourcingFilters?: boolean;
}

/** 응답 Items 한 건(formatVersion=2 평탄형). 쓰는 필드만 꺼내고 원문은 `raw`에 둔다 */
export interface RakutenSearchItem {
  itemCode: string;
  itemName: string;
  itemUrl: string;
  shopCode: string;
  shopName: string | null;
  itemPrice: number | null;
  /** 구매 가능 SKU 최저가(F-SO-12 1차 순위). 없으면 null */
  itemPriceMin3: number | null;
  pointRate: number | null;
  /** 0 = 송료 포함·무료 */
  postageFlag: number | null;
  reviewCount: number | null;
  reviewAverage: number | null;
  shipOverseasFlag: number | null;
  genreId: number | null;
  raw: Record<string, unknown>;
}

export interface RakutenSearchResult {
  items: RakutenSearchItem[];
  page: number;
  /** 응답 전체 건수(count). 캐시 적중이면 null(캐시는 Items만 둔다) */
  totalCount: number | null;
  /** API 호출 시각(캐시 적중이면 캐시의 fetched_at) — 비교표 행 api_collected_at */
  fetchedAt: Date;
  fromCache: boolean;
  /** 캐시 키(키 정렬 JSON, page 포함, 비밀값 제외의 SHA-256) */
  queryHash: string;
}

export interface RakutenApiCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
}

export interface RakutenSearchPort {
  search(query: RakutenSearchQuery, ctx?: RakutenApiCallContext): Promise<RakutenSearchResult>;
}
