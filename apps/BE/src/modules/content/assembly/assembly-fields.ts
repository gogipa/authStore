import type { FieldDraft, FieldJson } from '../fields/content-field.store.js';
import { recheckOpen } from '../fields/content-field.store.js';
import type { RecheckReason } from '../fields/field-keys.js';
import type { ShoesNoticeKey } from './notice/shoes-notice.mapper.js';

/**
 * ⑥-3 필드 키와 오너 입력(P3-04 규칙 14·15, F-CT-23·34, ERD `content_draft_field` notice.*·product_name). 허용 목록은 앱 상수다
 * (05-1 표 B). 키 이름(Proposed): 고시 키를 snake_case로 `notice.<키>`, 원산지 코드 고르기 `notice.origin_area`, 상품명
 * `product_name`. 그 밖의 키(고지 블록 `notice.disclosure*`·copy.*·fact.* 등)는 422 FIELD_NOT_EDITABLE — 고지 블록은 오너가 고칠
 * 수 없다(규칙 3).
 * 행은 오너가 고쳤거나 확인한 필드만 둔다(ERD — 생성 값은 `content_draft_assembly`에 있다). 다시 실행해도 오너 값을 지키고, 새 결과는
 * `generated_value`로 나란히 둔다(⑥-3은 '나란히 고르기'(choose)를 받지 않는다 — 값을 다시 넣는다, Proposed).
 */

export const PRODUCT_NAME_FIELD_KEY = 'product_name';
export const ORIGIN_AREA_FIELD_KEY = 'notice.origin_area';

/** `notice.<snake>` → 고시 키 */
export const NOTICE_FIELD_PROPS = {
  'notice.material': 'material',
  'notice.color': 'color',
  'notice.size': 'size',
  'notice.height': 'height',
  'notice.manufacturer': 'manufacturer',
  'notice.caution': 'caution',
  'notice.warranty_policy': 'warrantyPolicy',
  'notice.after_service_director': 'afterServiceDirector',
  'notice.return_cost_reason': 'returnCostReason',
  'notice.no_refund_reason': 'noRefundReason',
  'notice.quality_assurance_standard': 'qualityAssuranceStandard',
  'notice.compensation_procedure': 'compensationProcedure',
  'notice.trouble_shooting_contents': 'troubleShootingContents',
} as const satisfies Readonly<Record<string, ShoesNoticeKey>>;
export type NoticeFieldKey = keyof typeof NOTICE_FIELD_PROPS;

/** ⑥-3 필드 키 전체(화면·조회 순서) */
export const ASSEMBLY_FIELD_KEYS: readonly string[] = [
  PRODUCT_NAME_FIELD_KEY,
  ...Object.keys(NOTICE_FIELD_PROPS),
  ORIGIN_AREA_FIELD_KEY,
];

export function isNoticeFieldKey(key: string): key is NoticeFieldKey {
  return Object.hasOwn(NOTICE_FIELD_PROPS, key);
}

export function isAssemblyFieldKey(key: string): boolean {
  return ASSEMBLY_FIELD_KEYS.includes(key);
}

/**
 * 근거가 바뀌면 '재확인 필요'를 붙이는 ⑥-3 필드와 사유(규칙 15, `ck_cdfield_recheck_target`): `notice.size` ← 판매 사이즈
 * (SALE_SIZES_CHANGED), `notice.material`·`notice.origin_area` ← ⑥-2 결과(NOTICE_RAW_CHANGED)
 */
export const ASSEMBLY_RECHECK: Readonly<Record<string, RecheckReason>> = {
  'notice.size': 'SALE_SIZES_CHANGED',
  'notice.material': 'NOTICE_RAW_CHANGED',
  'notice.origin_area': 'NOTICE_RAW_CHANGED',
};

/** 근거 요약값 묶음(assembly-facts.ts `sizeBasisSha256`·`materialBasisSha256`·`originBasisSha256`) */
export interface AssemblyBasis {
  size: string;
  material: string;
  origin: string;
}

/** 필드의 지금 근거 요약값(재확인 대상이 아니면 null) */
export function basisOf(fieldKey: string, basis: AssemblyBasis): string | null {
  if (fieldKey === 'notice.size') return basis.size;
  if (fieldKey === 'notice.material') return basis.material;
  if (fieldKey === ORIGIN_AREA_FIELD_KEY) return basis.origin;
  return null;
}

/** 원산지 코드 고르기 저장 값(`notice.origin_area`) */
export interface OriginAreaValue {
  code: string;
  content: string | null;
  plural: boolean;
}

export function isOriginAreaValue(value: unknown): value is OriginAreaValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === 'string' &&
    (v.content === null || typeof v.content === 'string') &&
    typeof v.plural === 'boolean'
  );
}

/** ⑥-3이 만든 값(오너 행의 `generated_value`) */
export interface AssemblyGenerated {
  productName: string;
  notice: Readonly<Partial<Record<ShoesNoticeKey, string>>>;
  origin: OriginAreaValue;
}

export function generatedValueOf(fieldKey: string, generated: AssemblyGenerated): FieldJson {
  if (fieldKey === PRODUCT_NAME_FIELD_KEY) return generated.productName;
  if (fieldKey === ORIGIN_AREA_FIELD_KEY) return { ...generated.origin };
  if (isNoticeFieldKey(fieldKey)) return generated.notice[NOTICE_FIELD_PROPS[fieldKey]] ?? null;
  return null;
}

/**
 * 다시 실행: 이전 버전의 ⑥-3 오너 입력 행을 새 버전으로 가져간다(규칙 15). 새 결과는 `generated_value`로, 근거 요약값이 지금과
 * 다르면 '재확인 필요'(새로 붙인 키는 사유별로 `flagged`). 앞에서 풀리지 않은 표시는 그대로 둔다
 */
export function carryAssemblyFields(
  previous: readonly FieldDraft[],
  generated: AssemblyGenerated,
  basis: AssemblyBasis,
): { drafts: FieldDraft[]; flagged: Partial<Record<RecheckReason, string[]>> } {
  const flagged: Partial<Record<RecheckReason, string[]>> = {};
  const drafts: FieldDraft[] = [];
  for (const row of previous) {
    if (row.valueSource !== 'OWNER_INPUT' || !isAssemblyFieldKey(row.fieldKey)) continue;
    const carried: FieldDraft = {
      ...row,
      generatedValue: generatedValueOf(row.fieldKey, generated),
      choicePending: false,
    };
    const reason = ASSEMBLY_RECHECK[row.fieldKey];
    const current = basisOf(row.fieldKey, basis);
    if (reason && !recheckOpen(row) && current !== null && row.basisSha256 !== current) {
      carried.recheckReason = reason;
      carried.recheckResolvedAt = null;
      (flagged[reason] ??= []).push(row.fieldKey);
    }
    drafts.push(carried);
  }
  return { drafts, flagged };
}

/** 오너 값 덮어쓰기(생성 값 위에) */
export interface AssemblyOverrides {
  productName?: string;
  notice: Partial<Record<ShoesNoticeKey, string | null>>;
  origin?: OriginAreaValue;
}

/** 오너 입력 행 → 덮어쓸 값 */
export function overridesOf(fields: readonly FieldDraft[]): AssemblyOverrides {
  const out: AssemblyOverrides = { notice: {} };
  for (const row of fields) {
    if (row.valueSource !== 'OWNER_INPUT') continue;
    if (row.fieldKey === PRODUCT_NAME_FIELD_KEY && typeof row.value === 'string') {
      out.productName = row.value;
    } else if (row.fieldKey === ORIGIN_AREA_FIELD_KEY && isOriginAreaValue(row.value)) {
      out.origin = row.value;
    } else if (isNoticeFieldKey(row.fieldKey)) {
      const value = row.value;
      if (typeof value === 'string' || value === null) {
        out.notice[NOTICE_FIELD_PROPS[row.fieldKey]] = value;
      }
    }
  }
  return out;
}
