/**
 * 환율 출처 포트(P2-04 F-BS-40·41). pricing의 수집기(`FxCollectorService`)가 이 포트로만 환율 출처를 부른다.
 * 어댑터는 **정규화 전 원값과 단위 문자열**을 돌려준다(숫자·단위 해석은 pricing `fx-rate.normalize.ts` 한 곳).
 * - 실제: `KeximAdapter`(한국수출입은행, 관문 target FX_KOREAEXIM) · `CustomsServiceAdapter`(관세청, FX_CUSTOMS)
 * - 테스트: `FxFixtureAdapter`(응답을 정해 둔다) — `overrideProvider(FX_SOURCE_PORT)`로 바꿔 끼운다
 * 실패는 예외가 아니라 `FAILED`로 돌려준다(수집기는 마지막 값을 계속 쓰고 경고만 띄운다, F-BS-42). 실패 기록은
 * 어댑터가 call_log에 남긴다(키가 없어 부르지 않은 경우도 1행 — 실패 경고의 원본이 call_log다).
 */

export const FX_SOURCE_PORT = Symbol('FX_SOURCE_PORT');

/** 한국수출입은행 `deal_bas_r`의 엔화 한 줄(정규화 전) */
export interface FxRawCostRate {
  /** 통화 표기 원문(예 `JPY(100)`) */
  currencyUnit: string;
  /** 매매기준율 원문(예 `876.00`, `1,358.72`) */
  dealBasR: string;
  /** 응답의 그 항목(비밀 키 이름은 저장 전에 뺀다) */
  raw: Record<string, unknown>;
}

/** 관세청 과세환율 한 통화(정규화 전) */
export interface FxRawCustomsRate {
  /** 통화 부호 원문(예 `JPY`, `USD`) */
  currency: string;
  /** 환율 원문(예 `876.00`, `1,358.72`) */
  rate: string;
  /** 화폐단위명 원문(예 `100엔`). 없으면 null */
  unitName: string | null;
  /** 적용 시작일 `YYYYMMDD`(응답에 있으면). 없으면 null → 수집기가 적용 주의 시작을 계산한다 */
  applyStartDate: string | null;
  raw: Record<string, unknown>;
}

/**
 * 한 번 부른 결과.
 * - `OK`: 받은 값(엔화 1줄 / 과세 JPY·USD)
 * - `EMPTY`: 그날 고시가 없다(휴일·11시 전 빈 응답). 실패가 아니다(Proposed — call_log도 성공, 건수 0)
 * - `FAILED`: 키 없음·HTTP 오류·응답 오류 코드·형식 깨짐·연결 실패. `errorCode`는 call_log.error_code와 같다
 */
export type FxFetchOutcome<T> =
  | { kind: 'OK'; rates: T[]; callLogId: number | null }
  | { kind: 'EMPTY'; callLogId: number | null }
  | { kind: 'FAILED'; errorCode: string; message: string; callLogId: number | null };

export interface FxSourcePort {
  /** 원가 환율(엔화 1줄). `kstDate`('YYYY-MM-DD')의 고시를 받는다 */
  fetchCostJpy(kstDate: string): Promise<FxFetchOutcome<FxRawCostRate>>;
  /** 과세환율(엔·달러). `kstDate`가 속한 적용 주의 고시를 받는다 */
  fetchCustomsRates(kstDate: string): Promise<FxFetchOutcome<FxRawCustomsRate>>;
}

/** 'YYYY-MM-DD' → 'YYYYMMDD'(두 API의 날짜 쿼리 모양) */
export function compactKstDate(kstDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(kstDate)) throw new Error('kstDate는 YYYY-MM-DD');
  return kstDate.replace(/-/g, '');
}
