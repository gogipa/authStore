import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { SettingsService } from '../../settings/settings.service.js';
import { DATALAB_REFERER } from '../http/external-targets.js';
import { type ExternalHttpRequest, ExternalHttpGateway } from '../http/external-http.gateway.js';
import {
  assertSingleCid,
  type DatalabRankFetchOptions,
  type DatalabRankPageRequest,
  type DatalabRankPageResponse,
  type DatalabRankPort,
} from './datalab-rank.port.js';

/** 요청 조립에 쓰는 설정값(settings `keywords.datalab`) */
export interface DatalabRequestConfig {
  rankUrl: string;
  pageSize: number;
}

/**
 * 순위 요청 한 건을 만든다(PRD §8.1, P2-01 규칙 3). 순수 함수.
 * - `POST`, `application/x-www-form-urlencoded`, form `cid`·`timeUnit=date`·`startDate`·`endDate`·`age`·`gender`·`device`
 *   (M1은 빈 값 = 전체)·`page`·`count`(설정 pageSize, 기본 20)
 * - 헤더 `Referer`(관문이 허용한 값 하나). UA는 관문이 앱 고유 값(`APP_USER_AGENT`)으로 넣는다(브라우저 위장 금지)
 * - cid에 콤마가 있으면 조립 전에 던진다(호출 0회)
 */
export function buildDatalabRankRequest(
  request: DatalabRankPageRequest,
  config: DatalabRequestConfig,
): ExternalHttpRequest {
  assertSingleCid(request.cid);
  const form = new URLSearchParams();
  form.set('cid', request.cid);
  form.set('timeUnit', 'date');
  form.set('startDate', request.startDate);
  form.set('endDate', request.endDate);
  form.set('age', '');
  form.set('gender', '');
  form.set('device', '');
  form.set('page', String(request.page));
  form.set('count', String(config.pageSize));
  return {
    method: 'POST',
    url: config.rankUrl,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Referer: DATALAB_REFERER,
    },
    body: form.toString(),
  };
}

function toPortResponse(res: {
  status: number;
  headers: Headers;
  body: Buffer;
}): DatalabRankPageResponse {
  return {
    httpStatus: res.status,
    contentType: res.headers.get('content-type'),
    bodyText: res.body.toString('utf8'),
  };
}

/**
 * 데이터랩 순위 요청 어댑터(F-BS-33). P1-01 외부 호출 관문(target=DATALAB)으로만 보낸다 — 관문이 허용 목록·앱 UA·
 * 대상별 직렬·2초 간격·하루 상한·24시간 쉼·call_log(보내기 직전 1행)를 맡는다.
 * 주소·페이지 크기는 설정(`keywords.datalab`)에서 읽는다.
 */
@Injectable()
export class DatalabRankHttpAdapter implements DatalabRankPort {
  constructor(
    private readonly gateway: ExternalHttpGateway,
    private readonly settings: SettingsService,
  ) {}

  async fetchRankPage(
    request: DatalabRankPageRequest,
    options: DatalabRankFetchOptions = {},
  ): Promise<DatalabRankPageResponse> {
    const { rankUrl, pageSize } = this.settings.current().keywords.datalab;
    const httpRequest = buildDatalabRankRequest(request, { rankUrl, pageSize });
    const captured: { response: DatalabRankPageResponse | null } = { response: null };
    try {
      const res = await this.gateway.request('DATALAB', httpRequest, {
        describeResponse: (raw) => {
          const response = toPortResponse(raw);
          captured.response = response;
          return options.describe?.(response);
        },
      });
      return captured.response ?? toPortResponse(res);
    } catch (error) {
      // 403·418·429: 관문은 응답을 call_log에 쓰고 24시간 쉼을 시작한 뒤 409를 던진다. 받은 응답이 있으면 그대로 돌려주고
      // (해석은 keywords가 HTTP_403 등으로 한다), 보내기 전에 막힌 409·연결 실패 502는 그대로 던진다
      if (captured.response !== null && error instanceof ApiException) return captured.response;
      throw error;
    }
  }
}
