import type { components } from '@/shared/api/schema';
import { formatKstTime } from '@/shared/lib/format';
import type { ContentDraftFieldItem } from './content';

/** 05-2 ContentAssemblyOutput(⑥-3 조립 결과 한 버전, HTML 본문 제외) */
export type ContentAssemblyOutput = components['schemas']['ContentAssemblyOutput'];
/** 05-2 ContentDisclosureBlock(고지 블록 기록 + 채운 글) */
export type ContentDisclosureBlock = components['schemas']['ContentDisclosureBlock'];
/** 05-2 ProductNameWarning */
export type ProductNameWarning = components['schemas']['ProductNameWarning'];

// ── 상품명(P3-04 규칙 13·14, F-CT-32~34) ─────────────────────────────────────

/** 상품명 권장 최대 글자 수(초과는 저장하고 경고 — 최종 승인에서 막힌다) */
export const PRODUCT_NAME_MAX = 100;
/** 저장 칸 상한(ERD product_name varchar(255)) */
export const PRODUCT_NAME_STORE_MAX = 255;
export const PRODUCT_NAME_LABEL = '상품명';
export const PRODUCT_NAME_TEMPLATE_CHIP = '템플릿 제안';
/** 템플릿 설명(보드 글 그대로) */
export const PRODUCT_NAME_TEMPLATE_TEXT = '템플릿: 브랜드 시리즈 모델명 상품유형 대표색상 성별';
export const PRODUCT_NAME_SAVE_LABEL = '상품명 저장';
export const PRODUCT_NAME_NO_CHANGE_REASON = '고친 내용이 없습니다.';
export const PRODUCT_NAME_EMPTY_REASON = '상품명을 비울 수 없습니다.';
export const PRODUCT_NAME_NOT_EDITABLE_REASON =
  '⑥-3이 완료되거나 재실행 필요일 때 고칠 수 있습니다.';

/** 글자 수(코드 포인트 — 서버 검사와 같다) */
export function productNameLength(value: string): number {
  return [...value].length;
}

/** 카운터 `33/100` */
export function productNameCounter(value: string): string {
  return `${productNameLength(value.trim())}/${PRODUCT_NAME_MAX}`;
}

/** 100자를 넘었는가(경고만 — 저장은 된다) */
export function productNameTooLong(value: string): boolean {
  return productNameLength(value.trim()) > PRODUCT_NAME_MAX;
}

export const PRODUCT_NAME_TOO_LONG_TEXT = `${PRODUCT_NAME_MAX}자를 넘었습니다. 초안으로 저장은 되지만 최종 승인 검사에서 막힙니다.`;

/** 저장 버튼이 꺼진 이유(없으면 null). 100자 초과는 막지 않는다(규칙 14) */
export function productNameSaveDisabledReason(value: string, current: string): string | null {
  const text = value.trim();
  if (text === '') return PRODUCT_NAME_EMPTY_REASON;
  if (productNameLength(text) > PRODUCT_NAME_STORE_MAX) {
    return `상품명은 ${PRODUCT_NAME_STORE_MAX}자까지 저장할 수 있습니다.`;
  }
  if (text === current) return PRODUCT_NAME_NO_CHANGE_REASON;
  return null;
}

/**
 * 경고 줄(보드 '금지 수식어 없음 · 반복 단어 없음 · 병행수입품 아님'): 서버 경고가 없으면 '없음' 글, 있으면 그 문구.
 * 병행수입 글은 제안에 '병행'을 넣었는지
 */
export function productNameCheckText(
  output: Pick<ContentAssemblyOutput, 'productNameWarnings' | 'parallelImport'>,
): {
  ok: boolean;
  text: string;
  parallel: string;
} {
  const banned = output.productNameWarnings.filter((w) => w.code === 'PRODUCT_NAME_BANNED_WORD');
  const repeated = output.productNameWarnings.filter(
    (w) => w.code === 'PRODUCT_NAME_REPEATED_WORD',
  );
  const parts = [
    banned.length > 0 ? banned.map((w) => w.message).join(' ') : '금지 수식어 없음',
    repeated.length > 0 ? repeated.map((w) => w.message).join(' ') : '반복 단어 없음',
  ];
  return {
    ok: banned.length === 0 && repeated.length === 0,
    text: parts.join(' · '),
    parallel: output.parallelImport ? '· 병행수입품(병행 표기)' : '· 병행수입품 아님',
  };
}

// ── 상품 사양 블록 ───────────────────────────────────────────────────────────

export const SPEC_BLOCK_TITLE = '상품 사양 블록';
export const SPEC_BLOCK_CAPTION = '⑥-2와 같은 기록으로 만듦';

/** 사양 블록 HTML → 줄 글(태그를 해석하지 않고 DOMParser로 글만 읽는다 — dangerouslySetInnerHTML을 쓰지 않는다) */
export function specBlockLines(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('li')]
    .map((li) => (li.textContent ?? '').trim())
    .filter((line) => line !== '');
}

// ── 고시 표(규칙 5, F-CT-16~23) ──────────────────────────────────────────────

export const NOTICE_TITLE = '상품정보제공고시 · 신발';
export const NOTICE_EDIT_LABEL = '필드 고치기';
export const NOTICE_SAVE_LABEL = '고시 저장';
export const HEIGHT_OMITTED_TEXT = '넣지 않음 · 굽 재료를 쓰는 여성화만 넣습니다';
export const FIXED_TEXTS_SUMMARY = '품질보증기준 · A/S 책임자 · 반품 등 7개';

/** 고시 키 → 필드 키(owner-edits) */
export const NOTICE_FIELD_KEY = {
  material: 'notice.material',
  color: 'notice.color',
  size: 'notice.size',
  height: 'notice.height',
  manufacturer: 'notice.manufacturer',
  caution: 'notice.caution',
} as const;
export type EditableNoticeKey = keyof typeof NOTICE_FIELD_KEY;

export const NOTICE_EDIT_LABELS: Readonly<Record<EditableNoticeKey, string>> = {
  material: '소재(겉감 / 안감 / 밑창)',
  color: '색상',
  size: '사이즈',
  height: '굽높이(비우면 항목을 뺀다)',
  manufacturer: '제조·수입',
  caution: '주의사항',
};

/** 고정 문구 7개(표시 이름) */
export const FIXED_TEXT_LABELS: readonly { key: string; label: string }[] = [
  { key: 'warrantyPolicy', label: '품질보증기준' },
  { key: 'afterServiceDirector', label: 'A/S 책임자' },
  { key: 'returnCostReason', label: '반품 비용' },
  { key: 'noRefundReason', label: '청약철회 제한' },
  { key: 'qualityAssuranceStandard', label: '품질 보증' },
  { key: 'compensationProcedure', label: '피해 보상' },
  { key: 'troubleShootingContents', label: '소비자 상담' },
];

/** 원산지 칸 글(보드 '수입산 · 아시아 > 베트남 · 단일 국가') */
export function originText(
  output: Pick<
    ContentAssemblyOutput,
    'originAreaCode' | 'originAreaName' | 'originAreaPlural' | 'originAreaContent'
  >,
): string {
  if (/^0[34]/.test(output.originAreaCode)) {
    const kind = output.originAreaCode.startsWith('03') ? '상세설명에 표시' : '직접 입력';
    return `${kind}(${output.originAreaCode}) · ${output.originAreaContent ?? '—'}`;
  }
  const name = (output.originAreaName ?? output.originAreaCode)
    .split('>')
    .map((s) => s.trim())
    .join(' > ');
  return `수입산 · ${name} · ${output.originAreaPlural ? '여러 나라(복수 표시)' : '단일 국가'}`;
}

/** 고시 값 글(없으면 '—') */
export function noticeText(noticeFields: Record<string, unknown>, key: string): string | null {
  const value = noticeFields[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** 이 ⑥-3 필드를 오너가 넣었는가 */
export function assemblyField(
  fields: readonly ContentDraftFieldItem[],
  fieldKey: string,
): ContentDraftFieldItem | undefined {
  return fields.find((f) => f.fieldKey === fieldKey);
}

/** 고시 고치기 칸(지금 값) */
export type NoticeForm = Record<EditableNoticeKey, string>;

export function noticeFormOf(noticeFields: Record<string, unknown>): NoticeForm {
  const text = (key: string) => noticeText(noticeFields, key) ?? '';
  return {
    material: text('material'),
    color: text('color'),
    size: text('size'),
    height: text('height'),
    manufacturer: text('manufacturer'),
    caution: text('caution'),
  };
}

/** 고친 칸만 owner-edits 필드로(굽높이를 비우면 null = 항목 빼기) */
export function noticeEditFields(
  form: NoticeForm,
  noticeFields: Record<string, unknown>,
): { fieldKey: string; value: string | null }[] {
  const before = noticeFormOf(noticeFields);
  return (Object.keys(NOTICE_FIELD_KEY) as EditableNoticeKey[]).flatMap(
    (key): { fieldKey: string; value: string | null }[] => {
      const value = form[key].trim();
      if (value === before[key]) return [];
      if (value === '') {
        return key === 'height' ? [{ fieldKey: NOTICE_FIELD_KEY[key], value: null }] : [];
      }
      return [{ fieldKey: NOTICE_FIELD_KEY[key], value }];
    },
  );
}

// ── 구매대행 고지 미리보기(규칙 3·4, F-CT-01~04) ────────────────────────────

export const DISCLOSURE_TITLE = '구매대행 고지 미리보기';
export const DISCLOSURE_LOCKED_CHIP = '고칠 수 없음';
export const DISCLOSURE_MATCHED_CHIP = '템플릿과 일치';
export const DISCLOSURE_MISMATCHED_CHIP = '템플릿과 다름';
export const DISCLOSURE_FULL_LABEL = '전체 보기';

/** 조건부 블록 표시 이름(보드 '붙은 문장: 가죽 소재 · AI 이미지') */
export const CONDITIONAL_BLOCK_LABEL: Readonly<Record<string, string>> = {
  LEATHER_SAFETY: '가죽 소재',
  AI_IMAGE: 'AI 이미지',
  PRICE_BREAKDOWN: '판매가 구성',
};

/** '기준일 2026-09-24 · 붙은 문장: 가죽 소재 · AI 이미지'(붙은 문장이 없으면 '붙은 문장 없음') */
export function disclosureFootText(
  output: Pick<ContentAssemblyOutput, 'disclosureTemplateDate' | 'disclosureBlocks'>,
): string {
  const attached = output.disclosureBlocks
    .filter((b) => b.conditional)
    .map((b) => CONDITIONAL_BLOCK_LABEL[b.blockId] ?? b.blockId);
  return `기준일 ${output.disclosureTemplateDate} · ${
    attached.length > 0 ? `붙은 문장: ${attached.join(' · ')}` : '붙은 문장 없음'
  }`;
}

/** 접었을 때 보이는 고지 줄 수 */
export const DISCLOSURE_PREVIEW_LINES = 6;

// ── 머리 줄·프로필 ──────────────────────────────────────────────────────────

export const ASSEMBLY_EMPTY_TEXT =
  '⑥-3을 실행하면 ⑥-1 카피·⑥-2 원산지·소재·③ 판매 사이즈·구매대행 프로필로 고시·사양 블록·고지·상세 HTML·상품명을 규칙으로 만듭니다(AI를 쓰지 않습니다).';
export const ASSEMBLY_RULE_NOTE = 'AI 없이 규칙으로 만듦';
export const PROFILE_OK_TEXT = '프로필 확인됨: 상호·수입자·A/S';
export const PROFILE_LINK_LABEL = '프로필 보기';
export const PROFILE_FILL_LINK_LABEL = '설정에서 프로필 채우기';
export const SETTINGS_PATH = '/settings';

/** ⑥-3이 시작 전에 보는 프로필 칸(P1-09 NOTICE_HTML_REQUIRED_PROFILE_FIELDS + 반품비 — P3-04 Proposed) */
export const ASSEMBLY_PROFILE_FIELDS = [
  'businessName',
  'afterServicePhone',
  'afterServiceGuide',
  'importer',
  'returnFeeKrw',
] as const;

const PROFILE_FIELD_LABEL: Readonly<Record<string, string>> = {
  businessName: '상호',
  afterServicePhone: 'A/S 연락처',
  afterServiceGuide: 'A/S 안내',
  importer: '수입자',
  returnFeeKrw: '반품비',
};

/** 프로필에서 ⑥-3이 막히는 빈칸(화면 이름) */
export function missingAssemblyProfile(missingFields: readonly string[]): string[] {
  return ASSEMBLY_PROFILE_FIELDS.filter((f) => missingFields.includes(f)).map(
    (f) => PROFILE_FIELD_LABEL[f] ?? f,
  );
}

export function profileMissingText(labels: readonly string[]): string {
  return `구매대행 프로필에 빈칸(${labels.join(', ')})이 있어 ⑥-3을 시작할 수 없습니다. 설정에서 채워 주세요.`;
}

/** 머리 줄 글(보드 '14:32 조립 · v2 · AI 없이 규칙으로 만듦') */
export function assemblyMetaText(
  output: Pick<ContentAssemblyOutput, 'createdAt' | 'version'>,
): string {
  return `${formatKstTime(output.createdAt)} 조립 · v${output.version} · ${ASSEMBLY_RULE_NOTE}`;
}

// ── HTML 미리보기(F-CT-31) ──────────────────────────────────────────────────

export const PREVIEW_TITLE = '⑥-3 HTML 미리보기';
export const PREVIEW_ENLARGE_LABEL = '크게 보기';
export const PREVIEW_SHRINK_LABEL = '작게 보기';
export const PREVIEW_CAPTION = '이미지 자리를 ⑤ 선택본(로컬)으로 채움';
