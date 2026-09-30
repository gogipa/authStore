import type { AssemblyFacts, AssemblyHeel, AssemblyMaterials } from '../assembly-facts.js';
import { heelCm } from '../assembly-facts.js';
import { formatSaleSizes } from './size-format.js';

/**
 * `SHOES` 상품정보제공고시 객체(P3-04 규칙 5, F-CT-16~22, PRD §8.5 CT-03 표, R04 §2.5). 등록 요청의 `productInfoProvidedNotice.shoes`
 * 모양(키 이름은 커머스API 고시 필드)이다. 0/1 입력 형식은 M0 S3 뒤 — M1은 글('상품상세 참조')로 둔다.
 * - `height`는 **키 자체를 뺀다**(null이 아니다 — RG-08 필수 항목 검사와 등록 본문이 이 차이를 탄다, 주의)
 */
export interface ShoesNoticeFields {
  material: string;
  color: string;
  size: string;
  height?: string;
  manufacturer: string;
  caution: string;
  warrantyPolicy: string;
  afterServiceDirector: string;
  returnCostReason: string;
  noRefundReason: string;
  qualityAssuranceStandard: string;
  compensationProcedure: string;
  troubleShootingContents: string;
}

/** 고시 키 목록(순서 = 화면·등록 본문 순서) */
export const SHOES_NOTICE_KEYS = [
  'material',
  'color',
  'size',
  'height',
  'manufacturer',
  'caution',
  'warrantyPolicy',
  'afterServiceDirector',
  'returnCostReason',
  'noRefundReason',
  'qualityAssuranceStandard',
  'compensationProcedure',
  'troubleShootingContents',
] as const satisfies readonly (keyof ShoesNoticeFields)[];
export type ShoesNoticeKey = (typeof SHOES_NOTICE_KEYS)[number];

/** 근거 없는 칸(PRD §8.5 CT-02 4순위 '정보 없음') */
export const NO_INFO = '정보 없음';
/** `warrantyPolicy` 기본 문구(PRD §8.5 템플릿) */
export const WARRANTY_POLICY_DEFAULT = '소비자분쟁해결기준에 따름';
/** 반품·보증 관련 5개 항목 기본 문구(F-CT-22) */
export const REFER_TO_DETAIL = '상품상세 참조';
/** 반품·보증 관련 5개 고시 키(프로필 `noticeFixedTexts` 키와 같다 — P1-09) */
export const REFER_TO_DETAIL_KEYS = [
  'returnCostReason',
  'noRefundReason',
  'qualityAssuranceStandard',
  'compensationProcedure',
  'troubleShootingContents',
] as const;
/** 제조자를 모를 때(브랜드 출처가 없는 URL 후보 — Proposed) */
export const MANUFACTURER_UNKNOWN = REFER_TO_DETAIL;

/** 굽 판정 말(Proposed — '굽 재료를 쓰는' = ⑥-2 굽높이 근거 원문이 굽(ヒール)을 말함, 오너 입력이면 그대로 믿는다) */
export const HEEL_TERMS: readonly string[] = ['ヒール', 'HEEL', '힐', '굽'];

function compare(text: string): string {
  return text.normalize('NFKC').toUpperCase().replace(/\s+/gu, '');
}

/**
 * 고시 `height`를 넣는가(F-CT-19, US-15 AC3 — '굽 재료를 쓰는 여성화' 판정, Proposed): 후보 성별이 여성이고, ⑥-2 굽·밑창 높이에
 * 근거가 있고, 그 근거가 굽을 말할 때(원문 발췌에 `ヒール` 등 — `ソール高`·`厚底`는 밑창 높이라 빼고, 오너 입력은 굽으로 본다).
 * 남성화·근거 없음·밑창 높이만이면 키를 뺀다(사양 블록에는 근거가 있으면 밑창 높이를 적는다 — F-CT-28)
 */
export function includesHeight(gender: 'MALE' | 'FEMALE', heel: AssemblyHeel | null): boolean {
  if (gender !== 'FEMALE' || heel === null) return false;
  if (heel.ownerInput) return true;
  const quote = compare(heel.quote ?? '');
  return HEEL_TERMS.some((term) => quote.includes(compare(term)));
}

/** `약 3.5cm` */
export function heightText(heel: Pick<AssemblyHeel, 'value' | 'unit'>): string {
  return `약 ${heelCm(heel)}cm`;
}

/** 고시 `material`: `겉감 … / 안감 … / 밑창 …`(근거 없는 칸은 '정보 없음') */
export function materialNoticeText(materials: AssemblyMaterials): string {
  return [
    `겉감 ${materials.upper ?? NO_INFO}`,
    `안감 ${materials.lining ?? NO_INFO}`,
    `밑창 ${materials.sole ?? NO_INFO}`,
  ].join(' / ');
}

/** `제조자: {브랜드/제조사} / 수입자: {importer}`(F-CT-20) */
export function manufacturerText(brand: string | null, importer: string): string {
  return `제조자: ${brand?.trim() ? brand.trim() : MANUFACTURER_UNKNOWN} / 수입자: ${importer}`;
}

/** 고시 `color`: ⑥-2 색상 한국어 표기, 없으면 선택 색상 원문, 그것도 없으면 '상품상세 참조'(Proposed) */
export function colorNoticeText(
  facts: Pick<AssemblyFacts, 'colorKo' | 'selectedColorRaw'>,
): string {
  return facts.colorKo ?? facts.selectedColorRaw ?? REFER_TO_DETAIL;
}

export interface ShoesNoticeInput {
  facts: AssemblyFacts;
  sizes: readonly number[];
  gender: 'MALE' | 'FEMALE';
  brand: string | null;
  importer: string;
  /** 소재별 주의 문구가 비었을 때 쓸 기본 문장(설정 `content.cautionTemplates.default`) */
  cautionFallback: string;
  profile: {
    businessName: string;
    afterServicePhone: string;
    noticeFixedTexts: Readonly<Record<string, string>>;
  };
}

/** `SHOES` 고시 객체(규칙 5) */
export function mapShoesNotice(input: ShoesNoticeInput): ShoesNoticeFields {
  const fixed = input.profile.noticeFixedTexts;
  const notice: ShoesNoticeFields = {
    material: materialNoticeText(input.facts.materials),
    color: colorNoticeText(input.facts),
    size: formatSaleSizes(input.sizes),
    manufacturer: manufacturerText(input.brand, input.importer),
    caution: input.facts.caution ?? input.cautionFallback,
    warrantyPolicy: fixed.warrantyPolicy?.trim() || WARRANTY_POLICY_DEFAULT,
    afterServiceDirector: `${input.profile.businessName} / ${input.profile.afterServicePhone}`,
    returnCostReason: REFER_TO_DETAIL,
    noRefundReason: REFER_TO_DETAIL,
    qualityAssuranceStandard: REFER_TO_DETAIL,
    compensationProcedure: REFER_TO_DETAIL,
    troubleShootingContents: REFER_TO_DETAIL,
  };
  for (const key of REFER_TO_DETAIL_KEYS) {
    const text = fixed[key]?.trim();
    if (text) notice[key] = text;
  }
  if (includesHeight(input.gender, input.facts.heel)) {
    notice.height = heightText(input.facts.heel!);
  }
  return orderedNotice(notice);
}

/** 키 순서를 `SHOES_NOTICE_KEYS`로 맞춘다(없는 키는 넣지 않는다) */
export function orderedNotice(notice: ShoesNoticeFields): ShoesNoticeFields {
  const out: Record<string, string> = {};
  for (const key of SHOES_NOTICE_KEYS) {
    const value = notice[key];
    if (value !== undefined) out[key] = value;
  }
  return out as unknown as ShoesNoticeFields;
}
