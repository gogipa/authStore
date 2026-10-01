import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  extractDisclosureBlocks,
  fillImagePlaceholders,
  renderedBlockSha256,
} from '../../../../src/common/rules/detail-html.js';
import { NOTICE_REQUIRED_KEYS } from '../../../../src/modules/content/assembly/content-output.reader.js';
import type { ApprovalInputs } from '../../../../src/modules/registration/draft/approval-inputs.js';
import {
  buildRegistrationDraft,
  type RegistrationDraft,
} from '../../../../src/modules/registration/draft/registration-draft.builder.js';
import type {
  PreValidationContext,
  RestrictedTagsLookup,
} from '../../../../src/modules/registration/pre-validation/pre-validation.types.js';
import { readDefaultSettingsText } from '../../../../src/modules/settings/defaults/default-settings.js';
import { buildProfileFragment } from '../../../../src/modules/settings/purchase-agency-profile/profile-registration-fragment.js';
import type { AppSettings } from '../../../../src/modules/settings/schema/settings.types.js';
import { validProfileInput } from '../../settings/purchase-agency-profile/profile-fixtures.js';
import { placeholderHtml } from '../upload/seed-upload-ready.js';

/**
 * 최종 승인·사전 검증 fixture(P4-02 §5 fixtures). 모두 **합성 값**이다(화면시안_명세 §4 후보 A — 아식스 젤카야노 14 · 크림/블랙,
 * 판매가 167,300원, 판매 사이즈 250~265·275mm). `baseApprovalInputs()`는 검사 15개가 모두 통과하는 입력 묶음이고, 항목별 실패 변형
 * (`*.json`)은 그 위에 덧쓰는 조각이다(`applyVariant`). e2e 시드(`seed-approvable-candidate.ts`)가 같은 값을 DB에 넣는다.
 * 실제 상품·상호·주소가 아니다(자리표시자). 업로드 URL은 가짜 shop-phinf 주소다(브라우저·테스트가 부르지 않는다).
 */
export const APPROVAL_FIXTURE_DIR = import.meta.dirname;

/** 화면시안 후보 A 값 */
export const APPROVAL_SAMPLE = {
  itemCode: 'shop-a:10000123',
  itemUrl: 'https://item.rakuten.co.jp/shop-a/10000123/',
  selectedColor: '크림/블랙',
  anchorModelCode: '1201A019108',
  anchorColorCode: '108',
  leafCategoryId: '50000830',
  wholeCategoryName: '패션잡화>남성신발>운동화>러닝화',
  productName: '아식스 젤카야노14 1201A019-108 러닝화 크림 남성',
  salePriceKrw: 167300,
  /** 판정에 쓴 페이지 수집 시각 = 14:02 KST(6시간 → 20:02까지) */
  collectedAt: '2026-09-28T05:02:00.000Z',
  /** 검사 시각(수집 58분 뒤) */
  now: '2026-09-28T06:00:00.000Z',
  saleSizesMm: [250, 255, 260, 265, 275],
  uploadUrls: [
    'https://shop-phinf.pstatic.net/20260928_1/fixture-approval-0.jpg',
    'https://shop-phinf.pstatic.net/20260928_1/fixture-approval-1.jpg',
  ],
  /** 보드 태그 10개(앞 넷은 추천 사전 코드가 있다 — 가짜 코드) */
  tags: [
    { text: '젤카야노14', code: '7000001' },
    { text: '아식스운동화', code: '7000002' },
    { text: '조깅화', code: '7000003' },
    { text: '남자운동화', code: '7000004' },
    { text: '데일리운동화', code: null },
    { text: '레트로운동화', code: null },
    { text: '크림운동화', code: null },
    { text: '쿠션운동화', code: null },
    { text: '가벼운운동화', code: null },
    { text: '커플운동화', code: null },
  ],
} as const;

/** 기본 설정 템플릿(앱 내장 기본값 — 고지 템플릿은 앱 내장 해시와 같다) */
export function defaultSettings(): AppSettings {
  return JSON.parse(readDefaultSettingsText()) as AppSettings;
}

/** ⑥-3 HTML(P3-04 스냅샷)의 자리표시자를 업로드 URL로 채운 최종 detailContent(⑧) */
export function approvalDetailContent(html = placeholderHtml()): string {
  return fillImagePlaceholders(html, (slot) => APPROVAL_SAMPLE.uploadUrls[slot] ?? null);
}

/** ⑥-3이 기록했을 고지 블록 해시(HTML에서 다시 계산 — 조건부 블록 표시 포함) */
export function disclosureRecordsOf(
  html: string,
): { blockId: string; sha256: string; conditional: boolean }[] {
  return extractDisclosureBlocks(html).map((block) => ({
    blockId: block.blockId,
    sha256: renderedBlockSha256(block.text),
    conditional: block.blockId === 'LEATHER_SAFETY' || block.blockId === 'AI_IMAGE',
  }));
}

/** SHOES 고시(남성 — 굽높이 없음) */
export function approvalNoticeFields(): Record<string, string> {
  return {
    material: '겉감 합성섬유·합성가죽 / 밑창 고무',
    color: '크림',
    size: '250~265·275mm (JP 25.0~26.5·27.5cm)',
    manufacturer: '제조자: ASICS / 수입자: [수입자](구매대행)',
    caution: '직사광선과 높은 온도를 피해 서늘한 곳에 보관해 주세요.',
    warrantyPolicy: '소비자분쟁해결기준에 따름',
    afterServiceDirector: '[내 상호] [A/S 연락처]',
    returnCostReason: '상품상세 참조',
    noRefundReason: '상품상세 참조',
    qualityAssuranceStandard: '상품상세 참조',
    compensationProcedure: '상품상세 참조',
    troubleShootingContents: '상품상세 참조',
  };
}

/** 카피 글(⑥-1 — test/fixtures/content/assembly/copy.json과 같은 문장) */
export function approvalCopyTexts(): string[] {
  return [
    '뒤꿈치 GEL 쿠션, 크림/블랙 젤카야노 14',
    '충격 흡수가 뛰어난 GEL 쿠션',
    '2008년 모델을 되살린 복각판',
    '크림 바탕에 <b>블랙</b> 라인 포인트',
    '러닝화 모양을 그대로 살린 복각 모델입니다.\n크림 톤에 블랙 라인이 들어가 데님·슬랙스 어디에나 어울립니다.',
    '발등을 편하게 감싸는 착화감입니다.',
    '평소 신는 운동화 사이즈를 고르세요.',
  ];
}

/** 판정 사이즈 한 줄(PRD §8.3 예시 — 모드 A 순이익 27,418원·모드 B 16,259원) */
function judgedSize(sizeMm: number) {
  return {
    sizeMm,
    skuPriceYen: 12000,
    cGoodsKrw: 107748,
    vUsd: 77.37,
    isDutyFree: true,
    isBoundary: false,
    cTaxKrw: 0,
    pMinKrw: 153100,
    optionPriceKrw: 0,
    sizeSalePriceKrw: 167300,
    cMktKrw: 11092,
    vatAKrw: 3042,
    vatBKrw: 14201,
    profitAKrw: 27418,
    profitBKrw: 16259,
    marginRateA: 0.1639,
    isSellable: true,
    unsellableReason: null,
  };
}

/** 검사 15개가 모두 통과하는 입력 묶음 */
export function baseApprovalInputs(): ApprovalInputs {
  const settings = defaultSettings();
  const detailContent = approvalDetailContent();
  const profile = validProfileInput();
  const fragment = buildProfileFragment(
    profile,
    {
      shipping: { id: 1, addressBookNo: '100000001' },
      return: { id: 2, addressBookNo: '100000002' },
    },
    { id: 1, code: 'CJGLS' },
  );
  const steps: ApprovalInputs['steps'] = {};
  const codes = [
    'SOURCING',
    'PRICING',
    'CATEGORY',
    'THUMBNAIL',
    'COPY',
    'NOTICE_RAW',
    'NOTICE_HTML',
    'TAGS',
    'UPLOAD',
  ] as const;
  codes.forEach((code, i) => {
    steps[code] = { status: 'COMPLETED', currentStepRunId: 101 + i };
  });
  steps.REGISTER = { status: 'NOT_RUN', currentStepRunId: null };
  return {
    candidate: {
      id: 12,
      status: 'AWAITING_APPROVAL',
      creationPath: 'KEYWORD',
      itemCode: APPROVAL_SAMPLE.itemCode,
      selectedColor: APPROVAL_SAMPLE.selectedColor,
      anchorModelCode: APPROVAL_SAMPLE.anchorModelCode,
      anchorItemCode: null,
      anchorColorCode: APPROVAL_SAMPLE.anchorColorCode,
      gender: 'MALE',
      leafCategoryId: APPROVAL_SAMPLE.leafCategoryId,
      wholeCategoryName: APPROVAL_SAMPLE.wholeCategoryName,
      noComparisonConfirmedAt: null,
    },
    steps,
    gates: {
      G2: { valid: true, passedAt: '2026-09-28T05:12:00.000Z', changedBasisKeys: [] },
      G3: { valid: true, passedAt: '2026-09-28T05:20:00.000Z', changedBasisKeys: [] },
    },
    sourcing: {
      sourcingStepRunId: 101,
      comparisonPerformed: true,
      itemCode: APPROVAL_SAMPLE.itemCode,
      itemUrl: APPROVAL_SAMPLE.itemUrl,
      sizes: [
        { sizeMm: 250, status: 'IN_STOCK', quantity: 3 },
        { sizeMm: 255, status: 'IN_STOCK', quantity: 2 },
        { sizeMm: 260, status: 'IN_STOCK', quantity: 5 },
        { sizeMm: 265, status: 'IN_STOCK', quantity: 3 },
        { sizeMm: 270, status: 'SOLD_OUT', quantity: 0 },
        { sizeMm: 275, status: 'IN_STOCK', quantity: 4 },
        { sizeMm: 280, status: 'BACK_ORDER', quantity: 0 },
        { sizeMm: 285, status: 'SOLD_OUT', quantity: 0 },
      ],
    },
    judgement: {
      priceJudgementId: 7,
      pricingStepRunId: 102,
      rakutenPageCollectedAt: APPROVAL_SAMPLE.collectedAt,
      judgedAt: '2026-09-28T05:10:00.000Z',
      isSaleCandidate: true,
      salePriceKrw: APPROVAL_SAMPLE.salePriceKrw,
      couponYen: 0,
      shippingYen: 0,
      shippingEstimated: false,
      cShipIntlKrw: 15000,
      cFwdKrw: 15000,
      fwdCouponKrw: 0,
      fwdAssumed: true,
      vatMode: 'A',
      pricingRule: 'REF_MINUS_1PCT',
      targetMarginRate: '0.1000',
      minProfitKrw: 5000,
      sizes: APPROVAL_SAMPLE.saleSizesMm.map(judgedSize),
    },
    category: {
      categoryStepRunId: 103,
      leafCategoryId: APPROVAL_SAMPLE.leafCategoryId,
      wholeCategoryName: APPROVAL_SAMPLE.wholeCategoryName,
      genderPathMatch: true,
      exceptionDecision: 'PASS',
      certificationExcludeContent: null,
      kcExemptAdultConfirmedAt: null,
    },
    categoryLeaf: { exists: true, removed: false },
    thumbnail: {
      thumbnailStepRunId: 104,
      uncheckedChecklistKeys: [],
      sameProductColorConfirmedAt: null,
      references: [
        {
          imageAssetId: 21,
          sourceItemCode: APPROVAL_SAMPLE.itemCode,
          sourceModelCodeNorm: APPROVAL_SAMPLE.anchorModelCode,
          sourceColorCode: APPROVAL_SAMPLE.anchorColorCode,
        },
      ],
    },
    copy: { copyStepRunId: 105, texts: approvalCopyTexts() },
    facts: {
      noticeRawStepRunId: 106,
      origin: {
        countries: ['베트남'],
        valueSource: 'GENERATED',
        extractionMethod: 'SKU_ATTRIBUTE',
        evidenceUrl: APPROVAL_SAMPLE.itemUrl,
        basisItemCode: APPROVAL_SAMPLE.itemCode,
      },
      materials: { upper: '합성섬유·합성가죽', lining: null, sole: '고무' },
      rechecks: [],
    },
    assembly: {
      noticeHtmlStepRunId: 107,
      productName: APPROVAL_SAMPLE.productName,
      noticeFields: approvalNoticeFields(),
      noticeRequiredKeys: [...NOTICE_REQUIRED_KEYS],
      noticeSizesMm: [...APPROVAL_SAMPLE.saleSizesMm],
      specSizesMm: [...APPROVAL_SAMPLE.saleSizesMm],
      originAreaCode: '0200037',
      originAreaPlural: false,
      originAreaContent: null,
      importer: '[수입자]',
      specOriginLabel: '베트남',
      disclosureBlocks: disclosureRecordsOf(placeholderHtml()),
      rechecks: [],
    },
    tags: {
      tagsStepRunId: 108,
      tags: APPROVAL_SAMPLE.tags.map((tag, i) => ({ ...tag, finalOrder: i + 1 })),
      sellerTags: APPROVAL_SAMPLE.tags.map((tag) =>
        tag.code ? { code: tag.code, text: tag.text } : { text: tag.text },
      ),
    },
    upload: {
      uploadResultId: 9,
      uploadStepRunId: 109,
      detailContent,
      images: APPROVAL_SAMPLE.uploadUrls.map((url, i) => ({
        role: i === 0 ? 'REPRESENTATIVE' : 'ADDITIONAL',
        sortOrder: i,
        url,
        uploadedImageId: 41 + i,
        imageAssetId: 31 + i,
        width: 1000,
        height: 1000,
        referenceOnlyInChain: false,
      })),
    },
    knownUploadUrls: [...APPROVAL_SAMPLE.uploadUrls],
    profile: { fragment, fragmentError: null },
    settings: {
      judgementValidityHours: settings.safety.judgementValidityHours,
      minBlockWords: settings.safety.minBlockWords,
      originConfusionWords: settings.safety.originConfusionWords,
      extraChargeWords: settings.safety.extraChargeWords,
      notice: {
        blocks: settings.notice.blocks,
        leatherTerms: settings.notice.leatherTerms,
        aiImageLabel: settings.notice.aiImageLabel,
      },
      initialSuspensionCount: settings.registration.initialSuspensionCount,
      optionStockCap: settings.registration.optionStockCap,
    },
    registrations: { liveCount: 3, inProgress: null, duplicate: null },
    apiBlocked: true,
  };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 조각 덧쓰기: 객체는 키마다 재귀, 배열 자리에 `{ "0": … }`처럼 숫자 키 객체가 오면 그 원소만 덧쓴다(나머지 배열은 그대로), 그 밖은
 * 바꿔 끼운다.
 */
export function mergePatch<T>(target: T, patch: unknown): T {
  if (
    Array.isArray(target) &&
    isPlainObject(patch) &&
    Object.keys(patch).every((k) => /^\d+$/.test(k))
  ) {
    const out = [...target] as unknown[];
    for (const [key, value] of Object.entries(patch))
      out[Number(key)] = mergePatch(out[Number(key)], value);
    return out as T;
  }
  if (isPlainObject(target) && isPlainObject(patch)) {
    const out: Record<string, unknown> = { ...target };
    for (const [key, value] of Object.entries(patch)) out[key] = mergePatch(out[key], value);
    return out as T;
  }
  return patch as T;
}

/** 변형 조각 파일 모양 */
export interface ApprovalVariant {
  _note?: string;
  inputs?: Json;
  draft?: Json;
  now?: string;
  restrictedTags?: RestrictedTagsLookup;
}

export function readVariant(name: string): ApprovalVariant {
  return JSON.parse(readFileSync(join(APPROVAL_FIXTURE_DIR, name), 'utf8')) as ApprovalVariant;
}

export function readFixtureText(name: string): string {
  return readFileSync(join(APPROVAL_FIXTURE_DIR, name), 'utf8');
}

/** 기본 입력 → 초안 → 검사 문맥(조각을 차례로 덧쓴다: inputs → 초안 만들기 → draft) */
export function approvalContext(
  variant: ApprovalVariant = {},
  options: { optionType?: 'COMBINATION' | 'STANDARD' } = {},
): PreValidationContext {
  const inputs = mergePatch(baseApprovalInputs(), variant.inputs ?? {});
  const built: RegistrationDraft = buildRegistrationDraft(inputs, {
    optionType: options.optionType ?? 'COMBINATION',
  });
  const draft = mergePatch(built, variant.draft ?? {});
  return {
    inputs,
    draft,
    now: new Date(variant.now ?? APPROVAL_SAMPLE.now),
    restrictedTags: variant.restrictedTags ?? { ok: true, restrictedTags: [] },
  };
}

/** 변형 파일 이름으로 문맥 */
export function variantContext(name: string): PreValidationContext {
  return approvalContext(readVariant(name));
}
