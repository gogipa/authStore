import type { FxRawCustomsRate } from './fx-source.port.js';
import { FX_RESPONSE_INVALID, RATE_TEXT_RE } from './kexim.response.js';

/**
 * 관세청 관세환율(공공데이터포털, XML) 응답 해석(순수 함수, P2-04 규칙 2).
 * 응답 모양(Proposed — 실측 전 가정, test/fixtures/fx/README.md):
 * `<response><header><resultCode>00</resultCode>…</header><body><items><item>…</item></items></body></response>`.
 * 항목 필드 이름은 `CUSTOMS_ITEM_FIELDS` 한 곳에 둔다(실측 뒤 여기만 고친다).
 * 키 오류 등은 포털 게이트웨이가 `<OpenAPI_ServiceResponse><cmmMsgHeader>…<returnReasonCode>30</returnReasonCode>`로 준다.
 * XML 라이브러리 없이 필요한 태그만 읽는다(새 의존성 없음). 형식이 깨졌으면 `FX_RESPONSE_INVALID`.
 */

export const CUSTOMS_ITEM_FIELDS = {
  /** 통화 부호(JPY·USD) */
  currency: 'currSgn',
  /** 환율 */
  rate: 'fxrt',
  /** 화폐단위명(100엔) */
  unitName: 'mtryUtNm',
  /** 적용 개시일 YYYYMMDD */
  applyStartDate: 'aplyBgnDt',
  /** 수출입 구분(1 수출, 2 수입). 있으면 2만 쓴다 */
  importExport: 'imexTp',
} as const;

/** 받는 통화(규칙 2: JPY·USD 두 행) */
export const CUSTOMS_CURRENCIES = ['JPY', 'USD'] as const;

export type CustomsParseResult =
  | { kind: 'OK'; rates: FxRawCustomsRate[] }
  | { kind: 'EMPTY' }
  | { kind: 'ERROR'; errorCode: string; message: string };

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);
}

/** 한 태그의 글자(없으면 null). 속성·자식 태그가 없는 단순 요소만 */
function tagText(xml: string, name: string): string | null {
  const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml);
  return m ? decodeEntities(m[1]!).trim() : null;
}

/** `<item>` 안의 단순 자식 태그들 → 객체 */
function itemFields(block: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  let rest = block.trim();
  const re = /^<([A-Za-z_][\w.-]*)\s*(?:\/>|>([^<]*)<\/\1>)\s*/;
  while (rest.length > 0) {
    const m = re.exec(rest);
    if (!m) return null;
    out[m[1]!] = decodeEntities(m[2] ?? '').trim();
    rest = rest.slice(m[0].length);
  }
  return out;
}

function invalid(message: string): CustomsParseResult {
  return { kind: 'ERROR', errorCode: FX_RESPONSE_INVALID, message };
}

export function parseCustomsResponse(bodyText: string): CustomsParseResult {
  const xml = bodyText.replace(/^\uFEFF/, '').trim();
  if (xml === '') return invalid('응답이 비었습니다');

  // 포털 게이트웨이 오류(키 미등록·트래픽 초과 등)
  if (xml.includes('<OpenAPI_ServiceResponse>') || xml.includes('<cmmMsgHeader>')) {
    const code = tagText(xml, 'returnReasonCode') ?? 'UNKNOWN';
    const msg = tagText(xml, 'returnAuthMsg') ?? tagText(xml, 'errMsg') ?? '게이트웨이 오류';
    return { kind: 'ERROR', errorCode: `CUSTOMS_RESULT_${code}`, message: msg };
  }

  const open = xml.indexOf('<response>');
  const close = xml.lastIndexOf('</response>');
  if (open === -1 || close === -1 || close < open)
    return invalid('response 요소가 닫히지 않았습니다');
  const body = xml.slice(open, close);

  const resultCode = tagText(body, 'resultCode');
  if (resultCode !== null && !/^0+$/.test(resultCode)) {
    return {
      kind: 'ERROR',
      errorCode: `CUSTOMS_RESULT_${resultCode}`,
      message: tagText(body, 'resultMsg') ?? `응답 결과 코드 ${resultCode}`,
    };
  }

  const opens = body.match(/<item>/g)?.length ?? 0;
  const blocks = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]!);
  if (blocks.length !== opens) return invalid('item 요소가 닫히지 않았습니다');
  if (blocks.length === 0) return { kind: 'EMPTY' };

  const F = CUSTOMS_ITEM_FIELDS;
  const rates: FxRawCustomsRate[] = [];
  for (const block of blocks) {
    const fields = itemFields(block);
    if (!fields) return invalid('item 안의 형식을 읽지 못했습니다');
    const importExport = fields[F.importExport];
    if (importExport !== undefined && importExport !== '' && importExport !== '2') continue;
    const currency = (fields[F.currency] ?? '').toUpperCase();
    if (!(CUSTOMS_CURRENCIES as readonly string[]).includes(currency)) continue;
    if (rates.some((r) => r.currency === currency)) continue;
    const rate = fields[F.rate];
    if (!rate || !RATE_TEXT_RE.test(rate)) return invalid(`${currency} 환율 값이 숫자가 아닙니다`);
    rates.push({
      currency,
      rate,
      unitName: fields[F.unitName] || null,
      applyStartDate: fields[F.applyStartDate] || null,
      raw: { ...fields },
    });
  }
  const missing = CUSTOMS_CURRENCIES.filter((c) => !rates.some((r) => r.currency === c));
  if (missing.length > 0) {
    return {
      kind: 'ERROR',
      errorCode: 'CUSTOMS_RATE_MISSING',
      message: `${missing.join('·')} 과세환율이 응답에 없습니다`,
    };
  }
  return { kind: 'OK', rates: CUSTOMS_CURRENCIES.map((c) => rates.find((r) => r.currency === c)!) };
}
