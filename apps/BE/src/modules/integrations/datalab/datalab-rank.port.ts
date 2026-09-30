/**
 * 데이터랩 인기검색어 순위 요청 포트(F-BS-33, PRD §8.1). keywords 모듈이 이 포트로만 데이터랩을 부른다.
 * 응답 해석(정상·끝·이상 분류)은 keywords가 한다(`keywords/datalab-response.ts`). 포트는 받은 그대로 돌려준다.
 *
 * - 한 요청에 cid 하나. 콤마가 든 cid는 어댑터가 **호출 전에** `DatalabCidError`로 막는다(여러 cid를 묶으면 가장 작은
 *   cid 결과만 오류 없이 오기 때문 — PRD §8.1)
 * - 403·418·429도 예외가 아니라 응답으로 돌려준다(관문이 이미 24시간 쉼을 기록했다). 쉼 중이라 보내지 못했거나(409),
 *   하루 상한(409)·연결 실패(502)는 관문의 ApiException을 그대로 던진다
 * - 테스트는 `overrideProvider(DATALAB_RANK_PORT)`로 가짜 포트를 끼우거나, 가짜 fetch(HTTP_FETCH) 뒤에 가짜 데이터랩을 둔다
 */
export const DATALAB_RANK_PORT = Symbol('DATALAB_RANK_PORT');

/** 순위 요청 한 페이지. 날짜는 'YYYY-MM-DD'(M0 S4에서 확정) */
export interface DatalabRankPageRequest {
  cid: string;
  startDate: string;
  endDate: string;
  /** 1부터 */
  page: number;
}

/** 받은 응답 그대로(본문은 UTF-8 글자) */
export interface DatalabRankPageResponse {
  httpStatus: number;
  /** Content-Type 헤더(없으면 null). 데이터랩은 text/html로 JSON을 준다 */
  contentType: string | null;
  bodyText: string;
}

/** call_log 결과 열(error_code·item_count)을 응답에서 뽑는 함수(해석은 부르는 쪽이 한다) */
export type DatalabResponseDescriber = (response: DatalabRankPageResponse) => {
  errorCode?: string | null;
  itemCount?: number | null;
};

export interface DatalabRankFetchOptions {
  describe?: DatalabResponseDescriber;
}

export interface DatalabRankPort {
  fetchRankPage(
    request: DatalabRankPageRequest,
    options?: DatalabRankFetchOptions,
  ): Promise<DatalabRankPageResponse>;
}

/** 콤마가 든(여러 개를 묶은) cid·숫자가 아닌 cid. 호출하지 않고 던진다(앱 코드의 잘못) */
export class DatalabCidError extends Error {
  constructor(readonly cid: string) {
    super(`데이터랩 요청에는 cid를 하나만 넣습니다(받은 값: ${cid})`);
    this.name = 'DatalabCidError';
  }
}

/** cid 하나(숫자 1~16자리)인지 검사한다. 콤마로 묶은 값은 던진다 */
export function assertSingleCid(cid: string): void {
  if (!/^[0-9]{1,16}$/.test(cid)) throw new DatalabCidError(cid);
}
