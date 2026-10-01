/**
 * 커머스API 상품 등록·판매자관리코드 조회 포트(P4-03 — PRD §8.7 '등록 호출 순서' 5·6, RG-09·RG-12, F-AP-26·30·31·36). ⑨ registration
 * 모듈이 이것으로만 상품을 등록하고 SELLER_CODE로 찾는다(03-ADR-003 — 외부 호출은 integrations 포트로만).
 * - `createProduct(body)`: `POST /v2/products`. 결과를 세 가지로 나눈다(던지지 않는다 — 등록 기록이 결과를 그대로 남긴다):
 *   `SUCCESS`(2xx — 원상품·채널 상품 번호), `CLIENT_ERROR`(4xx — 오류 코드·`invalidInputs`, 등록되지 않았다), `UNKNOWN`(타임아웃·5xx·
 *   연결 오류·읽을 수 없는 2xx — 등록됐는지 모른다 → 결과확인필요). 자동으로 다시 보내지 않는다(멱등 — 401 재발급 뒤 다시 보내기도 끈다).
 * - `searchProductsBySellerCode(code)`: `POST /v1/products/search`(`searchKeywordType=SELLER_CODE`). 찾으면 상품 번호, 없으면 null.
 *   실패는 던진다(502 `EXTERNAL_API_ERROR`·`COMMERCE_AUTH_FAILED`, 키 없음 409 `SECRET_NOT_CONFIGURED`).
 * 둘 다 P1-07 `CommerceApiClient`(토큰은 `Authorization` 헤더에만)와 P1-01 관문(`call_log.target=COMMERCE_API`, Trace-ID)을 지난다.
 * 응답 모양·검색 본문 필드·channelProductNo를 검색으로 얻는지는 **M0 S3 전 가정**이다(어댑터 주석·fixture `test/fixtures/registration/
 * register` — ERD §7.3-5·6).
 */
export const COMMERCE_PRODUCTS_PORT = Symbol('COMMERCE_PRODUCTS_PORT');

/** 상품 등록 경로 */
export const COMMERCE_CREATE_PRODUCT_PATH = '/v2/products';
/** 상품 목록 조회(판매자관리코드 검색) 경로 */
export const COMMERCE_PRODUCT_SEARCH_PATH = '/v1/products/search';

/** 호출 기록 문맥(call_log.candidate_id·step_run_id) */
export interface CommerceProductsCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
}

/** 4xx `invalidInputs` 한 줄(원문) */
export interface CommerceProductInvalidInput {
  name: string | null;
  type: string | null;
  message: string | null;
}

/** `createProduct` 결과(세 가지 — 던지지 않는다) */
export type CreateProductResult =
  | {
      kind: 'SUCCESS';
      httpStatus: number;
      /** 원상품 번호(int64 — 숫자 글자) */
      originProductNo: string;
      /** 스마트스토어 채널 상품 번호(숫자 글자). 응답에 없으면 null */
      channelProductNo: string | null;
      traceId: string | null;
    }
  | {
      kind: 'CLIENT_ERROR';
      /** 400~499(인증 실패로 보내지 못했으면 그 4xx) */
      httpStatus: number;
      /** 커머스API 오류 코드(본문 `code`, 없으면 `HTTP_<상태>`) */
      errorCode: string;
      /** 커머스API 오류 문구 원문(번역 전) */
      errorMessage: string | null;
      invalidInputs: CommerceProductInvalidInput[];
      traceId: string | null;
    }
  | {
      kind: 'UNKNOWN';
      /** 5xx·읽을 수 없는 2xx면 그 상태, 응답이 없으면 null */
      httpStatus: number | null;
      /** `HTTP_<상태>`·`TIMEOUT`·`NETWORK_ERROR`·`INVALID_RESPONSE`·그 밖의 오류 코드 */
      errorCode: string;
      traceId: string | null;
    };

/** 판매자관리코드로 찾은 상품 */
export interface SellerCodeProduct {
  originProductNo: string;
  /** 검색 응답에 채널 상품 번호가 없으면 null(ERD §7.3-6 ⚠️) */
  channelProductNo: string | null;
}

export interface SellerCodeSearchResult {
  /** 찾은 상품(여럿이면 판매자관리코드가 정확히 같은 첫 줄). 없으면 null */
  product: SellerCodeProduct | null;
  traceId: string | null;
}

export interface CommerceProductsPort {
  /** 상품 등록(한 번만 보낸다). `timeoutMs`는 설정 `registration.requestTimeoutSeconds`(Proposed) */
  createProduct(
    body: unknown,
    context: CommerceProductsCallContext & { timeoutMs: number },
  ): Promise<CreateProductResult>;
  /** 판매자관리코드(SELLER_CODE) 검색 */
  searchProductsBySellerCode(
    sellerManagementCode: string,
    context?: CommerceProductsCallContext,
  ): Promise<SellerCodeSearchResult>;
}
