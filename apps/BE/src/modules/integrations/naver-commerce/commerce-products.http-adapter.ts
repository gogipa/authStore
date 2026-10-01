import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { EXTERNAL_TARGETS } from '../http/external-targets.js';
import { CommerceApiClient } from './commerce-api.client.js';
import {
  COMMERCE_CREATE_PRODUCT_PATH,
  COMMERCE_PRODUCT_SEARCH_PATH,
  type CommerceProductsCallContext,
  type CommerceProductsPort,
  type CreateProductResult,
  type SellerCodeSearchResult,
} from './commerce-products.port.js';

/** int64 상품 번호 칸(숫자 그대로 JSON.parse하면 2^53을 넘는 값이 틀어진다 → 글자로 바꿔 읽는다) */
const PRODUCT_NO_KEYS = [
  'originProductNo',
  'smartstoreChannelProductNo',
  'windowChannelProductNo',
  'channelProductNo',
  'groupProductNo',
];
const NUMBER_KEY_PATTERN = new RegExp(`("(?:${PRODUCT_NO_KEYS.join('|')})"\\s*:\\s*)(\\d+)`, 'g');
/** varchar(20) 숫자 글자 */
const PRODUCT_NO_PATTERN = /^[0-9]{1,20}$/;

/** 응답 원문 → JSON(상품 번호 칸은 숫자 글자로). JSON이 아니면 null */
export function parseProductJson(body: Buffer | string): unknown {
  const text = typeof body === 'string' ? body : body.toString('utf8');
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text.replace(NUMBER_KEY_PATTERN, '$1"$2"')) as unknown;
  } catch {
    return null;
  }
}

function productNo(value: unknown): string | null {
  const text = typeof value === 'number' ? String(value) : value;
  return typeof text === 'string' && PRODUCT_NO_PATTERN.test(text) ? text : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 등록 2xx 응답 → 상품 번호. **M0 S3 전 가정**(fixture `products.200.json`): `{ originProductNo, smartstoreChannelProductNo }`(숫자).
 * 원상품 번호가 없거나 숫자가 아니면 null(등록됐는지 알 수 없다 → 결과확인필요).
 */
export function createdProductNumbersOf(
  data: unknown,
): { originProductNo: string; channelProductNo: string | null } | null {
  const o = record(data);
  const origin = productNo(o?.originProductNo);
  if (!origin) return null;
  return { originProductNo: origin, channelProductNo: productNo(o?.smartstoreChannelProductNo) };
}

/**
 * SELLER_CODE 검색 응답 → 찾은 상품. **M0 S3 전 가정**(fixture `products-search.found.json`·`empty.json`):
 * `{ contents: [ { originProductNo, channelProducts: [ { channelProductNo, sellerManagementCode? } ] } ], totalElements }`.
 * 여러 줄이면 `sellerManagementCode`가 보낸 코드와 정확히 같은 첫 줄(코드 칸이 없으면 첫 줄). 모양이 다르면 undefined(읽지 못함).
 */
export function sellerCodeProductOf(
  data: unknown,
  sellerManagementCode: string,
): SellerCodeSearchResult['product'] | undefined {
  const o = record(data);
  if (!o || !Array.isArray(o.contents)) return undefined;
  const rows = o.contents
    .map((row) => record(row))
    .filter((row): row is Record<string, unknown> => row !== null);
  const codeOf = (row: Record<string, unknown>): unknown => {
    const channels = Array.isArray(row.channelProducts) ? row.channelProducts : [];
    const channel = record(channels[0]);
    return row.sellerManagementCode ?? channel?.sellerManagementCode;
  };
  const exact = rows.find((row) => codeOf(row) === sellerManagementCode);
  const pick = exact ?? rows.find((row) => codeOf(row) === undefined) ?? null;
  if (!pick) return null;
  const origin = productNo(pick.originProductNo);
  if (!origin) return undefined;
  const channels = Array.isArray(pick.channelProducts) ? pick.channelProducts : [];
  return {
    originProductNo: origin,
    channelProductNo: productNo(record(channels[0])?.channelProductNo),
  };
}

/** 인증 실패(보내지 못함·게이트웨이 거절)의 HTTP 상태: 4xx면 그대로, 아니면 401 */
function authFailureStatus(details: Record<string, unknown> | undefined): number {
  const status = details?.httpStatus;
  return typeof status === 'number' && status >= 400 && status <= 499 ? status : 401;
}

/**
 * 커머스API 상품 등록·판매자관리코드 조회 어댑터(P4-03, `COMMERCE_PRODUCTS_PORT`). 토큰은 `CommerceApiClient`가 `Authorization`
 * 헤더에만 붙인다(요청 본문·로그에 없다). 호출마다 관문이 `call_log`(COMMERCE_API, 후보·⑨ 실행 id, Trace-ID)를 남긴다.
 * 등록 분류(Proposed — 05-1 §7.5 'P4-03 구현 결정'):
 * - 2xx + 원상품 번호 → SUCCESS. 2xx인데 번호를 읽지 못하면 UNKNOWN(`INVALID_RESPONSE`)
 * - 4xx → CLIENT_ERROR(입력 오류 `invalidInputs` 포함). 401 `GW.AUTHN`·403 `GW.IP_NOT_ALLOWED`·429처럼 입력 오류가 아닌 4xx도 게이트웨이가
 *   처리 전에 거절한 것이라 상품이 생기지 않았다 → 같은 4xx 종결이다. **다시 보내지 않는다**(`authnRetry: false` — 401 재발급 뒤 재전송도 끈다).
 *   토큰 발급이 거절돼 보내지 못한 경우(502 `COMMERCE_AUTH_FAILED`)도 4xx 종결(그 상태, 없으면 401)
 * - 5xx·타임아웃·연결 오류(502 `EXTERNAL_API_ERROR`)·그 밖의 예외 → UNKNOWN(결과확인필요) — 모르면 늘 이쪽(이중 등록을 막는 쪽)
 */
@Injectable()
export class CommerceProductsHttpAdapter implements CommerceProductsPort {
  private readonly logger = new Logger(CommerceProductsHttpAdapter.name);

  constructor(private readonly client: CommerceApiClient) {}

  async createProduct(
    body: unknown,
    context: CommerceProductsCallContext & { timeoutMs: number },
  ): Promise<CreateProductResult> {
    let res;
    try {
      res = await this.client.request('POST', COMMERCE_CREATE_PRODUCT_PATH, {
        json: body,
        candidateId: context.candidateId ?? null,
        stepRunId: context.stepRunId ?? null,
        timeoutMs: context.timeoutMs,
        authnRetry: false,
      });
    } catch (error) {
      return this.failureOf(error);
    }
    if (res.ok) {
      const numbers = createdProductNumbersOf(parseProductJson(res.body));
      if (!numbers) {
        return {
          kind: 'UNKNOWN',
          httpStatus: res.status,
          errorCode: 'INVALID_RESPONSE',
          traceId: res.traceId,
        };
      }
      return { kind: 'SUCCESS', httpStatus: res.status, ...numbers, traceId: res.traceId };
    }
    if (res.status >= 400 && res.status <= 499) {
      const error = res.error;
      return {
        kind: 'CLIENT_ERROR',
        httpStatus: res.status,
        errorCode: error?.code ?? `HTTP_${res.status}`,
        errorMessage: error?.message ?? null,
        invalidInputs: error?.invalidInputs ?? [],
        traceId: res.traceId,
      };
    }
    return {
      kind: 'UNKNOWN',
      httpStatus: res.status,
      errorCode: res.error?.code ?? `HTTP_${res.status}`,
      traceId: res.traceId,
    };
  }

  async searchProductsBySellerCode(
    sellerManagementCode: string,
    context: CommerceProductsCallContext = {},
  ): Promise<SellerCodeSearchResult> {
    const res = await this.client.request('POST', COMMERCE_PRODUCT_SEARCH_PATH, {
      json: { searchKeywordType: 'SELLER_CODE', sellerManagementCode, page: 1, size: 10 },
      candidateId: context.candidateId ?? null,
      stepRunId: context.stepRunId ?? null,
    });
    if (!res.ok)
      throw searchError(`HTTP_${res.status}`, `HTTP ${res.status}`, res.status, res.traceId);
    const product = sellerCodeProductOf(parseProductJson(res.body), sellerManagementCode);
    if (product === undefined) {
      throw searchError('INVALID_RESPONSE', '응답 모양이 다름', res.status, res.traceId);
    }
    return { product, traceId: res.traceId };
  }

  /** 등록 호출이 던진 것 → 결과 */
  private failureOf(error: unknown): CreateProductResult {
    if (error instanceof ApiException) {
      const details = error.details;
      const traceId = typeof details?.traceId === 'string' ? details.traceId : null;
      if (error.code === 'COMMERCE_AUTH_FAILED') {
        const code = typeof details?.errorCode === 'string' ? details.errorCode : error.code;
        return {
          kind: 'CLIENT_ERROR',
          httpStatus: authFailureStatus(details),
          errorCode: code,
          errorMessage: error.message,
          invalidInputs: [],
          traceId,
        };
      }
      const reason = typeof details?.reason === 'string' ? details.reason : error.code;
      return { kind: 'UNKNOWN', httpStatus: null, errorCode: reason, traceId };
    }
    this.logger.error(
      { err: error },
      '상품 등록 호출에서 예상 못 한 오류가 났습니다(결과확인필요로 둡니다)',
    );
    return { kind: 'UNKNOWN', httpStatus: null, errorCode: 'NETWORK_ERROR', traceId: null };
  }
}

function searchError(
  reason: string,
  label: string,
  httpStatus: number | null,
  traceId: string | null,
) {
  return new ApiException('EXTERNAL_API_ERROR', {
    message: formatErrorMessage('EXTERNAL_API_ERROR', {
      대상: EXTERNAL_TARGETS.COMMERCE_API.label,
      사유: label,
    }),
    details: { target: 'COMMERCE_API', reason, httpStatus, traceId },
  });
}
