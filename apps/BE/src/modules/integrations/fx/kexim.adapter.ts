import { Injectable } from '@nestjs/common';
import { FxApiCaller } from './fx-call.js';
import {
  compactKstDate,
  type FxFetchOutcome,
  type FxRawCostRate,
  type FxSourcePort,
} from './fx-source.port.js';
import { parseKeximResponse } from './kexim.response.js';

/**
 * 한국수출입은행 환율 API 주소(Proposed, 열린질문 P1-01 — 호스트는 관문 허용 표 FX_KOREAEXIM와 같다).
 * 실측 전 가정이라 바뀌면 이 상수와 허용 표만 고친다.
 */
export const KEXIM_EXCHANGE_URL =
  'https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON';

/** 환율 종류 코드(AP01 = 환율) */
export const KEXIM_DATA_CODE = 'AP01';

/** 요청 주소: authkey(키체인 `KOREAEXIM_API_KEY`)·searchdate(YYYYMMDD)·data=AP01 */
export function buildKeximUrl(key: string, kstDate: string): string {
  const params = new URLSearchParams({
    authkey: key,
    searchdate: compactKstDate(kstDate),
    data: KEXIM_DATA_CODE,
  });
  return `${KEXIM_EXCHANGE_URL}?${params.toString()}`;
}

/** 원가 환율 어댑터(F-BS-40). 관문 target FX_KOREAEXIM. 해석은 `parseKeximResponse` */
@Injectable()
export class KeximAdapter implements Pick<FxSourcePort, 'fetchCostJpy'> {
  constructor(private readonly caller: FxApiCaller) {}

  fetchCostJpy(kstDate: string): Promise<FxFetchOutcome<FxRawCostRate>> {
    return this.caller.call<FxRawCostRate>({
      target: 'FX_KOREAEXIM',
      secretKey: 'KOREAEXIM_API_KEY',
      buildUrl: (key) => buildKeximUrl(key, kstDate),
      accept: 'application/json',
      parse: (text) => {
        const r = parseKeximResponse(text);
        return r.kind === 'OK' ? { kind: 'OK', rates: [r.rate] } : r;
      },
    });
  }
}
