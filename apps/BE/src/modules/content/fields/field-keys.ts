/**
 * ⑥ 콘텐츠 필드 키(ERD `content_draft_field.field_key`, `ck_cdfield_key` = `^(copy|fact|notice)\.[a-z_]+$` 또는 `product_name`).
 * 허용 목록은 앱 상수다(05-1 표 B '허용 키 목록은 앱 상수', 05-2 x-decision §7.4-34). ⑥-3 notice.*·product_name은 P3-04가 더한다.
 */

/** ⑥-1 카피 필드 키 → 카피 JSON 속성(PRD §8.5 카피 스키마). 오너가 고칠 수 있는 항목 전부(F-CT-08) */
export const COPY_FIELD_PROPS = {
  'copy.headline': 'headline',
  'copy.selling_points': 'selling_points',
  'copy.body': 'body',
  'copy.fit_and_styling': 'fit_and_styling',
  'copy.size_guide': 'size_guide',
} as const;

export type CopyFieldKey = keyof typeof COPY_FIELD_PROPS;
export type CopyFieldProp = (typeof COPY_FIELD_PROPS)[CopyFieldKey];

/** ⑥-1 카피 필드 키(화면 순서). `source_facts_used`(카피에 쓴 원문 사실)는 근거라 고칠 수 없다(Proposed) */
export const COPY_FIELD_KEYS = Object.keys(COPY_FIELD_PROPS) as CopyFieldKey[];

export function isCopyFieldKey(key: string): key is CopyFieldKey {
  return Object.hasOwn(COPY_FIELD_PROPS, key);
}

/** ⑥-2 사실 필드 키(P3-03 규칙 10). 버전마다 모든 행을 둔다. P3-04가 색상 표기·주의 문구 키를 더한다 */
export const FACT_FIELD_KEYS = [
  'fact.origin',
  'fact.material_upper',
  'fact.material_lining',
  'fact.material_sole',
  'fact.heel_height',
] as const;

export type FactFieldKey = (typeof FACT_FIELD_KEYS)[number];

export function isFactFieldKey(key: string): key is FactFieldKey {
  return (FACT_FIELD_KEYS as readonly string[]).includes(key);
}

/** 원산지 필드(입력 대기·근거 URL 필수 — `ck_cdfield_origin_url`) */
export const ORIGIN_FIELD_KEY = 'fact.origin' satisfies FactFieldKey;

/**
 * 열린 ⑥-2 실행에 오너가 넣을 수 있는 키(05-2 putContentFieldInput x-decision §7.4-34 — M1은 `fact.origin`만. 색상 표기 키는
 * P3-04(M0 뒤)가 더한다). 목록 밖 키는 422 FIELD_NOT_EDITABLE
 */
export const RUNTIME_INPUT_FIELD_KEYS: readonly FactFieldKey[] = [ORIGIN_FIELD_KEY];

/** 사실 필드 화면 이름(FE FactTable과 같은 말) */
export const FACT_FIELD_LABEL: Readonly<Record<FactFieldKey, string>> = {
  'fact.origin': '원산지',
  'fact.material_upper': '소재(겉감)',
  'fact.material_lining': '소재(안감)',
  'fact.material_sole': '소재(밑창)',
  'fact.heel_height': '굽높이',
};

/** ⑥-2 추출 방법(ERD `ck_cdfield_method` 가운데 ⑥-2가 쓰는 네 가지, F-CT-12) */
export const FACT_METHODS = ['SKU_ATTRIBUTE', 'DESCRIPTION_PATTERN', 'AI', 'NONE'] as const;
export type FactMethod = (typeof FACT_METHODS)[number];

/** 추출 방법 전체(ERD `ck_cdfield_method` — DICTIONARY·TEMPLATE은 P3-04 색상·주의 문구) */
export type ExtractionMethod = FactMethod | 'DICTIONARY' | 'TEMPLATE';

/** '재확인 필요' 사유(ERD `ck_cdfield_recheck_reason`) */
export type RecheckReason = 'ITEM_CODE_CHANGED' | 'SALE_SIZES_CHANGED' | 'NOTICE_RAW_CHANGED';
