import { ApiException } from '../../common/errors/api.exception.js';
import type { FieldError } from '../../common/errors/error-response.js';
import { normalizeModelCode } from './page-json.parser.js';

/**
 * P2-03 요청 본문 검사(05-2 SourcingAnchorRequest·SourcingComparisonRowPatch·SourcingManualRowRequest·
 * SourcingSelectionRequest). 모두 `additionalProperties: false` — 모르는 칸·필수값 누락·범위 밖은 422 VALIDATION_FAILED
 * (`fieldErrors[]`). 앵커는 `anchorInputMethod`로 두 모양을 가르는 oneOf라 class-validator 대신 여기서 본다.
 */

function fail(fieldErrors: FieldError[]): ApiException {
  return new ApiException('VALIDATION_FAILED', { fieldErrors });
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw fail([{ field: '', message: '본문이 JSON 객체여야 합니다.' }]);
  }
  return body as Record<string, unknown>;
}

function unknownKeys(body: Record<string, unknown>, allowed: readonly string[]): FieldError[] {
  return Object.keys(body)
    .filter((k) => !allowed.includes(k))
    .map((field) => ({ field, message: '받지 않는 칸입니다.' }));
}

function optionalText(
  body: Record<string, unknown>,
  field: string,
  max: number,
  errors: FieldError[],
): string | null {
  const value = body[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    errors.push({ field, message: '글자여야 합니다.' });
    return null;
  }
  const text = value.trim();
  if (text.length > max) errors.push({ field, message: `${max}자 이내여야 합니다.` });
  return text === '' ? null : text;
}

function requiredText(
  body: Record<string, unknown>,
  field: string,
  max: number,
  errors: FieldError[],
): string | null {
  const value = body[field];
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    errors.push({ field, message: '필수입니다.' });
    return null;
  }
  return optionalText(body, field, max, errors);
}

function positiveId(body: Record<string, unknown>, field: string, errors: FieldError[]): number {
  const value = body[field];
  if (value === undefined || value === null) {
    errors.push({ field, message: '필수입니다.' });
    return 0;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) {
    errors.push({ field, message: '1 이상의 정수여야 합니다.' });
    return 0;
  }
  return value;
}

export type AnchorRequest =
  | {
      anchorInputMethod: 'SEARCH_PICK';
      anchorItemCode: string;
      anchorColorCode: string | null;
      anchorColorLabel: string | null;
    }
  | {
      anchorInputMethod: 'CODE_ENTRY';
      anchorModelCode: string;
      anchorModelCodeNorm: string;
      anchorColorCode: string | null;
      anchorColorLabel: string | null;
    };

/** PUT …/anchor 본문(규칙 1): SEARCH_PICK은 anchorItemCode, CODE_ENTRY는 anchorModelCode 필수. 색상 코드·라벨은 선택(§7-27) */
export function parseAnchorRequest(raw: unknown): AnchorRequest {
  const body = asObject(raw);
  const method = body.anchorInputMethod;
  if (method !== 'SEARCH_PICK' && method !== 'CODE_ENTRY') {
    throw fail([
      { field: 'anchorInputMethod', message: 'SEARCH_PICK 또는 CODE_ENTRY여야 합니다.' },
    ]);
  }
  const errors: FieldError[] = [];
  const common = ['anchorInputMethod', 'anchorColorCode', 'anchorColorLabel'];
  const anchorColorCode = optionalText(body, 'anchorColorCode', 64, errors);
  const anchorColorLabel = optionalText(body, 'anchorColorLabel', 128, errors);
  if (method === 'SEARCH_PICK') {
    errors.push(...unknownKeys(body, [...common, 'anchorItemCode']));
    const anchorItemCode = requiredText(body, 'anchorItemCode', 128, errors);
    if (errors.length > 0 || !anchorItemCode) throw fail(errors);
    return { anchorInputMethod: method, anchorItemCode, anchorColorCode, anchorColorLabel };
  }
  errors.push(...unknownKeys(body, [...common, 'anchorModelCode']));
  const anchorModelCode = requiredText(body, 'anchorModelCode', 128, errors);
  const norm = normalizeModelCode(anchorModelCode);
  if (anchorModelCode && !norm) {
    errors.push({ field: 'anchorModelCode', message: '型番을 넣어 주세요.' });
  }
  if (errors.length > 0 || !anchorModelCode || !norm) throw fail(errors);
  return {
    anchorInputMethod: method,
    anchorModelCode,
    anchorModelCodeNorm: norm,
    anchorColorCode,
    anchorColorLabel,
  };
}

export interface RowPatchRequest {
  couponYen?: number;
  /** 배율 원문(소수 넷째 자리까지) */
  shopEventMultiplier?: number;
  ownerMatchDecision?: 'MATCH' | 'NO_MATCH' | null;
}

/** (M2) 칸 — M1 화면은 보내지 않는다. 받으면 422(조용히 버리지 않는다, Proposed) */
const M2_ROW_FIELDS = [
  'shippingYen',
  'couponPercent',
  'couponMinAmountYen',
  'couponCombinable',
  'couponPageUrl',
];

/** PATCH …/sourcing-comparison-rows/{rowId} 본문(규칙 11): 바꾼 칸만. 빈 본문·음수 422 */
export function parseRowPatch(raw: unknown): RowPatchRequest {
  const body = asObject(raw);
  const errors: FieldError[] = [];
  const keys = Object.keys(body);
  if (keys.length === 0) {
    throw fail([{ field: '', message: '바꿀 칸을 하나 이상 보내 주세요.' }]);
  }
  const out: RowPatchRequest = {};
  for (const key of keys) {
    const value = body[key];
    if (M2_ROW_FIELDS.includes(key)) {
      errors.push({ field: key, message: '(M2) 아직 받지 않는 칸입니다.' });
    } else if (key === 'couponYen') {
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < 0 ||
        value > 100_000_000
      ) {
        errors.push({ field: key, message: '0 이상의 정수(엔)여야 합니다.' });
      } else out.couponYen = value;
    } else if (key === 'shopEventMultiplier') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        value >= 1000 ||
        Math.round(value * 10_000) !== Number((value * 10_000).toFixed(6))
      ) {
        errors.push({ field: key, message: '0 이상 1000 미만, 소수 넷째 자리까지여야 합니다.' });
      } else out.shopEventMultiplier = value;
    } else if (key === 'ownerMatchDecision') {
      if (value !== null && value !== 'MATCH' && value !== 'NO_MATCH') {
        errors.push({ field: key, message: 'MATCH·NO_MATCH·null 중 하나여야 합니다.' });
      } else out.ownerMatchDecision = value;
    } else {
      errors.push({ field: key, message: '받지 않는 칸입니다.' });
    }
  }
  if (errors.length > 0) throw fail(errors);
  return out;
}

/** POST …/rows 본문 */
export function parseManualRowRequest(raw: unknown): { rakutenItemId: number } {
  const body = asObject(raw);
  const errors = unknownKeys(body, ['rakutenItemId']);
  const rakutenItemId = positiveId(body, 'rakutenItemId', errors);
  if (errors.length > 0) throw fail(errors);
  return { rakutenItemId };
}

/** PUT …/selection 본문 */
export function parseSelectionRequest(raw: unknown): { rowId: number } {
  const body = asObject(raw);
  const errors = unknownKeys(body, ['rowId']);
  const rowId = positiveId(body, 'rowId', errors);
  if (errors.length > 0) throw fail(errors);
  return { rowId };
}
