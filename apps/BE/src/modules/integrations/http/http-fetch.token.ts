/**
 * 외부 HTTP를 보내는 함수(주입 토큰). 기본은 전역 fetch다.
 * 테스트는 `overrideProvider(HTTP_FETCH).useValue(fake)`로 가짜를 끼운다(Jest ESM은 jest.mock을 못 쓴다).
 * ExternalHttpGateway만 이 토큰을 쓴다. 다른 코드는 fetch를 직접 부르지 않는다.
 */
export type HttpFetch = (url: string, init: RequestInit) => Promise<Response>;

export const HTTP_FETCH = Symbol('HTTP_FETCH');

export const defaultHttpFetch: HttpFetch = (url, init) => fetch(url, init);
