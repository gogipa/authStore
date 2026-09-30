import type { ContentSettings } from '../../settings/schema/settings.types.js';
import type { FieldDraft } from '../fields/content-field.store.js';
import { ORIGIN_FIELD_KEY } from '../fields/field-keys.js';
import { FACT_KEY_OF, FACT_NAMES, type FactExtraction } from './fact.schema.js';
import { factValueOf } from './fact-values.js';
import { originSettled } from './recheck.js';

/**
 * 추출 결과 → 버전의 사실 필드 행(P3-03 규칙 10·11, ERD `content_draft_field`, `ck_cdfield_fact_method`). 버전마다 다섯 행을 모두
 * 둔다. 찾은 필드는 값(한국어 정리)·일본어 원문 발췌·출처 URL(② 상품 페이지)·방법·근거 itemCode, OCR이면 스펙 이미지 id.
 * 못 찾은 필드는 `value=NULL`('정보 없음')·`extraction_method=NONE`(추측하지 않는다).
 */
export function buildFactDrafts(input: {
  extraction: FactExtraction;
  settings: Pick<ContentSettings, 'originCountries' | 'materialTerms'>;
  itemCode: string;
  itemUrl: string;
  /** AI에 넘긴 스펙 이미지(순서 = `evidenceImageIndex`) */
  imageAssetIds: readonly number[];
}): { drafts: FieldDraft[]; unresolvedOrigins: string[] } {
  let unresolvedOrigins: string[] = [];
  const drafts = FACT_NAMES.map((name): FieldDraft => {
    const fact = input.extraction[name];
    const base: FieldDraft = {
      fieldKey: FACT_KEY_OF[name],
      value: null,
      generatedValue: null,
      valueSource: 'GENERATED',
      extractionMethod: 'NONE',
      evidenceQuote: null,
      evidenceUrl: null,
      evidenceImageAssetId: null,
      basisItemCode: input.itemCode,
      basisSha256: null,
      ownerConfirmedAt: null,
      choicePending: false,
      recheckReason: null,
      recheckResolvedAt: null,
    };
    if (!fact) return base;
    const { value, unresolved } = factValueOf(name, fact, input.settings);
    if (name === 'origin') unresolvedOrigins = unresolved;
    return {
      ...base,
      value,
      generatedValue: value,
      extractionMethod: fact.method,
      evidenceQuote: fact.evidenceQuote.slice(0, 2000),
      evidenceUrl: input.itemUrl,
      evidenceImageAssetId:
        fact.evidenceImageIndex !== null
          ? (input.imageAssetIds[fact.evidenceImageIndex] ?? null)
          : null,
    };
  });
  return { drafts, unresolvedOrigins };
}

/**
 * 입력 대기로 둘 필드(규칙 12): 원산지를 근거로 확정하지 못했으면 `fact.origin`. 확정 = 근거로 찾았고 사전(원산지 나라 사전)에서
 * 모든 나라를 알아봤거나(여러 나라도 확정 — 주의), 오너 입력이고 재확인 표시가 풀림
 */
export function pendingFactInputs(
  drafts: readonly FieldDraft[],
  unresolvedOrigins: readonly string[],
): string[] {
  const origin = drafts.find((d) => d.fieldKey === ORIGIN_FIELD_KEY);
  if (!originSettled(origin)) return [ORIGIN_FIELD_KEY];
  if (origin?.valueSource === 'GENERATED' && unresolvedOrigins.length > 0)
    return [ORIGIN_FIELD_KEY];
  return [];
}
