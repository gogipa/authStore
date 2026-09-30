import { Injectable } from '@nestjs/common';
import { ExternalHttpGateway } from '../http/external-http.gateway.js';
import { parseCommerceErrorBody } from './commerce-error.js';

export type CommerceHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** 커머스API로 보낼 요청 한 건(주소는 완성된 https URL) */
export interface CommerceHttpRequest {
  method: CommerceHttpMethod;
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array | FormData;
  timeoutMs?: number;
}

export interface CommerceCallContext {
  candidateId?: number | null;
  stepRunId?: number | null;
}

/** 받은 응답(2xx가 아니어도 그대로). callLogId는 관문이 남긴 call_log 행(가짜는 null일 수 있다) */
export interface CommerceHttpResponse {
  status: number;
  headers: Headers;
  body: Buffer;
  callLogId: number | null;
}

/**
 * 커머스API 전송 포트(P1-07). 실제 구현은 P1-01 외부 호출 관문(허용 목록·정직한 UA·call_log) 위의 fetch다.
 * 테스트는 fixture를 돌려주는 가짜로 바꾼다(test/support/fake-commerce-transport.ts).
 * 연결 실패·응답 없음은 502 `EXTERNAL_API_ERROR`(ApiException)로 던진다. 2xx가 아닌 응답은 던지지 않는다.
 */
export interface CommerceTransport {
  send(req: CommerceHttpRequest, ctx?: CommerceCallContext): Promise<CommerceHttpResponse>;
}

export const COMMERCE_TRANSPORT = Symbol('COMMERCE_TRANSPORT');

/**
 * 관문을 지나는 실제 전송. 응답 본문의 커머스 오류 `code`(GW.AUTHN, GW.IP_NOT_ALLOWED …)·`message`를
 * call_log.error_code·error_message로 남기고, `GNCP-GW-Trace-ID`는 관문이 trace_id로 남긴다.
 */
@Injectable()
export class GatewayCommerceTransport implements CommerceTransport {
  constructor(private readonly gateway: ExternalHttpGateway) {}

  async send(
    req: CommerceHttpRequest,
    ctx: CommerceCallContext = {},
  ): Promise<CommerceHttpResponse> {
    const res = await this.gateway.request(
      'COMMERCE_API',
      {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: req.body as RequestInit['body'],
        timeoutMs: req.timeoutMs,
      },
      {
        candidateId: ctx.candidateId,
        stepRunId: ctx.stepRunId,
        describeResponse: ({ status, body }) => {
          if (status >= 200 && status < 300) return undefined;
          const err = parseCommerceErrorBody(body);
          return { errorCode: err.code, errorMessage: err.message };
        },
      },
    );
    return { status: res.status, headers: res.headers, body: res.body, callLogId: res.callLogId };
  }
}
