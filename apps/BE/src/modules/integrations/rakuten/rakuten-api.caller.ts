import { ApiException } from '../../../common/errors/api.exception.js';
import type { Clock } from '../http/clock.token.js';
import type { ExternalHttpGateway } from '../http/external-http.gateway.js';
import {
  mapRakutenApiError,
  RAKUTEN_API_ERROR_MESSAGES,
  RakutenApiError,
} from './rakuten-api-error.mapper.js';
import { RAKUTEN_RETRY_BASE_MS, RAKUTEN_RETRY_STATUSES } from './rakuten.constants.js';
import type { RakutenApiCallContext } from './rakuten-search.port.js';

export interface RakutenApiCallOptions {
  /** 429·503 다시 보내기 최대 횟수(설정 sourcing.rakutenApi.maxRetries, 3) */
  maxRetries: number;
  /** 200 응답의 call_log 건수(item_count). 읽지 못하면 null */
  countItems?: (bodyText: string) => number | null;
}

/**
 * 라쿠텐 공식 API 한 번 부르기(Item Search·IchibaGenre 공통, P2-02 규칙 2·3).
 * - 관문 target=RAKUTEN_API(직렬·1.5초 간격·call_log·UA)
 * - 429·503은 **HTTP 상태 코드**로 판정해 2·4·8초(지수 백오프) 기다린 뒤 최대 `maxRetries`회 다시 보낸다
 * - 그 밖 2xx 아님(400·403 등)은 다시 보내지 않고 `RakutenApiError`(F-SO-03 코드·문구). call_log.error_code에도 같은 코드
 * - 200이면 본문 글자를 돌려준다. 응답 없음·시간 초과는 관문의 502 EXTERNAL_API_ERROR를 그대로 던진다
 */
export async function callRakutenApi(
  gateway: ExternalHttpGateway,
  clock: Clock,
  url: string,
  options: RakutenApiCallOptions,
  ctx: RakutenApiCallContext = {},
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    const res = await gateway.request(
      'RAKUTEN_API',
      { method: 'GET', url, headers: { Accept: 'application/json' } },
      {
        candidateId: ctx.candidateId ?? null,
        stepRunId: ctx.stepRunId ?? null,
        describeResponse: ({ status, body }) => {
          const text = body.toString('utf8');
          if (status >= 200 && status < 300) {
            return { itemCount: options.countItems?.(text) ?? null };
          }
          const info = mapRakutenApiError(status, text);
          return { errorCode: info.errorCode, errorMessage: info.message };
        },
      },
    );
    const bodyText = res.body.toString('utf8');
    if (res.status >= 200 && res.status < 300) return bodyText;
    if (RAKUTEN_RETRY_STATUSES.includes(res.status) && attempt < options.maxRetries) {
      await clock.sleep(RAKUTEN_RETRY_BASE_MS * 2 ** attempt);
      continue;
    }
    throw new RakutenApiError(mapRakutenApiError(res.status, bodyText));
  }
}

/** 200인데 읽을 수 없는 본문 */
export function invalidRakutenResponse(): RakutenApiError {
  return new RakutenApiError({
    errorCode: 'RAKUTEN_INVALID_RESPONSE',
    message: RAKUTEN_API_ERROR_MESSAGES.RAKUTEN_INVALID_RESPONSE,
    httpStatus: 200,
  });
}

/** 동기 API가 라쿠텐 API 실패를 알릴 때: 502 EXTERNAL_API_ERROR(details.target=RAKUTEN_API·reason=코드) */
export function rakutenApiErrorToException(error: RakutenApiError): ApiException {
  return new ApiException('EXTERNAL_API_ERROR', {
    message: error.userMessage,
    details: { target: 'RAKUTEN_API', reason: error.errorCode, httpStatus: error.httpStatus },
  });
}
