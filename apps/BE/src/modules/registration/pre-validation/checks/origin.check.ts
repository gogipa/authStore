import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import { resultOf, type CheckProblem } from './check-helpers.js';

/** 상세설명 표시(03)·직접 입력(04) 원산지 코드 — 사양 블록에 실제 나라 표기가 있어야 한다(PRD §8.5) */
export function isDetailOriginCode(code: string): boolean {
  return code.startsWith('03') || code.startsWith('04');
}

/** 상품 페이지 주소 비교용(끝 `/`·쿼리·조각·호스트 대소문자 무시) */
export function pageKey(url: string): string {
  try {
    const parsed = new URL(url.trim());
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.trim();
  }
}

/** 재확인 사유 글 */
const RECHECK_REASON_LABEL: Readonly<Record<string, string>> = {
  ITEM_CODE_CHANGED: '상품(itemCode)이 바뀜',
  SALE_SIZES_CHANGED: '판매 사이즈가 바뀜',
  NOTICE_RAW_CHANGED: '원산지·소재가 바뀜',
};

/**
 * `ORIGIN`(F-AP-16, PRD §8.7 원산지 행, P4-02 규칙 8): 제조국이 근거나 오너 입력으로 확정됐다(⑥-2 `fact.origin`에 나라가 있음).
 * 근거(추출값)면 `evidence_url`이 현재 `candidate.item_code`의 상품 페이지(② 현재 선택 상품 주소)이고 `basis_item_code`가 현재
 * itemCode다. 오너 입력이면 `basis_item_code` = 현재 itemCode다(itemCode가 바뀐 뒤 기록). '재확인 필요'(`recheck_reason` 있음 +
 * `recheck_resolved_at` 없음 — ⑥-2 사실·⑥-3 오너 필드) 필드가 없다. 원산지 코드가 03·04면 `spec_origin_label`에 실제 나라
 * 표기(⑥-2 나라 이름)가 있다.
 */
export function originCheck(ctx: PreValidationContext): PreValidationCheck {
  const { candidate, facts, assembly, sourcing } = ctx.inputs;
  const problems: CheckProblem[] = [];
  const origin = facts?.origin ?? null;
  const itemCode = candidate.itemCode;
  if (!origin || origin.countries.length === 0) {
    problems.push({ message: '제조국(원산지)이 확정되지 않았습니다', stepCode: 'NOTICE_RAW' });
  } else if (origin.valueSource === 'OWNER_INPUT') {
    if (!itemCode || origin.basisItemCode !== itemCode) {
      problems.push({
        message: `원산지 직접 입력이 지금 상품(${itemCode ?? '—'})으로 바뀌기 전에 기록됐습니다`,
        stepCode: 'NOTICE_RAW',
      });
    }
  } else {
    const samePage =
      origin.evidenceUrl !== null &&
      sourcing !== null &&
      sourcing.itemCode === itemCode &&
      pageKey(origin.evidenceUrl) === pageKey(sourcing.itemUrl);
    if (origin.extractionMethod === 'NONE' || origin.evidenceUrl === null) {
      problems.push({ message: '원산지 근거가 없습니다', stepCode: 'NOTICE_RAW' });
    } else if (!itemCode || origin.basisItemCode !== itemCode || !samePage) {
      problems.push({
        message: `원산지 근거가 지금 상품(${itemCode ?? '—'})의 페이지가 아닙니다`,
        stepCode: 'NOTICE_RAW',
      });
    }
  }
  const rechecks = [
    ...(facts?.rechecks ?? []).map((r) => ({ ...r, stepCode: 'NOTICE_RAW' as const })),
    ...(assembly?.rechecks ?? []).map((r) => ({ ...r, stepCode: 'NOTICE_HTML' as const })),
  ];
  if (rechecks.length > 0) {
    problems.push({
      message: `'재확인 필요' 필드가 있습니다: ${rechecks
        .map((r) => `${r.fieldKey}(${RECHECK_REASON_LABEL[r.recheckReason] ?? r.recheckReason})`)
        .join(', ')}`,
      stepCode: rechecks[0]!.stepCode,
    });
  }
  if (assembly && isDetailOriginCode(assembly.originAreaCode)) {
    const label = assembly.specOriginLabel ?? '';
    const countries = origin?.countries ?? [];
    if (countries.length === 0 || !countries.some((country) => label.includes(country))) {
      problems.push({
        message: `원산지 코드가 ${assembly.originAreaCode.slice(0, 2)}(상세설명 표시·직접 입력)인데 상품 사양 블록에 실제 나라 표기가 없습니다`,
        stepCode: 'NOTICE_HTML',
      });
    }
  }
  return resultOf('ORIGIN', problems);
}
