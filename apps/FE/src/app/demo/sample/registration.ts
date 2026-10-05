import {
  approvalPreview,
  preValidationResult,
  registrationDetail,
  registrationSummary,
  uploadResultImage,
  uploadResultOutput,
} from '@/test/fixtures/registration';
import type { DemoWorld } from '../demoWorld';
import { DEMO_IMAGE_ID } from '../images';
import type { RegistrationRec, RunRec } from '../world/state';
import { detailHtml, noticeFields } from './content';
import { DEMO_IDS, STORY } from './story';
import { fakeSha256 } from './util';
import type { Ok, Schema } from './types';

type OptionType = Schema<'RegistrationOptionType'>;
type FinalTag = Schema<'FinalTagItem'>;
type Duplicate = Schema<'ApprovalDuplicateInfo'>;

const iso = (ms: number): string => new Date(ms).toISOString();
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : iso(ms));

/** ⑧이 받은 업로드 주소(스킴 없이 — 소스 규칙 15. 화면은 이 주소를 부르지 않고 imageAssetId의 로컬 파일을 쓴다) */
export const UPLOAD_URLS = [
  'shop-phinf.pstatic.net/example/upload-1.jpg',
  'shop-phinf.pstatic.net/example/upload-2.jpg',
] as const;

/** ⑧이 올린 상세 HTML(⑥-3 조립 + 업로드 주소) */
function uploadedDetail(): string {
  return detailHtml(UPLOAD_URLS);
}

/** ⑧ 산출물 id: 실행 버전마다 하나(v1 = 예시 번호) */
export const uploadResultIdOf = (run: RunRec): number => DEMO_IDS.uploadResult + run.version - 1;

/** 판매자관리코드 `RKT:{itemCode}:{색상 코드}` */
export function sellerCodeOf(w: DemoWorld): string {
  const candidate = w.candidate();
  return `RKT:${candidate.itemCode ?? STORY.itemCode}:${candidate.anchorColorCode ?? STORY.colorCode}`;
}

/**
 * ⑧ 이미지 업로드 한 버전: ⑤ 선택본 2장을 1000×1000 JPEG로 올렸다(대표 · 추가 1). `first`는 이미지를 처음 올린 실행과 시각이라, 그
 * 뒤 실행이 같은 주소를 다시 쓰면 `reused`가 참이다(BE: 올린 시각 < 이 실행 시작 시각 — 여기서는 처음 올린 실행이 아니면).
 */
export function uploadResult(
  w: DemoWorld,
  run: RunRec,
  isCurrent: boolean,
  first: { runId: number; uploadedAt: number },
): Ok<'/candidates/{candidateId}/upload-result'> {
  const ids = [DEMO_IMAGE_ID.upload1, DEMO_IMAGE_ID.upload2];
  return uploadResultOutput({
    stepRunId: run.id,
    candidateId: w.candidate().id,
    version: run.version,
    stepRunStatus: run.status,
    isCurrent,
    uploadResultId: uploadResultIdOf(run),
    detailContent: uploadedDetail(),
    detailContentSha256: fakeSha256('uploaded-detail'),
    createdAt: iso(run.endedAt ?? w.now()),
    images: UPLOAD_URLS.map((url, sortOrder) =>
      uploadResultImage({
        id: run.id * 10 + sortOrder + 1,
        uploadedImageId: sortOrder + 11,
        sortOrder,
        url,
        imageAssetId: ids[sortOrder],
        sourceSha256: fakeSha256(`selection-${sortOrder}`),
        uploadedAt: iso(first.uploadedAt),
        traceId: `demo-trace-upload-${sortOrder + 1}`,
        reused: first.runId !== run.id,
      }),
    ),
  });
}

/** 요청 JSON 초안(R04 골격 — 비밀값 없음). fixture 골격에 상품명·가격·이미지·판매자관리코드·태그·전시 모드를 채운다 */
function requestJsonDraft(
  base: Record<string, unknown>,
  input: {
    sellerCode: string;
    salePriceKrw: number;
    tags: readonly FinalTag[];
    displayStatusType: 'SUSPENSION' | 'ON';
  },
) {
  const origin = (base.originProduct ?? {}) as Record<string, unknown>;
  const detail = (origin.detailAttribute ?? {}) as Record<string, unknown>;
  const channel = (base.smartstoreChannelProduct ?? {}) as Record<string, unknown>;
  return {
    ...base,
    originProduct: {
      ...origin,
      leafCategoryId: STORY.leafCategoryId,
      name: STORY.productName,
      salePrice: input.salePriceKrw,
      images: {
        representativeImage: { url: UPLOAD_URLS[0] },
        optionalImages: [{ url: UPLOAD_URLS[1] }],
      },
      detailAttribute: {
        ...detail,
        sellerCodeInfo: { sellerManagementCode: input.sellerCode },
        seoInfo: { sellerTags: input.tags.map((tag) => ({ text: tag.text })) },
      },
    },
    smartstoreChannelProduct: {
      ...channel,
      channelProductDisplayStatusType: input.displayStatusType,
    },
  };
}

/** 중복 없음 */
export const NO_DUPLICATE: Duplicate = {
  duplicated: false,
  existingRegistrationId: null,
  originProductNo: null,
  channelProductNo: null,
  source: null,
  registeredAt: null,
  smartstoreProductUrl: null,
};

/** ③ 판정 → 승인 미리보기의 '비용 분해'(판정 사이즈 표를 승인 사이즈 표로 옮긴다. 라쿠텐 재고는 예시 3개) */
function marginBreakdownOf(
  judgement: Ok<'/candidates/{candidateId}/price-judgement'>,
  base: Schema<'ApprovalMarginBreakdown'>,
): Schema<'ApprovalMarginBreakdown'> {
  return {
    couponYen: judgement.couponYen,
    shippingYen: judgement.shippingYen,
    shippingEstimated: judgement.shippingEstimated,
    cShipIntlKrw: judgement.cShipIntlKrw,
    cFwdKrw: judgement.cFwdKrw,
    fwdCouponKrw: judgement.fwdCouponKrw,
    fwdAssumed: judgement.fwdAssumed,
    vatMode: judgement.vatMode,
    pricingRule: judgement.pricingRule,
    targetMarginRate: judgement.targetMarginRate,
    minProfitKrw: judgement.minProfitKrw,
    sizes: judgement.sizes.map((size, index) => ({
      ...(base.sizes[index] ?? base.sizes[0]!),
      sizeMm: size.sizeMm,
      skuPriceYen: size.skuPriceYen,
      cGoodsKrw: size.cGoodsKrw,
      vUsd: size.vUsd,
      isDutyFree: size.isDutyFree,
      isBoundary: size.isBoundary,
      cTaxKrw: size.cTaxKrw,
      pMinKrw: size.pMinKrw,
      optionPriceKrw: size.optionPriceKrw,
      sizeSalePriceKrw: size.sizeSalePriceKrw,
      cMktKrw: size.cMktKrw,
      vatAKrw: size.vatAKrw,
      vatBKrw: size.vatBKrw,
      profitAKrw: size.profitAKrw,
      profitBKrw: size.profitBKrw,
      marginRateA: size.marginRateA,
      isSellable: size.isSellable,
      unsellableReason: size.unsellableReason,
    })),
  };
}

/** 승인 미리보기를 만드는 데 필요한, 모델이 읽어 온 값 */
export interface ApprovalFacts {
  optionType: OptionType;
  apiBlocked: boolean;
  /** ⑧ 현재 실행·산출물 */
  upload: { run: RunRec; resultId: number };
  tags: readonly FinalTag[];
  /** ③ 판정 결과(국내 기준가에 따라 판매가·순이익이 달라진다) — 판정 시각·라쿠텐 페이지 수집 시각·유효 끝도 여기서 읽는다 */
  judgement: Ok<'/candidates/{candidateId}/price-judgement'>;
  /** 진행 중·등록됨 건수(처음 N건 셈) */
  liveRegistrationCount: number;
  displayStatusType: 'SUSPENSION' | 'ON';
  duplicate: Duplicate;
  approveDisabledReason: { code: string; message: string } | null;
}

/**
 * G4 승인 미리보기(승인대기 여정만 — 아니면 BE가 409). 승인 버튼 켜짐(`approveEnabled`)은 `approveDisabledReason`이 없을 때다.
 */
export function approvalPreviewOf(
  w: DemoWorld,
  facts: ApprovalFacts,
): Ok<'/candidates/{candidateId}/approval'> {
  const candidate = w.candidate();
  const base = approvalPreview(candidate.id);
  const sellerCode = sellerCodeOf(w);
  return {
    ...base,
    candidateStatus: 'AWAITING_APPROVAL',
    optionType: facts.optionType,
    apiBlocked: facts.apiBlocked,
    productName: STORY.productName,
    salePriceKrw: facts.judgement.salePriceKrw ?? STORY.salePriceKrw,
    priceJudgementId: facts.judgement.id,
    uploadResultId: facts.upload.resultId,
    judgedAt: facts.judgement.judgedAt,
    rakutenPageCollectedAt: facts.judgement.rakutenPageCollectedAt,
    judgementExpiresAt: facts.judgement.pageValidUntil,
    marginBreakdown: marginBreakdownOf(facts.judgement, base.marginBreakdown),
    images: UPLOAD_URLS.map((url, sortOrder) => ({
      role: sortOrder === 0 ? ('REPRESENTATIVE' as const) : ('ADDITIONAL' as const),
      sortOrder,
      url,
    })),
    detailContent: uploadedDetail(),
    noticeFields: noticeFields(),
    originAreaCode: '0200036',
    originAreaContent: null,
    originLabel: '베트남',
    leafCategoryId: candidate.leafCategoryId ?? STORY.leafCategoryId,
    wholeCategoryName: candidate.wholeCategoryName ?? STORY.wholeCategoryName,
    tags: [...facts.tags],
    sourcingMethod: {
      method: 'COMPARED',
      creationPath: 'KEYWORD',
      noComparisonConfirmedAt: null,
      itemCode: candidate.itemCode ?? STORY.itemCode,
    },
    requestJsonDraft: requestJsonDraft(base.requestJsonDraft, {
      sellerCode,
      salePriceKrw: facts.judgement.salePriceKrw ?? STORY.salePriceKrw,
      tags: facts.tags,
      displayStatusType: facts.displayStatusType,
    }),
    sellerManagementCode: sellerCode,
    displayStatusType: facts.displayStatusType,
    duplicate: facts.duplicate,
    approveEnabled: facts.approveDisabledReason === null,
    approveDisabledReason: facts.approveDisabledReason,
    warnings: [],
    standardOptionSupported: false,
    liveRegistrationCount: facts.liveRegistrationCount,
    initialSuspensionCount: 10,
  };
}

/** G4 사전 검증(15개). `failed`로 코드별 실패를 줄 수 있다. 상태를 바꾸지 않는 계산이다 */
export function preValidation(
  w: DemoWorld,
  failed: Parameters<typeof preValidationResult>[1] = {},
  checkedAt: number = w.now(),
): Ok<'/candidates/{candidateId}/pre-validations', 'post'> {
  return {
    ...preValidationResult(w.candidate().id, failed),
    checkedAt: iso(checkedAt),
    duplicate: NO_DUPLICATE,
  };
}

/** 등록 기록 이력 한 줄 */
export function registrationSummaryOf(
  w: DemoWorld,
  rec: RegistrationRec,
): Schema<'RegistrationSummary'> {
  return registrationSummary({
    registrationId: rec.id,
    stepRunId: rec.stepRunId,
    stepRunVersion: rec.version,
    status: rec.status,
    sellerManagementCode: sellerCodeOf(w),
    optionType: rec.optionType,
    displayStatusType: rec.displayStatusType,
    approvedAt: iso(rec.approvedAt),
    registeredAt: isoOrNull(rec.registeredAt),
    originProductNo: rec.originProductNo,
    httpStatus: rec.httpStatus,
    createdAt: iso(rec.approvedAt),
  });
}

/** 등록 기록 상세(request_json 없음). 승인 직전 사전 검증 결과가 `validationResult`에 남는다 */
export function registrationOf(
  w: DemoWorld,
  rec: RegistrationRec,
): Ok<'/registrations/{registrationId}'> {
  const candidate = w.candidate();
  const summary = registrationSummaryOf(w, rec);
  return registrationDetail(candidate.id, {
    registrationId: rec.id,
    stepRunId: rec.stepRunId,
    priceJudgementId: rec.priceJudgementId ?? DEMO_IDS.priceJudgement,
    uploadResultId: rec.uploadResultId ?? DEMO_IDS.uploadResult,
    status: rec.status,
    itemCode: candidate.itemCode ?? STORY.itemCode,
    selectedColor: candidate.selectedColor ?? STORY.selectedColor,
    colorCode: candidate.anchorColorCode ?? STORY.colorCode,
    sellerManagementCode: summary.sellerManagementCode,
    displayStatusType: rec.displayStatusType,
    optionType: rec.optionType,
    validationResult: {
      ...preValidation(w, {}, rec.approvedAt),
      sellerCodeLookup: { ok: true, product: null },
    },
    approvedAt: summary.approvedAt,
    requestSentAt: isoOrNull(rec.requestSentAt),
    responseReceivedAt: isoOrNull(rec.responseReceivedAt),
    registeredAt: summary.registeredAt ?? null,
    originProductNo: rec.originProductNo,
    channelProductNo: rec.channelProductNo,
    httpStatus: rec.httpStatus,
    traceId: rec.traceId,
    smartstoreProductUrl: null,
    createdAt: summary.createdAt,
    updatedAt: iso(rec.responseReceivedAt ?? rec.approvedAt),
  });
}

/** 승인 응답(202) — 첫 응답: 드라이런은 VALIDATED, 실등록은 REGISTERING */
export function registrationAccepted(
  w: DemoWorld,
  rec: RegistrationRec,
): Schema<'RegistrationAccepted'> {
  return {
    registrationId: rec.id,
    stepRunId: rec.stepRunId,
    candidateId: w.candidate().id,
    status: rec.status === 'VALIDATED' ? 'VALIDATED' : 'REGISTERING',
    sellerManagementCode: sellerCodeOf(w),
    displayStatusType: rec.displayStatusType,
    approvedAt: iso(rec.approvedAt),
  };
}
