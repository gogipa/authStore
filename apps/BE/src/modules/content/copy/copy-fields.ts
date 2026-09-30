import { ApiException } from '../../../common/errors/api.exception.js';
import type { FieldError } from '../../../common/errors/error-response.js';
import { canonicalJson } from '../../step-engine/domain/fingerprint.js';
import type { FieldDraft, FieldJson } from '../fields/content-field.store.js';
import {
  COPY_FIELD_KEYS,
  COPY_FIELD_PROPS,
  isCopyFieldKey,
  type CopyFieldKey,
} from '../fields/field-keys.js';
import { cleanCopyValue, copyFieldErrors, type CopyDraft } from './copy.schema.js';

/**
 * ⑥-1 카피 필드 규칙(P3-03 규칙 5~7, F-CT-08, PRD §5.3 '다시 실행과 오너 수정'). 순수 함수.
 * - `content_draft_copy.copy` = `generated_copy` + 필드별 오너 입력(행의 `value`)
 * - `content_draft_field`에는 오너가 고치거나 고른 `copy.*` 필드만 둔다
 */

/** 오너 수정 EDIT의 필드 하나(05-2 OwnerEditFieldInput — step-engine이 모양을 본 값) */
export interface CopyEditInput {
  fieldKey: string;
  value?: unknown;
  evidenceUrl?: string;
  choose?: 'OWNER' | 'GENERATED';
  recheckConfirmed?: boolean;
}

function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function generatedOf(generated: CopyDraft, key: CopyFieldKey): FieldJson {
  return generated[COPY_FIELD_PROPS[key]];
}

/** 유효 카피 = AI 원 결과 + 필드 행의 유효 값(오너 입력·오너가 고른 값) */
export function overlayCopy(generated: CopyDraft, fields: readonly FieldDraft[]): CopyDraft {
  const copy: CopyDraft = structuredClone(generated);
  for (const row of fields) {
    if (!isCopyFieldKey(row.fieldKey) || row.value === null) continue;
    const prop = COPY_FIELD_PROPS[row.fieldKey];
    (copy as unknown as Record<string, unknown>)[prop] = structuredClone(row.value);
  }
  return copy;
}

/**
 * 다시 실행(규칙 7): 이전 버전의 `OWNER_INPUT` 필드를 덮어쓰지 않고 가져온다. 새 AI 값은 `generated_value`에 넣고, 오너 값과
 * 다르면 `choice_pending=true`(나란히 보여 주고 오너가 `choose`로 고른다). 오너가 AI 값을 고른 행(`GENERATED`)은 지키지 않는다 —
 * 새 AI 결과가 그대로 쓰인다
 */
export function carryCopyFields(
  previous: readonly FieldDraft[],
  generated: CopyDraft,
): FieldDraft[] {
  return COPY_FIELD_KEYS.flatMap((key) => {
    const row = previous.find((r) => r.fieldKey === key && r.valueSource === 'OWNER_INPUT');
    if (!row) return [];
    const fresh = generatedOf(generated, key);
    return [
      {
        ...row,
        generatedValue: fresh,
        choicePending: !sameValue(row.value, fresh),
        recheckReason: null,
        recheckResolvedAt: null,
      },
    ];
  });
}

function validation(fieldErrors: FieldError[]): ApiException {
  return new ApiException('VALIDATION_FAILED', { fieldErrors });
}

/**
 * 카피 편집(오너 수정 EDIT, 규칙 6·7). 바탕 버전의 AI 원 결과·필드 행에 편집을 적용한 새 버전의 필드 행과 유효 카피를 준다.
 * - 허용 키 밖(`copy.*` 5개가 아님 — `copy.source_facts_used`·`fact.*` 등) → 422 FIELD_NOT_EDITABLE(details.fieldKey)
 * - 같은 키 두 번, `value`와 `choose`를 같이 주거나 둘 다 없음, 카피에 없는 `evidenceUrl`·`recheckConfirmed`, 고를 새 결과가 없는데
 *   `choose`, 헤드라인 40자 초과·셀링포인트 3~5개 위반 등 → 422 VALIDATION_FAILED(fieldErrors)
 * - `value` → `OWNER_INPUT`, `owner_confirmed_at`=지금, `generated_value`=바탕 버전 AI 값
 * - `choose: OWNER` → 오너 값 유지·`choice_pending=false`. `choose: GENERATED` → 새 AI 값(`generated_value`)을 유효 값으로(`GENERATED`)
 */
export function applyCopyEdits(
  base: { generated: CopyDraft; fields: readonly FieldDraft[] },
  edits: readonly CopyEditInput[],
  now: Date,
): { fields: FieldDraft[]; copy: CopyDraft } {
  edits.forEach((edit) => {
    if (!isCopyFieldKey(edit.fieldKey)) {
      throw new ApiException('FIELD_NOT_EDITABLE', {
        details: { fieldKey: edit.fieldKey, stepCode: 'COPY' },
      });
    }
  });
  const errors: FieldError[] = [];
  const seen = new Set<string>();
  const rows = new Map<string, FieldDraft>(base.fields.map((row) => [row.fieldKey, { ...row }]));
  edits.forEach((edit, index) => {
    const at = `fields[${index}]`;
    const key = edit.fieldKey as CopyFieldKey;
    if (seen.has(key)) {
      errors.push({ field: `${at}.fieldKey`, message: '같은 항목을 두 번 고쳤습니다.' });
      return;
    }
    seen.add(key);
    if (edit.evidenceUrl !== undefined || edit.recheckConfirmed !== undefined) {
      errors.push({
        field: at,
        message: '카피 항목에는 근거 URL·재확인을 받지 않습니다.',
      });
      return;
    }
    const hasValue = Object.hasOwn(edit, 'value') && edit.value !== undefined;
    if (hasValue === (edit.choose !== undefined)) {
      errors.push({
        field: at,
        message: hasValue
          ? '새 값(value)과 고르기(choose)는 함께 줄 수 없습니다.'
          : '새 값(value) 또는 고르기(choose)가 필요합니다.',
      });
      return;
    }
    const existing = rows.get(key);
    if (edit.choose !== undefined) {
      if (!existing || !existing.choicePending) {
        errors.push({
          field: `${at}.choose`,
          message: '나란히 고를 새 결과가 없는 항목입니다.',
          rejectedValue: edit.choose,
        });
        return;
      }
      rows.set(
        key,
        edit.choose === 'OWNER'
          ? { ...existing, choicePending: false, ownerConfirmedAt: now }
          : {
              ...existing,
              value: existing.generatedValue,
              valueSource: 'GENERATED',
              choicePending: false,
              ownerConfirmedAt: now,
            },
      );
      return;
    }
    const fieldErrors = copyFieldErrors(key, edit.value, `${at}.value`);
    if (fieldErrors.length > 0) {
      errors.push(...fieldErrors);
      return;
    }
    rows.set(key, {
      fieldKey: key,
      value: cleanCopyValue(key, edit.value),
      generatedValue: generatedOf(base.generated, key),
      valueSource: 'OWNER_INPUT',
      extractionMethod: null,
      evidenceQuote: null,
      evidenceUrl: null,
      evidenceImageAssetId: null,
      basisItemCode: null,
      basisSha256: null,
      ownerConfirmedAt: now,
      choicePending: false,
      recheckReason: null,
      recheckResolvedAt: null,
    });
  });
  if (errors.length > 0) throw validation(errors);
  const fields = COPY_FIELD_KEYS.map((key) => rows.get(key)).filter(
    (row): row is FieldDraft => row !== undefined,
  );
  return { fields, copy: overlayCopy(base.generated, fields) };
}
