/**
 * 라쿠텐 연동 상수(PRD §8.2 RK-01·RK-04, P2-02). 설정으로 바꾸지 않는 값만 둔다(주소·건수·캐시 시간·재시도 수는 설정
 * `sourcing.rakutenApi`). M0 S2 전 가정은 여기와 sourcing/page-json.constants.ts 두 곳에만 둔다.
 */

/**
 * Item Search 고정 파라미터(PRD §8.2 RK-01 '기본 파라미터'): 가격 낮은순, 재고 있음, 이미지 있음, 검색 대상 넓게(field=1),
 * JSON 평탄형(formatVersion=2), 일반 구매(purchaseType=0), PC(carrier=0)
 */
export const RAKUTEN_SEARCH_FIXED_PARAMS = {
  sort: '+itemPrice',
  availability: '1',
  imageFlag: '1',
  field: '1',
  formatVersion: '2',
  purchaseType: '0',
  carrier: '0',
} as const;

/** 요청 URL에만 넣는 키 파라미터 이름. 캐시 사본·해시·call_log에는 남기지 않는다(NFR-02, ck_rsc_no_secret) */
export const RAKUTEN_KEY_PARAM_NAMES = ['applicationId', 'accessKey'] as const;

/** 429·503은 HTTP 상태 코드로 판정해 다시 보낸다(PRD §8.2 '지수 백오프 최대 3회') */
export const RAKUTEN_RETRY_STATUSES: readonly number[] = [429, 503];

/** 지수 백오프 첫 대기(ms, Proposed): 2·4·8초. 관문의 1.5초 간격과 별개로 더 기다린다 */
export const RAKUTEN_RETRY_BASE_MS = 2000;

/** 점검·삭제 페이지 표시 글(F-SO-14): HTTP 200이어도 이 글이 있으면 실패로 본다 */
export const RAKUTEN_MAINTENANCE_MARKER = 'ページが表示できません';

/** 상품 페이지 인코딩(PRD §8.2 RK-04). response.text()는 UTF-8로 풀어 깨지므로 바이트를 이 이름으로 푼다 */
export const RAKUTEN_PAGE_ENCODING = 'euc-jp';
