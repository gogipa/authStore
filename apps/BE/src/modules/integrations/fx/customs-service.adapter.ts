import { Injectable } from '@nestjs/common';
import { parseCustomsResponse } from './customs-service.response.js';
import { FxApiCaller } from './fx-call.js';
import {
  compactKstDate,
  type FxFetchOutcome,
  type FxRawCustomsRate,
  type FxSourcePort,
} from './fx-source.port.js';

/**
 * 관세청 관세환율 조회 주소(공공데이터포털, Proposed — 열린질문 P1-01. 호스트는 관문 허용 표 FX_CUSTOMS와 같다).
 * 실측 전 가정이라 바뀌면 이 상수·`buildCustomsUrl`·`CUSTOMS_ITEM_FIELDS`만 고친다.
 */
export const CUSTOMS_FX_URL =
  'https://apis.data.go.kr/1220000/retrieveTrifFxrtInfo/getRetrieveTrifFxrtInfo';

/** 주간 환율 구분(2 = 수입) */
export const CUSTOMS_WEEK_TYPE_IMPORT = '2';

/** 요청 주소: serviceKey(키체인 `CUSTOMS_SERVICE_KEY`)·aplyBgnDt(조회일 YYYYMMDD)·weekFxrtTpcd=2(수입) */
export function buildCustomsUrl(key: string, kstDate: string): string {
  const params = new URLSearchParams({
    serviceKey: key,
    aplyBgnDt: compactKstDate(kstDate),
    weekFxrtTpcd: CUSTOMS_WEEK_TYPE_IMPORT,
  });
  return `${CUSTOMS_FX_URL}?${params.toString()}`;
}

/** 과세환율 어댑터(F-BS-41). 관문 target FX_CUSTOMS. 해석은 `parseCustomsResponse` */
@Injectable()
export class CustomsServiceAdapter implements Pick<FxSourcePort, 'fetchCustomsRates'> {
  constructor(private readonly caller: FxApiCaller) {}

  fetchCustomsRates(kstDate: string): Promise<FxFetchOutcome<FxRawCustomsRate>> {
    return this.caller.call<FxRawCustomsRate>({
      target: 'FX_CUSTOMS',
      secretKey: 'CUSTOMS_SERVICE_KEY',
      buildUrl: (key) => buildCustomsUrl(key, kstDate),
      accept: 'application/xml',
      parse: parseCustomsResponse,
    });
  }
}
