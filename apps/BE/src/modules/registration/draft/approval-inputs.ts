import type { ProfileRegistrationFragment } from '../../settings/purchase-agency-profile/profile-registration-fragment.js';
import type { NoticeBlock } from '../../settings/schema/settings.types.js';
import type { StepCode, StepStatus } from '../../step-engine/domain/steps.js';

/**
 * 최종 승인 미리보기·사전 검증의 입력 묶음(P4-02 §5 `approval-inputs.loader.ts`가 만든다) — **순수 데이터**(JSON으로 옮길 수 있는
 * 값만, 시각은 ISO 글자). 요청 초안 빌더(`registration-draft.builder.ts`)와 검사 함수(`pre-validation/checks/*.check.ts`)는 이것만
 * 읽는다 — DB·Nest·시계를 모른다. 단위 테스트는 fixture(`test/fixtures/registration/approval`)로 이 값을 만들어 고친다.
 * 앞 단계 산출물은 후보의 **현재 버전**(`candidate_step.current_step_run_id`)에서 읽는다(상태가 완료가 아니어도 산출물이 있으면 읽고,
 * 최신성은 `STEP_FRESHNESS`가 본다). 산출물이 없으면 그 칸은 null이다.
 */

export type RegistrationOptionType = 'COMBINATION' | 'STANDARD';
export type RegistrationDisplayStatusType = 'SUSPENSION' | 'ON';

export const REGISTRATION_OPTION_TYPES: readonly RegistrationOptionType[] = [
  'COMBINATION',
  'STANDARD',
];

export interface ApprovalCandidateInput {
  id: number;
  status: string;
  creationPath: string;
  itemCode: string | null;
  selectedColor: string | null;
  anchorModelCode: string | null;
  anchorItemCode: string | null;
  anchorColorCode: string | null;
  gender: 'MALE' | 'FEMALE' | null;
  leafCategoryId: string | null;
  wholeCategoryName: string | null;
  noComparisonConfirmedAt: string | null;
}

export interface ApprovalStepInput {
  status: StepStatus;
  currentStepRunId: number | null;
}

export interface ApprovalGateInput {
  /** 최신 통과 지문 = 지금 값으로 다시 계산한 지문(P1-06 GATE_VALIDITY) */
  valid: boolean;
  passedAt: string | null;
  changedBasisKeys: string[];
}

/** ② 현재 버전의 소싱 선택(비교 여부·상품 페이지)과 목표 사이즈 재고 칸(앵커 색상·기본 폭 — ② 재고 판정) */
export interface ApprovalSourcingInput {
  sourcingStepRunId: number;
  comparisonPerformed: boolean;
  itemCode: string;
  itemUrl: string;
  sizes: {
    sizeMm: number;
    status: 'IN_STOCK' | 'SOLD_OUT' | 'BACK_ORDER' | 'NONE';
    quantity: number | null;
  }[];
}

export interface ApprovalJudgementSizeInput {
  sizeMm: number;
  skuPriceYen: number;
  cGoodsKrw: number;
  vUsd: number;
  isDutyFree: boolean;
  isBoundary: boolean;
  cTaxKrw: number;
  pMinKrw: number | null;
  optionPriceKrw: number;
  sizeSalePriceKrw: number | null;
  cMktKrw: number | null;
  vatAKrw: number | null;
  vatBKrw: number | null;
  profitAKrw: number | null;
  profitBKrw: number | null;
  marginRateA: number | null;
  isSellable: boolean;
  unsellableReason: string | null;
}

/** ③ 현재 버전 판정 스냅샷 */
export interface ApprovalJudgementInput {
  priceJudgementId: number;
  pricingStepRunId: number;
  rakutenPageCollectedAt: string | null;
  judgedAt: string;
  isSaleCandidate: boolean;
  salePriceKrw: number | null;
  couponYen: number;
  shippingYen: number;
  shippingEstimated: boolean;
  cShipIntlKrw: number | null;
  cFwdKrw: number;
  fwdCouponKrw: number;
  fwdAssumed: boolean;
  vatMode: string;
  pricingRule: string;
  /** numeric(7,4) 원문(예 '0.1000') */
  targetMarginRate: string;
  minProfitKrw: number;
  sizes: ApprovalJudgementSizeInput[];
}

/** ④ 현재 버전 결정 */
export interface ApprovalCategoryInput {
  categoryStepRunId: number;
  leafCategoryId: string | null;
  wholeCategoryName: string | null;
  genderPathMatch: boolean | null;
  exceptionDecision: string | null;
  certificationExcludeContent: unknown;
  kcExemptAdultConfirmedAt: string | null;
}

/** ④ 리프가 메타 캐시(`commerce_category` — 리프만 받는다)에 있는가 */
export interface ApprovalCategoryLeafInput {
  exists: boolean;
  removed: boolean;
}

/** ⑤ 현재 버전 G3 기록 */
export interface ApprovalThumbnailInput {
  thumbnailStepRunId: number;
  uncheckedChecklistKeys: string[];
  sameProductColorConfirmedAt: string | null;
  references: {
    imageAssetId: number;
    sourceItemCode: string | null;
    sourceModelCodeNorm: string | null;
    sourceColorCode: string | null;
  }[];
}

export interface ApprovalRecheckInput {
  fieldKey: string;
  recheckReason: string;
}

/** ⑥-2 현재 버전 사실 */
export interface ApprovalFactsInput {
  noticeRawStepRunId: number;
  origin: {
    countries: string[];
    valueSource: 'GENERATED' | 'OWNER_INPUT';
    extractionMethod: string | null;
    evidenceUrl: string | null;
    basisItemCode: string | null;
  } | null;
  materials: { upper: string | null; lining: string | null; sole: string | null };
  rechecks: ApprovalRecheckInput[];
}

/** ⑥-3 현재 버전 조립 결과 */
export interface ApprovalAssemblyInput {
  noticeHtmlStepRunId: number;
  productName: string;
  noticeFields: Record<string, string>;
  noticeRequiredKeys: string[];
  noticeSizesMm: number[];
  specSizesMm: number[] | null;
  originAreaCode: string;
  originAreaPlural: boolean;
  originAreaContent: string | null;
  importer: string;
  specOriginLabel: string;
  disclosureBlocks: { blockId: string; sha256: string; conditional: boolean }[];
  rechecks: ApprovalRecheckInput[];
}

/** ⑦ 현재 버전 최종 태그 */
export interface ApprovalTagsInput {
  tagsStepRunId: number;
  tags: { text: string; code: string | null; finalOrder: number }[];
  sellerTags: ({ code: string; text: string } | { text: string })[];
}

export interface ApprovalUploadImageInput {
  role: 'REPRESENTATIVE' | 'ADDITIONAL';
  sortOrder: number;
  url: string;
  uploadedImageId: number;
  /** 업로드본(정규화본) image_asset id — 화면 미리보기는 이 로컬 파일을 쓴다 */
  imageAssetId: number;
  width: number;
  height: number;
  /** 업로드본과 그 원천 사슬(derived_from)에 REFERENCE_ONLY가 있는가 */
  referenceOnlyInChain: boolean;
}

/** ⑧ 현재 버전 산출물 */
export interface ApprovalUploadInput {
  uploadResultId: number;
  uploadStepRunId: number;
  detailContent: string;
  images: ApprovalUploadImageInput[];
}

export interface ApprovalProfileInput {
  /** ⑨ 요청의 배송·A/S 조각(P1-09 `registrationFragment`). 만들지 못했으면 null + 이유 */
  fragment: ProfileRegistrationFragment | null;
  fragmentError: string | null;
}

/** 검사·초안이 읽는 설정 값(현재 설정 스냅샷) */
export interface ApprovalSettingsInput {
  judgementValidityHours: number;
  minBlockWords: string[];
  originConfusionWords: string[];
  extraChargeWords: string[];
  notice: { blocks: NoticeBlock[]; leatherTerms: string[]; aiImageLabel: boolean };
  initialSuspensionCount: number;
  optionStockCap: number;
}

/** 이 상품·색상의 등록 기록(로컬 DB) */
export interface ApprovalRegistrationsInput {
  /** 처음 N건 셈: REGISTERING·RESULT_CHECK_REQUIRED·REGISTERED이고 failed_at 없음(드라이런·종결 제외 — P4-03 규칙 4) */
  liveCount: number;
  /** 이 후보의 진행 중 기록(등록요청중·결과확인필요, failed_at 없음) */
  inProgress: { registrationId: number; status: string } | null;
  /** 같은 item_code + selected_color의 진행 중·등록됨 기록(`uq_registration_live_key`와 같은 조건) */
  duplicate: {
    registrationId: number;
    status: string;
    originProductNo: string | null;
    channelProductNo: string | null;
    /** '등록됨'이 된 시각(F-AP-37 '기존 상품 보기' — P4-03). 진행 중이면 null */
    registeredAt?: string | null;
  } | null;
  /**
   * 같은 모델·색상(후보 앵커 型番 + `color_code`)인데 `item_code`가 다른 진행 중·등록됨 기록(F-AP-38·RG-12 — P4-03
   * `SAME_MODEL_REGISTERED` 경고, 막지 않음). 없으면 빈 배열
   */
  sameModel?: { registrationId: number; itemCode: string; originProductNo: string | null }[];
}

/**
 * ④ 리프 카테고리의 표준옵션(메타 동기화 `STANDARD_OPTIONS` 문서 — P4-03 F-AP-41). 문서가 없으면 null(조합형만)
 */
export interface ApprovalStandardOptionsInput {
  useStandardOption: boolean;
  /** 이름에 '사이즈'가 든 첫 표준옵션 그룹(없으면 null) */
  sizeGroup: {
    attributeId: number | string | null;
    attributeName: string;
    values: { attributeValueId: number | string | null; attributeValueName: string }[];
  } | null;
}

/** 처음 N건 셈의 기록 한 줄(P4-03 규칙 4) */
export interface LiveCountRow {
  status: string;
  failedAt: Date | string | null;
}

/** 처음 N건 셈에 드는 상태(진행 중·등록됨 — 드라이런 VALIDATED 제외) */
export const LIVE_COUNT_STATUSES: readonly string[] = [
  'REGISTERING',
  'RESULT_CHECK_REQUIRED',
  'REGISTERED',
];

/**
 * 처음 N건 셈(P4-03 규칙 4 — 순수 함수, DB 셈 `ApprovalInputsLoader`와 같은 조건): 진행 중·등록됨이고 `failed_at` 없음.
 * 드라이런(VALIDATED)·4xx 종결(REGISTERING + failed_at)·조회 결과 없음 종결은 빠진다.
 */
export function liveRegistrationCountOf(rows: readonly LiveCountRow[]): number {
  return rows.filter((row) => LIVE_COUNT_STATUSES.includes(row.status) && row.failedAt === null)
    .length;
}

export interface ApprovalInputs {
  candidate: ApprovalCandidateInput;
  steps: Partial<Record<StepCode, ApprovalStepInput>>;
  gates: { G2: ApprovalGateInput; G3: ApprovalGateInput };
  sourcing: ApprovalSourcingInput | null;
  judgement: ApprovalJudgementInput | null;
  category: ApprovalCategoryInput | null;
  categoryLeaf: ApprovalCategoryLeafInput;
  thumbnail: ApprovalThumbnailInput | null;
  copy: { copyStepRunId: number; texts: string[] } | null;
  facts: ApprovalFactsInput | null;
  assembly: ApprovalAssemblyInput | null;
  tags: ApprovalTagsInput | null;
  upload: ApprovalUploadInput | null;
  /** 요청 초안·최종 detailContent의 이미지 URL 가운데 `uploaded_image.url`에 있는 것(UNIQUE url 역조회) */
  knownUploadUrls: string[];
  profile: ApprovalProfileInput;
  settings: ApprovalSettingsInput;
  registrations: ApprovalRegistrationsInput;
  /** 등록 API 차단 스위치(행이 없으면 기본 켬) */
  apiBlocked: boolean;
  /** ④ 리프의 표준옵션(P4-03 — 표준형 옵션 전환). 문서가 없으면 null. 주지 않으면 null로 본다 */
  standardOptions?: ApprovalStandardOptionsInput | null;
}
