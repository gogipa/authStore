import { recheckOpen, type FieldDraft } from '../fields/content-field.store.js';
import {
  ORIGIN_FIELD_KEY,
  RECHECK_FACT_FIELD_KEYS,
  type RecheckReason,
} from '../fields/field-keys.js';

/** '재확인 필요'를 붙일 수 있는 사실 필드인가(`ck_cdfield_recheck_target` — 색상 표기·주의 문구는 아니다, P3-04) */
export function isRecheckFactKey(fieldKey: string): boolean {
  return (RECHECK_FACT_FIELD_KEYS as readonly string[]).includes(fieldKey);
}

/**
 * '재확인 필요'(P3-03 규칙 14, F-CT-15, US-35 AC4, PRD §5.3 예외(파생 필드), ERD `ck_cdfield_recheck_*`). 순수 함수.
 * ⑥-2가 새 버전을 만들 때 이전 버전의 오너 입력 사실 필드는 덮어쓰지 않고 가져가되, 그 값을 넣은 때의 itemCode(`basis_item_code`)가
 * 지금 ② 소싱 선택 itemCode와 다르면 `ITEM_CODE_CHANGED`를 붙인다. 오너가 현재 근거로 다시 확인·입력하면 `recheck_resolved_at`을
 * 채운다. 풀리지 않은 표시가 있으면 RG-08(P4-02)이 막는다. ⑥-2에는 '그대로 유지'가 없다.
 */

/** 오너 입력의 근거 itemCode가 지금과 다르면 ITEM_CODE_CHANGED */
export function recheckReasonFor(
  basisItemCode: string | null,
  currentItemCode: string,
): RecheckReason | null {
  return basisItemCode !== null && basisItemCode !== currentItemCode ? 'ITEM_CODE_CHANGED' : null;
}

/**
 * 새 추출 결과(`fresh`) 위에 이전 버전의 오너 입력 사실 필드를 얹는다. 오너 값·근거 URL·발췌·입력 시각·근거 itemCode는 그대로,
 * 새 추출 값·방법은 `generated_value`·`extraction_method`로 나란히 둔다(사실 필드는 '고르기' 대신 다시 넣거나 재확인한다 —
 * `choice_pending`은 쓰지 않는다, Proposed). 근거 itemCode가 바뀌었으면 `ITEM_CODE_CHANGED`(새로 붙인 필드 키를 `flagged`로),
 * 앞 버전에서 풀리지 않은 표시는 그대로 가져간다.
 */
export function carryOwnerFacts(
  previous: readonly FieldDraft[],
  fresh: readonly FieldDraft[],
  currentItemCode: string,
): { drafts: FieldDraft[]; flagged: string[] } {
  const flagged: string[] = [];
  const drafts = fresh.map((row) => {
    const owner = previous.find(
      (p) => p.fieldKey === row.fieldKey && p.valueSource === 'OWNER_INPUT',
    );
    if (!owner) return row;
    if (!isRecheckFactKey(row.fieldKey)) {
      // 색상 표기·주의 문구(P3-04): 오너 값을 그대로 가져가고 새 결과는 나란히(재확인 표시 없음 — CHECK 밖)
      return {
        ...owner,
        generatedValue: row.value,
        extractionMethod: row.extractionMethod,
        choicePending: false,
      };
    }
    const reason = recheckReasonFor(owner.basisItemCode, currentItemCode);
    if (reason) flagged.push(row.fieldKey);
    const carried: FieldDraft = {
      ...owner,
      generatedValue: row.value,
      extractionMethod: row.extractionMethod,
      choicePending: false,
      recheckReason: reason ?? (recheckOpen(owner) ? owner.recheckReason : null),
      recheckResolvedAt: null,
    };
    return carried;
  });
  return { drafts, flagged };
}

/**
 * 저장된 원산지 행이 '근거로 확정'인가(입력 대기를 끝낼 수 있는가, 규칙 12): 오너 입력이면 값이 있고 재확인 표시가 풀렸을 때,
 * 단계 결과면 근거가 있고(방법 ≠ NONE) 값이 있을 때. 사전에 없는 나라가 섞였는지는 실행기가 따로 본다
 */
export function originSettled(row: FieldDraft | undefined): boolean {
  if (!row || row.fieldKey !== ORIGIN_FIELD_KEY || row.value === null) return false;
  if (Array.isArray(row.value) && row.value.length === 0) return false;
  if (row.valueSource === 'OWNER_INPUT') return !recheckOpen(row);
  return row.extractionMethod !== null && row.extractionMethod !== 'NONE';
}

/** 오너가 현재 근거로 확인·입력했다: 재확인 표시가 있으면 풀고, 근거 itemCode를 지금 값으로 */
export function resolveRecheck(row: FieldDraft, now: Date, currentItemCode: string): FieldDraft {
  return {
    ...row,
    basisItemCode: currentItemCode,
    ownerConfirmedAt: now,
    recheckResolvedAt: row.recheckReason !== null ? now : null,
  };
}
