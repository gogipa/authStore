import { isApiError, type ApiError } from './client';

/**
 * FE가 스스로 만드는 오류 코드(05-3에 없다, BE는 보내지 않는다). Proposed(06-3 §9).
 * - UNEXPECTED_RESPONSE: 응답이 05-3 오류 봉투가 아니다(개발 프록시의 502 HTML, 빈 본문 등).
 * - NETWORK_ERROR: 응답을 받지 못했다(앱 서버가 꺼짐, 연결 끊김).
 */
export const CLIENT_ERROR_CODES = {
  UNEXPECTED_RESPONSE: 'UNEXPECTED_RESPONSE',
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

/** 서버 오류 응답 하나. 화면은 `code`로 갈라 처리하고 `message`를 그대로 보여 준다(05-3 §2). */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly envelope: ApiError;
  /** false면 봉투를 FE가 만들었다(서버가 봉투를 보내지 않음, CLIENT_ERROR_CODES). */
  readonly fromServer: boolean;

  constructor(envelope: ApiError, options: { fromServer?: boolean; cause?: unknown } = {}) {
    super(envelope.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiRequestError';
    this.status = envelope.status;
    this.code = envelope.code;
    this.envelope = envelope;
    this.fromServer = options.fromServer ?? true;
  }
}

export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError;
}

/** openapi-fetch 결과 모양({ data, error, response }). */
export interface FetchResultLike<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

function pathOf(response: Response): string {
  try {
    return new URL(response.url).pathname;
  } catch {
    return response.url;
  }
}

/** 봉투가 아닌 오류 응답을 봉투 모양으로 바꾼다. 문구는 화면에 그대로 보인다. */
function syntheticEnvelope(response: Response): ApiError {
  const gatewayDown = response.status === 502 || response.status === 503 || response.status === 504;
  return {
    code: CLIENT_ERROR_CODES.UNEXPECTED_RESPONSE,
    message: gatewayDown
      ? `앱 서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인하세요. (HTTP ${response.status})`
      : `서버 응답을 읽지 못했습니다. (HTTP ${response.status})`,
    status: response.status,
    timestamp: new Date().toISOString(),
    path: pathOf(response),
  };
}

/**
 * openapi-fetch 결과에서 값을 꺼낸다. 2xx가 아니면 `ApiRequestError`를 던진다.
 * - 본문이 05-3 봉투면 그대로 쓴다(`code`·`status`·`message`가 봉투 값).
 * - 봉투가 아니면(프록시 502 HTML, 빈 본문) `UNEXPECTED_RESPONSE` 봉투를 만든다.
 * - 204처럼 본문이 없는 성공은 `undefined`를 돌려준다.
 */
export function unwrap<T>(result: FetchResultLike<T>): T {
  const { response } = result;
  if (response.ok) return result.data as T;
  if (isApiError(result.error)) throw new ApiRequestError(result.error);
  throw new ApiRequestError(syntheticEnvelope(response), { fromServer: false });
}

/**
 * 어떤 오류든 `ApiRequestError`로 바꾼다. fetch 자체가 실패한 경우(TypeError 등)는 `NETWORK_ERROR`다.
 * 훅의 queryFn에서 `api.GET(...)`이 던진 오류를 화면이 한 모양으로 다루게 한다.
 */
export function toApiRequestError(error: unknown, path = ''): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  return new ApiRequestError(
    {
      code: CLIENT_ERROR_CODES.NETWORK_ERROR,
      message: '앱 서버에 연결하지 못했습니다. 서버가 켜져 있는지 확인하세요.',
      status: 0,
      timestamp: new Date().toISOString(),
      path,
    },
    { fromServer: false, cause: error },
  );
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Error).name === 'AbortError';
}

/**
 * openapi-fetch 호출 하나를 부르고 결과를 풀어 준다. 연결 실패도 `ApiRequestError`로 바꾼다.
 * 취소(AbortError, Query가 signal로 끊음)는 그대로 던진다.
 */
export async function request<T>(call: () => Promise<FetchResultLike<T>>): Promise<T> {
  let result: FetchResultLike<T>;
  try {
    result = await call();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw toApiRequestError(error);
  }
  return unwrap(result);
}
