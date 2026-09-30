import type { components } from '@/shared/api/schema';
import { formatKstTime } from '@/shared/lib/format';

/** 05-2 ContentCopyOutput(⑥-1 카피 한 버전) */
export type ContentCopyOutput = components['schemas']['ContentCopyOutput'];
/** 05-2 ContentFactOutput(⑥-2 고시 원자료 한 버전) */
export type ContentFactOutput = components['schemas']['ContentFactOutput'];
/** 05-2 ContentDraftFieldItem(필드 단위 값) */
export type ContentDraftFieldItem = components['schemas']['ContentDraftFieldItem'];
/** 05-2 ContentFieldInputRequest(열린 ⑥-2 실행의 필드 오너 입력) */
export type ContentFieldInputRequest = components['schemas']['ContentFieldInputRequest'];
/** 05-2 ContentFieldInputResult */
export type ContentFieldInputResult = components['schemas']['ContentFieldInputResult'];
/** 05-2 OwnerEditFieldInput(오너 수정 EDIT 필드 하나) */
export type OwnerEditFieldInput = components['schemas']['OwnerEditFieldInput'];

// ── ⑥-1 카피(P3-03 규칙 2·5~8, F-CT-05·07·08) ──────────────────────────────

/** 헤드라인 최대 글자 수(카피 스키마 — 서버 422 VALIDATION_FAILED와 같은 규칙) */
export const HEADLINE_MAX = 40;
export const SELLING_POINTS_MIN = 3;
export const SELLING_POINTS_MAX = 5;

/** 카피 문서(generatedCopy·copy — 키는 카피 스키마 snake_case 그대로) */
export interface CopyDoc {
  headline: string;
  selling_points: string[];
  body: string;
  fit_and_styling: string;
  size_guide: string;
  source_facts_used: string[];
}

/** 카피 필드 키(고칠 수 있는 항목 — 원문 사실 목록은 근거라 고치지 않는다) */
export const COPY_FIELD_KEYS = [
  'copy.headline',
  'copy.selling_points',
  'copy.body',
  'copy.fit_and_styling',
  'copy.size_guide',
] as const;
export type CopyFieldKey = (typeof COPY_FIELD_KEYS)[number];

export const COPY_FIELD_LABEL: Readonly<Record<CopyFieldKey, string>> = {
  'copy.headline': '헤드라인',
  'copy.selling_points': '셀링포인트',
  'copy.body': '본문',
  'copy.fit_and_styling': '착화감·코디 제안',
  'copy.size_guide': '사이즈 안내',
};

const COPY_PROP: Readonly<Record<CopyFieldKey, keyof CopyDoc>> = {
  'copy.headline': 'headline',
  'copy.selling_points': 'selling_points',
  'copy.body': 'body',
  'copy.fit_and_styling': 'fit_and_styling',
  'copy.size_guide': 'size_guide',
};

/** 화면 편집 칸(셀링포인트는 한 줄에 하나 — 보드처럼 `· ` 머리표) */
export interface CopyForm {
  headline: string;
  sellingPoints: string;
  body: string;
  fitAndStyling: string;
  sizeGuide: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const list = (value: unknown) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/** 응답 jsonb → 카피 문서(모양이 어긋나도 빈 값으로) */
export function copyDocOf(value: Record<string, unknown> | undefined): CopyDoc {
  return {
    headline: text(value?.headline),
    selling_points: list(value?.selling_points),
    body: text(value?.body),
    fit_and_styling: text(value?.fit_and_styling),
    size_guide: text(value?.size_guide),
    source_facts_used: list(value?.source_facts_used),
  };
}

export function sellingPointsText(points: readonly string[]): string {
  return points.map((p) => `· ${p}`).join('\n');
}

/** 셀링포인트 칸 글 → 목록(줄마다 하나, 머리표 `·`·`-`·`•` 떼기, 빈 줄 빼기) */
export function sellingPointsOf(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.replace(/^\s*[·•\-*]\s*/u, '').trim())
    .filter((line) => line !== '');
}

export function copyFormOf(doc: CopyDoc): CopyForm {
  return {
    headline: doc.headline,
    sellingPoints: sellingPointsText(doc.selling_points),
    body: doc.body,
    fitAndStyling: doc.fit_and_styling,
    sizeGuide: doc.size_guide,
  };
}

/** 글자 수(코드 포인트 — 서버 검사와 같다) */
export function charCount(value: string): number {
  return [...value].length;
}

/** 헤드라인 카운터 `25/40` */
export function headlineCounter(value: string): string {
  return `${charCount(value.trim())}/${HEADLINE_MAX}`;
}

export type CopyFormErrors = Partial<Record<keyof CopyForm, string>>;

/** 저장 전 검사(서버 422와 같은 규칙): 헤드라인 1~40자, 셀링포인트 3~5개, 나머지 글 1자 이상 */
export function copyFormErrors(form: CopyForm): CopyFormErrors {
  const errors: CopyFormErrors = {};
  const headline = charCount(form.headline.trim());
  if (headline === 0) errors.headline = '헤드라인을 비울 수 없습니다.';
  else if (headline > HEADLINE_MAX)
    errors.headline = `헤드라인은 ${HEADLINE_MAX}자 이하여야 합니다(지금 ${headline}자).`;
  const points = sellingPointsOf(form.sellingPoints).length;
  if (points < SELLING_POINTS_MIN || points > SELLING_POINTS_MAX) {
    errors.sellingPoints = `셀링포인트는 ${SELLING_POINTS_MIN}~${SELLING_POINTS_MAX}개여야 합니다(지금 ${points}개).`;
  }
  if (form.body.trim() === '') errors.body = '본문을 비울 수 없습니다.';
  if (form.fitAndStyling.trim() === '')
    errors.fitAndStyling = '착화감·코디 제안을 비울 수 없습니다.';
  if (form.sizeGuide.trim() === '') errors.sizeGuide = '사이즈 안내를 비울 수 없습니다.';
  return errors;
}

/** 칸 값 → 필드 값(서버 저장 모양) */
function formValue(form: CopyForm, key: CopyFieldKey): string | string[] {
  switch (key) {
    case 'copy.headline':
      return form.headline.trim();
    case 'copy.selling_points':
      return sellingPointsOf(form.sellingPoints);
    case 'copy.body':
      return form.body.trim();
    case 'copy.fit_and_styling':
      return form.fitAndStyling.trim();
    case 'copy.size_guide':
      return form.sizeGuide.trim();
  }
}

/** 고친 항목만 오너 수정 EDIT 필드로(지금 유효 카피와 다른 것) */
export function copyEditFields(form: CopyForm, current: CopyDoc): OwnerEditFieldInput[] {
  return COPY_FIELD_KEYS.flatMap((key) => {
    const value = formValue(form, key);
    const before = current[COPY_PROP[key]];
    return JSON.stringify(value) === JSON.stringify(before) ? [] : [{ fieldKey: key, value }];
  });
}

/** '그대로 유지'가 꺼진 이유(재실행 필요가 아닐 때, 보드 문구) */
export const KEEP_AS_IS_DISABLED_REASON = '재실행 필요일 때만 고를 수 있습니다';
export const KEEP_AS_IS_LABEL = '그대로 유지';
export const SAVE_COPY_LABEL = '고친 내용 저장';
export const SOURCE_FACTS_TITLE = '카피에 쓴 원문 사실';
export const FIT_AND_SIZE_TITLE = '착화감·코디 제안 · 사이즈 안내';
export const COPY_EMPTY_TEXT =
  '⑥-1을 실행하면 라쿠텐 상품명·설명·SKU 속성의 사실만으로 한국어 카피를 만듭니다.';
export const COPY_NOT_EDITABLE_REASON = '⑥-1이 완료되거나 재실행 필요일 때 고칠 수 있습니다.';
export const COPY_NO_CHANGE_REASON = '고친 항목이 없습니다.';
export const CHOICE_TITLE = '다시 실행한 결과가 직접 고친 값과 다릅니다';
export const CHOOSE_OWNER_LABEL = '직접 고친 값 유지';
export const CHOOSE_GENERATED_LABEL = '새 결과로 바꾸기';

/** 필드 값 → 화면 글(셀링포인트 목록은 ` · `로) */
export function fieldValueText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(' · ');
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : JSON.stringify(value);
}

/** 나란히 고르기가 필요한 카피 필드 */
export function pendingChoices(fields: readonly ContentDraftFieldItem[]): ContentDraftFieldItem[] {
  return fields.filter(
    (f) => f.choicePending && (COPY_FIELD_KEYS as readonly string[]).includes(f.fieldKey),
  );
}

/** 이 항목을 오너가 직접 고쳤는가('직접 입력' 칩) */
export function isOwnerField(fields: readonly ContentDraftFieldItem[], key: CopyFieldKey): boolean {
  return fields.some((f) => f.fieldKey === key && f.valueSource === 'OWNER_INPUT');
}

/** 머리 줄 글(보드 '14:21 생성 · 14:31 헤드라인 직접 고침 · v2') */
export function copyMetaText(output: ContentCopyOutput): string {
  const owner = output.fields.filter((f) => f.valueSource === 'OWNER_INPUT' && f.ownerConfirmedAt);
  const parts: string[] = [];
  if (owner.length === 0) {
    parts.push(`${formatKstTime(output.createdAt)} 생성`);
  } else {
    const latest = owner.reduce((a, b) =>
      Date.parse(a.ownerConfirmedAt ?? '') >= Date.parse(b.ownerConfirmedAt ?? '') ? a : b,
    );
    const labels = owner
      .map((f) => COPY_FIELD_LABEL[f.fieldKey as CopyFieldKey])
      .filter(Boolean)
      .join('·');
    parts.push(`${formatKstTime(latest.ownerConfirmedAt ?? output.createdAt)} ${labels} 직접 고침`);
  }
  parts.push(`v${output.version}`);
  return parts.join(' · ');
}

// ── ⑥-2 원산지·소재(P3-03 규칙 9~14, F-CT-12·13·14·15) ────────────────────────

export const FACT_KEYS = [
  'fact.origin',
  'fact.material_upper',
  'fact.material_lining',
  'fact.material_sole',
  'fact.heel_height',
  // P3-04(F-CT-17·21): 색상 한국어 표기·소재별 주의 문구
  'fact.color_ko',
  'fact.caution',
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

/** 소재 표 줄의 부분 이름(PRD §8.5 상품 사양 블록 '겉감 / 안감 / 밑창') */
export const MATERIAL_PARTS: readonly { key: FactKey; label: string }[] = [
  { key: 'fact.material_upper', label: '겉감' },
  { key: 'fact.material_lining', label: '안감' },
  { key: 'fact.material_sole', label: '밑창' },
];

export const NO_INFO_TEXT = '정보 없음';

/** 방법 글(보드 '출처 · 방법' 칸): 상품 속성·설명문·AI·정보 없음 */
export const FACT_METHOD_TEXT: Readonly<Record<string, string>> = {
  SKU_ATTRIBUTE: '상품 속성에서 찾음',
  DESCRIPTION_PATTERN: '설명문에서 찾음',
  AI: 'AI로 찾음',
  DICTIONARY: '색상 사전으로 바꿈',
  TEMPLATE: '소재별 템플릿',
  NONE: NO_INFO_TEXT,
};

/** 색상 표기 방법 글(보드 '사전에 없어 AI 보조') */
export const COLOR_AI_METHOD_TEXT = '사전에 없어 AI 보조';
export const COLOR_SOURCE_TEXT = '선택 색상 원문';

export function factMethodText(field: ContentDraftFieldItem): string {
  if (field.valueSource === 'OWNER_INPUT') return '직접 입력';
  const method = field.extractionMethod ?? 'NONE';
  if (field.fieldKey === 'fact.color_ko' && method === 'AI') return COLOR_AI_METHOD_TEXT;
  if (field.fieldKey === 'fact.caution' && method === 'AI') return '소재별 템플릿 + AI 보완';
  const base = FACT_METHOD_TEXT[method] ?? method;
  return method === 'AI' && field.evidenceImageAssetId !== null ? `${base} · 스펙 이미지` : base;
}

/** 출처 글: 오너 근거 주소·설명 속 스펙 이미지·라쿠텐 상품 페이지(근거가 없으면 '—'). 색상은 선택 색상 원문 */
export function factSourceText(field: ContentDraftFieldItem): string {
  if (field.fieldKey === 'fact.color_ko') {
    return field.valueSource === 'OWNER_INPUT' ? '직접 확인' : COLOR_SOURCE_TEXT;
  }
  if (field.valueSource === 'OWNER_INPUT') return '오너 근거 주소';
  if (field.evidenceImageAssetId !== null) return '설명 속 스펙 이미지';
  if (field.extractionMethod === 'NONE' || field.extractionMethod === null) return '—';
  return '라쿠텐 상품 페이지';
}

/** 사실 값 → 화면 글: 나라 목록 `베트남·인도네시아`, 높이 `약 3.5cm`, 없음 '정보 없음' */
export function factValueText(value: unknown): string {
  if (value === null || value === undefined) return NO_INFO_TEXT;
  if (Array.isArray(value)) return value.length > 0 ? value.map(String).join('·') : NO_INFO_TEXT;
  if (typeof value === 'object') {
    const v = value as { value?: unknown; unit?: unknown };
    if (typeof v.value === 'number')
      return `약 ${v.value}${typeof v.unit === 'string' ? v.unit : ''}`;
  }
  return typeof value === 'string' && value !== '' ? value : NO_INFO_TEXT;
}

export function factField(
  fields: readonly ContentDraftFieldItem[],
  key: FactKey,
): ContentDraftFieldItem | undefined {
  return fields.find((f) => f.fieldKey === key);
}

export const FACT_HEAD_NOTE = "근거가 바뀌면 '재확인 필요' · 원산지를 못 정하면 '입력 대기'";
export const FACT_EMPTY_TEXT =
  '⑥-2를 실행하면 상품 속성 → 설명문 → AI 순서로 원산지·소재·굽높이를 근거와 함께 찾습니다.';
export const ORIGIN_WAITING_TEXT =
  '원산지를 근거로 정하지 못했습니다. 나라와 근거 URL을 넣으면 ⑥-2가 끝납니다.';
export const ORIGIN_INPUT_LABEL = '직접 넣기';
export const ORIGIN_SAVE_LABEL = '원산지 저장';
export const ORIGIN_URL_REQUIRED_REASON = '근거 URL을 넣어야 저장할 수 있습니다.';
export const ORIGIN_COUNTRY_REQUIRED_REASON = '나라 이름을 넣어 주세요.';
export const ORIGIN_NOT_EDITABLE_REASON =
  '⑥-2가 입력 대기이거나 완료일 때 원산지를 넣을 수 있습니다.';
export const RECHECK_LABEL = '재확인 필요';
/** 색상 표기 고치기(P3-04, F-CT-17 — 보드 '고치기') */
export const COLOR_EDIT_LABEL = '고치기';
export const COLOR_SAVE_LABEL = '색상 저장';
export const COLOR_ROW_LABEL = '색상 표기';
export const COLOR_NOT_EDITABLE_REASON = '⑥-2가 입력 대기이거나 완료일 때 고칠 수 있습니다.';
export const COLOR_EMPTY_REASON = '색상 표기를 넣어 주세요.';
export const RECHECK_CONFIRM_LABEL = '현재 근거로 확인';

/** 원산지 직접 넣기 저장이 꺼진 이유(근거 URL 먼저 — 05-2 EVIDENCE_URL_REQUIRED) */
export function originSaveDisabledReason(country: string, evidenceUrl: string): string | null {
  if (evidenceUrl.trim() === '') return ORIGIN_URL_REQUIRED_REASON;
  if (country.trim() === '') return ORIGIN_COUNTRY_REQUIRED_REASON;
  return null;
}

/** 머리 줄 글(보드 '14:24 추출 · v1') */
export function factMetaText(output: ContentFactOutput): string {
  return `${formatKstTime(output.createdAt)} 추출 · v${output.version}`;
}
