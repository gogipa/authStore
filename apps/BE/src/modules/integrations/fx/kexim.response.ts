import type { FxRawCostRate } from './fx-source.port.js';

/**
 * 한국수출입은행 환율 API(`exchangeJSON`, data=AP01) 응답 해석(순수 함수, P2-04 규칙 1).
 * 응답 모양(Proposed — 실측 전 가정, test/fixtures/fx/README.md): JSON 배열. 항목마다 `result`(1 성공, 2 DATA 코드 오류,
 * 3 인증 코드 오류, 4 하루 제한 횟수 마감), `cur_unit`(엔화는 `JPY(100)`), `deal_bas_r`(매매기준율 문자열, 쉼표 있을 수 있음).
 * 영업일 11시 전·휴일에는 빈 배열(또는 null)이 온다 → `EMPTY`(실패 아님).
 */

export type KeximParseResult =
  | { kind: 'OK'; rate: FxRawCostRate }
  | { kind: 'EMPTY' }
  | { kind: 'ERROR'; errorCode: string; message: string };

/** 응답 `result` 코드 → 한국어 사유(call_log.error_message·경고 문구) */
export const KEXIM_RESULT_MESSAGES: Readonly<Record<string, string>> = {
  '2': '요청 DATA 코드가 잘못되었습니다',
  '3': '인증 키가 맞지 않습니다',
  '4': '오늘 호출 한도를 다 썼습니다',
};

/** 형식이 깨진 응답의 오류 코드(두 출처 공통) */
export const FX_RESPONSE_INVALID = 'FX_RESPONSE_INVALID';

/** 환율 원문 모양(천 단위 쉼표 허용, 예 `1,358.72`). 값 해석은 pricing `parseRateNumber` */
export const RATE_TEXT_RE = /^\d[\d,]*(\.\d+)?$/;

function invalid(message: string): KeximParseResult {
  return { kind: 'ERROR', errorCode: FX_RESPONSE_INVALID, message };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resultCode(item: Record<string, unknown>): string | null {
  const r = item.result;
  if (typeof r === 'number' && Number.isInteger(r)) return String(r);
  if (typeof r === 'string' && /^\d+$/.test(r.trim())) return r.trim();
  return null;
}

export function parseKeximResponse(bodyText: string): KeximParseResult {
  const text = bodyText.trim();
  if (text === '' || text === 'null') return { kind: 'EMPTY' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid('응답이 JSON이 아닙니다');
  }
  if (parsed === null) return { kind: 'EMPTY' };
  if (!Array.isArray(parsed)) return invalid('응답이 배열이 아닙니다');
  if (parsed.length === 0) return { kind: 'EMPTY' };
  const items = parsed.filter(isRecord);
  if (items.length !== parsed.length) return invalid('배열 항목이 객체가 아닙니다');

  const failed = items.find((item) => {
    const code = resultCode(item);
    return code !== null && code !== '1';
  });
  if (failed && !items.some((item) => resultCode(item) === '1')) {
    const code = resultCode(failed)!;
    return {
      kind: 'ERROR',
      errorCode: `KEXIM_RESULT_${code}`,
      message: KEXIM_RESULT_MESSAGES[code] ?? `응답 결과 코드 ${code}`,
    };
  }

  const jpy = items.find(
    (item) =>
      typeof item.cur_unit === 'string' && item.cur_unit.trim().toUpperCase().startsWith('JPY'),
  );
  if (!jpy) {
    return { kind: 'ERROR', errorCode: 'KEXIM_JPY_MISSING', message: '엔화(JPY) 줄이 없습니다' };
  }
  if (typeof jpy.deal_bas_r !== 'string' || !RATE_TEXT_RE.test(jpy.deal_bas_r.trim())) {
    return invalid('엔화 줄의 deal_bas_r이 숫자가 아닙니다');
  }
  return {
    kind: 'OK',
    rate: { currencyUnit: String(jpy.cur_unit).trim(), dealBasR: jpy.deal_bas_r.trim(), raw: jpy },
  };
}
