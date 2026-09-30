import type { NoticeSettings } from '../../settings/schema/settings.types.js';
import type { CopyDraft } from '../copy/copy.schema.js';
import type { AssemblyFacts } from './assembly-facts.js';
import type { AssemblyGenerated, AssemblyOverrides, OriginAreaValue } from './assembly-fields.js';
import { activeConditions } from './disclosure/conditional-blocks.js';
import {
  renderDisclosure,
  type DisclosureBlockRecord,
  type RenderedDisclosure,
} from './disclosure/disclosure-renderer.js';
import { buildDetailHtml, finalizeHtml } from './html/detail-html.builder.js';
import { sanitizeHtml } from './html/html-sanitizer.js';
import type { OriginAreaPlan } from './notice/origin-code.resolver.js';
import {
  mapShoesNotice,
  orderedNotice,
  type ShoesNoticeFields,
  type ShoesNoticeKey,
} from './notice/shoes-notice.mapper.js';
import {
  brandSeriesOfKeyword,
  buildProductName,
  productTypeOfPath,
  representativeColor,
} from './product-name/product-name.builder.js';
import {
  buildSpecRows,
  parseSpecRows,
  renderSpecBlock,
  withSpecRow,
  type SpecRow,
} from './spec-block.renderer.js';

/**
 * ⑥-3 조립(P3-04 규칙 3~13 — AI 없이 규칙으로). ⑥-1 카피·⑥-2 원자료·후보 성별·③ 판매 사이즈·프로필·설정을 받아
 * `content_draft_assembly` 한 행의 값을 만든다. 오너 입력(notice.*·product_name·원산지 코드)은 생성 값 위에 덮어쓰고, 고시
 * `material`·`size`를 오너가 고쳤으면 사양 블록의 같은 행도 그 글로 바꾼다(사양 블록과 고시를 같게 — US-15 AC4).
 * 조건부 고지(가죽·정보 없음)는 ⑥-2 소재(근거)로 판정한다(오너 고시 문구로 다시 판정하지 않는다 — Proposed).
 */

/** 상품명 재료(규칙 13, product-name.builder.ts 출처 표) */
export interface AssemblyNaming {
  keyword: string | null;
  brandAttribute: string | null;
  modelCode: string | null;
  wholeCategoryName: string | null;
  parallelImport: boolean;
}

/** 조립에 쓰는 프로필 값(⑥-3 시작 전 빈칸 검사를 통과한 값) */
export interface AssemblyProfile {
  businessName: string;
  afterServicePhone: string;
  afterServiceGuide: string;
  importer: string;
  returnFeeKrw: number;
  maxPurchaseQuantityPerOrder: number;
  noticeFixedTexts: Readonly<Record<string, string>>;
}

export interface AssembleInput {
  copy: CopyDraft;
  facts: AssemblyFacts;
  sizes: readonly number[];
  gender: 'MALE' | 'FEMALE';
  profile: AssemblyProfile;
  notice: Pick<
    NoticeSettings,
    'blocks' | 'basisDate' | 'templateVersion' | 'aiImageLabel' | 'leatherTerms'
  > & { values: { deliveryDaysMin: number; deliveryDaysMax: number; exchangePolicy: string } };
  cautionFallback: string;
  origin: OriginAreaPlan;
  naming: AssemblyNaming;
}

/** `content_draft_assembly` 한 행의 값(id·step_run_id·created_at 빼고) */
export interface AssemblyRow {
  productName: string;
  noticeFields: ShoesNoticeFields;
  noticeSizesMm: number[];
  originAreaCode: string;
  originAreaPlural: boolean;
  originAreaContent: string | null;
  importer: string;
  specBlockHtml: string;
  specOriginLabel: string;
  disclosureTemplateVersion: string;
  disclosureTemplateDate: string;
  disclosureBlockIds: string[];
  disclosureBlocks: DisclosureBlockRecord[];
  html: string;
  htmlSha256: string;
}

export interface AssembleResult {
  row: AssemblyRow;
  generated: AssemblyGenerated;
  disclosure: RenderedDisclosure;
}

/** 상품명 제안(규칙 13) */
export function suggestProductName(input: {
  naming: AssemblyNaming;
  facts: Pick<AssemblyFacts, 'colorKo'>;
  gender: 'MALE' | 'FEMALE';
}): string {
  const fromKeyword = brandSeriesOfKeyword(input.naming.keyword);
  return buildProductName({
    brand: fromKeyword.brand ?? input.naming.brandAttribute,
    series: fromKeyword.brand ? fromKeyword.series : null,
    modelName: input.naming.modelCode,
    productType: productTypeOfPath(input.naming.wholeCategoryName),
    color: representativeColor(input.facts.colorKo),
    gender: input.gender,
    parallelImport: input.naming.parallelImport,
  });
}

/** 고시 제조자 표기에 쓰는 브랜드(키워드 첫 낱말 → ② 브랜드 속성) */
export function brandOf(naming: AssemblyNaming): string | null {
  return brandSeriesOfKeyword(naming.keyword).brand ?? naming.brandAttribute;
}

/** 고시 덮어쓰기(null = 키 빼기 — `height`) */
export function withNoticeOverrides(
  notice: ShoesNoticeFields,
  overrides: Partial<Record<ShoesNoticeKey, string | null>>,
): ShoesNoticeFields {
  const out: Record<string, string> = { ...notice };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete out[key];
    else if (value !== undefined) out[key] = value;
  }
  return orderedNotice(out as unknown as ShoesNoticeFields);
}

/** 사양 블록 행에 고시 `material`·`size` 오너 값을 반영한다(사양 블록 = 고시) */
export function specRowsWithOverrides(
  rows: readonly SpecRow[],
  overrides: Partial<Record<ShoesNoticeKey, string | null>>,
): SpecRow[] {
  let out = [...rows];
  const material = overrides.material;
  if (typeof material === 'string' && material.trim() !== '') {
    out = withSpecRow(out, { key: 'MATERIAL', value: material.trim() });
  }
  const size = overrides.size;
  if (typeof size === 'string' && size.trim() !== '') {
    out = withSpecRow(out, { key: 'SIZE', value: size.trim() });
  }
  return out;
}

/** 조립(규칙 3~13) */
export function assemble(input: AssembleInput, overrides: AssemblyOverrides): AssembleResult {
  const generatedNotice = mapShoesNotice({
    facts: input.facts,
    sizes: input.sizes,
    gender: input.gender,
    brand: brandOf(input.naming),
    importer: input.profile.importer,
    cautionFallback: input.cautionFallback,
    profile: input.profile,
  });
  const generatedOrigin: OriginAreaValue = {
    code: input.origin.code,
    content: input.origin.content,
    plural: input.origin.plural,
  };
  const generatedName = suggestProductName(input);
  const origin = overrides.origin ?? generatedOrigin;
  const specRows = specRowsWithOverrides(
    buildSpecRows({
      specOriginLabel: input.origin.specOriginLabel,
      facts: input.facts,
      sizes: input.sizes,
    }),
    overrides.notice,
  );
  const specBlockHtml = sanitizeHtml(renderSpecBlock(specRows));
  const disclosure = renderDisclosure(
    input.notice,
    {
      businessName: input.profile.businessName,
      deliveryDaysMin: input.notice.values.deliveryDaysMin,
      deliveryDaysMax: input.notice.values.deliveryDaysMax,
      maxPurchaseQuantityPerOrder: input.profile.maxPurchaseQuantityPerOrder,
      returnFeeKrw: input.profile.returnFeeKrw,
      exchangePolicy: input.notice.values.exchangePolicy,
      afterServiceGuide: input.profile.afterServiceGuide,
      basisDate: input.notice.basisDate,
    },
    activeConditions({ materials: input.facts.materials, notice: input.notice }),
  );
  const { html, htmlSha256 } = buildDetailHtml({
    disclosureHtml: disclosure.html,
    copy: input.copy,
    specBlockHtml,
  });
  return {
    row: {
      productName: overrides.productName ?? generatedName,
      noticeFields: withNoticeOverrides(generatedNotice, overrides.notice),
      noticeSizesMm: [...new Set(input.sizes)].sort((a, b) => a - b),
      originAreaCode: origin.code,
      originAreaPlural: origin.plural,
      originAreaContent: origin.content,
      importer: input.profile.importer,
      specBlockHtml,
      specOriginLabel: input.origin.specOriginLabel,
      disclosureTemplateVersion: disclosure.templateVersion,
      disclosureTemplateDate: disclosure.templateDate,
      disclosureBlockIds: disclosure.blockIds,
      disclosureBlocks: disclosure.blocks,
      html,
      htmlSha256,
    },
    generated: { productName: generatedName, notice: generatedNotice, origin: generatedOrigin },
    disclosure,
  };
}

/**
 * 오너 수정(EDIT)을 저장된 행에 반영한다(규칙 14·15). 사양 블록은 저장된 행 표식으로 같은 행만 바꾸고, HTML 안의 사양 구획을
 * 바꾼 뒤 다시 정리·해시한다(고지·카피·이미지 구획은 그대로 — 고지 블록은 고칠 수 없다)
 */
export function applyEditToRow(row: AssemblyRow, edits: AssemblyOverrides): AssemblyRow {
  const next: AssemblyRow = {
    ...row,
    noticeFields: withNoticeOverrides(row.noticeFields, edits.notice),
  };
  if (edits.productName !== undefined) next.productName = edits.productName;
  if (edits.origin) {
    next.originAreaCode = edits.origin.code;
    next.originAreaPlural = edits.origin.plural;
    next.originAreaContent = edits.origin.content;
  }
  if (edits.notice.material !== undefined || edits.notice.size !== undefined) {
    const rows = specRowsWithOverrides(parseSpecRows(row.specBlockHtml), edits.notice);
    const specBlockHtml = sanitizeHtml(renderSpecBlock(rows));
    if (!row.html.includes(row.specBlockHtml)) {
      throw new Error('저장된 상세 HTML에서 사양 블록을 찾지 못했습니다');
    }
    const { html, htmlSha256 } = finalizeHtml(
      row.html.replace(row.specBlockHtml, () => specBlockHtml),
    );
    Object.assign(next, { specBlockHtml, html, htmlSha256 });
  }
  return next;
}
