import type { ProfileRegistrationFragment } from '../../settings/purchase-agency-profile/profile-registration-fragment.js';
import type {
  ApprovalInputs,
  RegistrationDisplayStatusType,
  RegistrationOptionType,
} from './approval-inputs.js';

/**
 * `POST /v2/products` 요청 초안(P4-02 §5 — 순수 함수). 기능 ID는 P4-03(F-AP-25 요청 골격·F-AP-27 전시 모드·F-AP-35 판매자관리코드·
 * F-AP-39 사이즈 옵션·F-AP-40 옵션 재고)이지만 승인 미리보기(`requestJsonDraft`·`sellerManagementCode`·`displayStatusType`·옵션)와
 * 사전 검증이 이 초안을 읽어 여기서 만든다. 값 규칙은 P4-03 §4 규칙 1~4 그대로, 모양은 R04 §2.11 신발 해외구매대행 최소 JSON 골격이다.
 * P4-03 등록은 이 빌더를 그대로 쓰고 표준형 변환(F-AP-41 — `standardOptionSupportOf`·`optionInfoOf`)을 더했다. 입력이 빠진 칸은 null로 두고(사전 검증 `REQUIRED_FIELDS`가
 * 막는다) 던지지 않는다. 토큰·시크릿은 넣지 않는다(헤더에만 있다).
 */

/** 옵션 그룹 이름(조합형 — F-AP-39 '옵션명 사이즈') */
export const SIZE_OPTION_GROUP_NAME = '사이즈';

/** 조합형 옵션 한 줄(사이즈) */
export interface RegistrationDraftOption {
  sizeMm: number;
  /** 옵션값(mm 숫자 글자 — '250', Proposed) */
  optionName: string;
  optionPriceKrw: number;
  stockQuantity: number;
}

/** 요청 본문 `originProduct.detailAttribute`(R04 §2.11 자리) */
export interface RegistrationDetailAttributeDraft {
  afterServiceInfo: ProfileRegistrationFragment['afterServiceInfo'] | null;
  originAreaInfo: {
    originAreaCode: string;
    importer: string;
    content?: string;
    plural: boolean;
  } | null;
  sellerCodeInfo: { sellerManagementCode: string } | null;
  /**
   * 조합형(기본): `optionCombination*`. 표준형(F-AP-41, P4-03 — 카테고리가 지원할 때만): `standardOptionGroups`·`optionStandards`
   * (필드 이름·모양은 M0 S3 전 추정). 둘 중 한쪽만 채운다
   */
  optionInfo: {
    optionCombinationSortType?: 'CREATE';
    optionCombinationGroupNames?: { optionGroupName1: string };
    optionCombinations?: {
      optionName1: string;
      stockQuantity: number;
      price: number;
      usable: true;
    }[];
    standardOptionGroups?: {
      groupName: string;
      standardOptionAttributes: {
        attributeId: number | string | null;
        attributeValueId: number | string | null;
        attributeValueName: string;
      }[];
    }[];
    optionStandards?: { optionName1: string; stockQuantity: number; usable: true }[];
    useStockManagement: true;
  };
  taxType: 'TAX';
  customsTaxType: ProfileRegistrationFragment['customsTaxType'] | null;
  minorPurchasable: boolean | null;
  certificationTargetExcludeContent?: unknown;
  productInfoProvidedNotice: {
    productInfoProvidedNoticeType: 'SHOES';
    shoes: Record<string, string>;
  } | null;
  seoInfo: { sellerTags: ({ code: string; text: string } | { text: string })[] };
  /** 주문당 구매수량 제한 — 필드 이름·자리는 M0 S3 전 추정(P1-09 unconfirmedFields) */
  purchaseQuantityInfo: { maxPurchaseQuantityPerOrder: number } | null;
}

/** `POST /v2/products` 본문 초안(R04 §2.11) */
export interface RegistrationRequestDraft {
  originProduct: {
    statusType: 'SALE';
    saleType: 'NEW';
    leafCategoryId: string | null;
    name: string | null;
    detailContent: string | null;
    images: {
      representativeImage: { url: string } | null;
      optionalImages: { url: string }[];
    };
    salePrice: number | null;
    stockQuantity: number;
    deliveryInfo: ProfileRegistrationFragment['deliveryInfo'] | null;
    detailAttribute: RegistrationDetailAttributeDraft;
  };
  smartstoreChannelProduct: {
    naverShoppingRegistration: boolean;
    channelProductDisplayStatusType: RegistrationDisplayStatusType;
  };
}

export interface RegistrationDraft {
  optionType: RegistrationOptionType;
  /** 표준형 옵션 지원 여부(F-AP-41 — 미리보기 '표준형으로 바꾸기'·STANDARD 승인 판단) */
  standardOption: StandardOptionSupport;
  displayStatusType: RegistrationDisplayStatusType;
  sellerManagementCode: string | null;
  salePriceKrw: number | null;
  options: RegistrationDraftOption[];
  stockQuantity: number;
  requestJson: RegistrationRequestDraft;
}

/**
 * 판매자관리코드 `RKT:{itemCode}:{colorCode}`(P4-03 규칙 2, F-AP-35, `ck_reg_seller_code`와 같은 식). itemCode는 `샵코드:상품ID`로
 * 정규화된 후보 값(승인 시점), colorCode는 `candidate.anchor_color_code`. 둘 중 하나라도 없으면 null.
 */
export function sellerManagementCodeOf(
  itemCode: string | null,
  colorCode: string | null,
): string | null {
  if (!itemCode || !colorCode) return null;
  return `RKT:${itemCode}:${colorCode}`;
}

/**
 * 전시 모드(P4-03 규칙 4, F-AP-27): 이 앱의 실제 등록 건수(REGISTERING·RESULT_CHECK_REQUIRED·REGISTERED이고 failed_at 없음 —
 * 드라이런·종결 제외)가 설정 N보다 작으면 전시중지(SUSPENSION), 아니면 즉시 전시(ON).
 */
export function displayStatusTypeOf(
  liveRegistrationCount: number,
  initialSuspensionCount: number,
): RegistrationDisplayStatusType {
  return liveRegistrationCount < initialSuspensionCount ? 'SUSPENSION' : 'ON';
}

/**
 * 사이즈 옵션(P4-03 규칙 3, F-AP-39·40, RG-06, D-11): 판정에서 판매 가능하고 면세인 사이즈(M1은 면세만) 가운데 ② 재고 판정(앵커
 * 색상·기본 폭)에서 재고 있음이고 수량이 0이 아닌 것만. 옵션가 = `price_judgement_size.option_price_krw`, 사이즈별 재고 =
 * min(라쿠텐 수량, 상한). 수량을 모르면(무제한 재고 등) 상한을 쓴다(Proposed). mm 오름차순.
 */
export function sizeOptionsOf(
  inputs: Pick<ApprovalInputs, 'judgement' | 'sourcing'>,
  stockCap: number,
): RegistrationDraftOption[] {
  if (!inputs.judgement || !inputs.sourcing) return [];
  const stock = new Map(inputs.sourcing.sizes.map((size) => [size.sizeMm, size]));
  const out: RegistrationDraftOption[] = [];
  for (const size of [...inputs.judgement.sizes].sort((a, b) => a.sizeMm - b.sizeMm)) {
    if (!size.isSellable || !size.isDutyFree) continue;
    const sku = stock.get(size.sizeMm);
    if (!sku || sku.status !== 'IN_STOCK') continue;
    const quantity = sku.quantity === null ? stockCap : Math.min(sku.quantity, stockCap);
    if (quantity <= 0) continue;
    out.push({
      sizeMm: size.sizeMm,
      optionName: String(size.sizeMm),
      optionPriceKrw: size.optionPriceKrw,
      stockQuantity: quantity,
    });
  }
  return out;
}

/** 표준형 옵션을 쓸 수 있는가(F-AP-41 — P4-03 Proposed 조건). 못 쓰면 이유 */
export interface StandardOptionSupport {
  supported: boolean;
  reason: string | null;
}

/**
 * 표준형 옵션 지원 판정(P4-03 Proposed — 05-1 §7.5): ④ 리프의 표준옵션 문서(메타 동기화 `STANDARD_OPTIONS`)가 있고
 * `useStandardOption=true`이고, 이름에 '사이즈'가 든 그룹에 옵션 사이즈(mm 글자 '250')가 모두 있고, 옵션가가 모두 0원이어야 한다
 * (표준형 옵션 줄에는 옵션가 칸이 없다고 본다 — M0 S3 전 추정). 옵션이 없으면 못 쓴다.
 */
export function standardOptionSupportOf(
  inputs: Pick<ApprovalInputs, 'standardOptions'>,
  options: readonly RegistrationDraftOption[],
): StandardOptionSupport {
  const doc = inputs.standardOptions ?? null;
  if (!doc || !doc.useStandardOption) {
    return {
      supported: false,
      reason: '이 카테고리는 표준형 옵션을 지원하지 않습니다(메타데이터 동기화의 표준옵션 기준).',
    };
  }
  if (!doc.sizeGroup) {
    return { supported: false, reason: '이 카테고리의 표준옵션에 사이즈 그룹이 없습니다.' };
  }
  if (options.length === 0) {
    return { supported: false, reason: '표준형으로 바꿀 사이즈 옵션이 없습니다.' };
  }
  const names = new Set(doc.sizeGroup.values.map((v) => v.attributeValueName.trim()));
  const missing = options.filter((o) => !names.has(o.optionName));
  if (missing.length > 0) {
    return {
      supported: false,
      reason: `표준옵션 사이즈 목록에 없는 사이즈가 있습니다(${missing.map((o) => o.sizeMm).join(', ')}mm).`,
    };
  }
  const priced = options.filter((o) => o.optionPriceKrw !== 0);
  if (priced.length > 0) {
    return {
      supported: false,
      reason: `표준형 옵션에는 사이즈별 옵션가를 넣을 수 없습니다(${priced.map((o) => o.sizeMm).join(', ')}mm).`,
    };
  }
  return { supported: true, reason: null };
}

/** 옵션 → 요청 본문 optionInfo(조합형 / 표준형) */
function optionInfoOf(
  inputs: Pick<ApprovalInputs, 'standardOptions'>,
  options: readonly RegistrationDraftOption[],
  standard: boolean,
): RegistrationDetailAttributeDraft['optionInfo'] {
  const group = inputs.standardOptions?.sizeGroup ?? null;
  if (standard && group) {
    const byName = new Map(group.values.map((v) => [v.attributeValueName.trim(), v]));
    return {
      standardOptionGroups: [
        {
          groupName: SIZE_OPTION_GROUP_NAME,
          standardOptionAttributes: options.map((option) => ({
            attributeId: group.attributeId,
            attributeValueId: byName.get(option.optionName)?.attributeValueId ?? null,
            attributeValueName: option.optionName,
          })),
        },
      ],
      optionStandards: options.map((option) => ({
        optionName1: option.optionName,
        stockQuantity: option.stockQuantity,
        usable: true,
      })),
      useStockManagement: true,
    };
  }
  return {
    optionCombinationSortType: 'CREATE',
    optionCombinationGroupNames: { optionGroupName1: SIZE_OPTION_GROUP_NAME },
    optionCombinations: options.map((option) => ({
      optionName1: option.optionName,
      stockQuantity: option.stockQuantity,
      price: option.optionPriceKrw,
      usable: true,
    })),
    useStockManagement: true,
  };
}

function originAreaInfoOf(
  inputs: ApprovalInputs,
): RegistrationDetailAttributeDraft['originAreaInfo'] {
  const assembly = inputs.assembly;
  if (!assembly) return null;
  return {
    originAreaCode: assembly.originAreaCode,
    importer: assembly.importer,
    ...(assembly.originAreaContent ? { content: assembly.originAreaContent } : {}),
    plural: assembly.originAreaPlural,
  };
}

/**
 * 입력 묶음 → 요청 초안(규칙 1~4). optionType STANDARD이고 카테고리가 표준형을 지원하면(`standardOptionSupportOf`) 표준형 옵션 모양
 * (F-AP-41, P4-03), 지원하지 않으면 조합형 모양 그대로다(미리보기 꺼짐·승인 422 — `standardOption.supported=false`)
 */
export function buildRegistrationDraft(
  inputs: ApprovalInputs,
  options: { optionType: RegistrationOptionType },
): RegistrationDraft {
  const { candidate, assembly, upload, judgement, category, tags, profile } = inputs;
  const sizeOptions = sizeOptionsOf(inputs, inputs.settings.optionStockCap);
  const standardOption = standardOptionSupportOf(inputs, sizeOptions);
  const stockQuantity = sizeOptions.reduce((sum, option) => sum + option.stockQuantity, 0);
  const sellerManagementCode = sellerManagementCodeOf(
    candidate.itemCode,
    candidate.anchorColorCode,
  );
  const displayStatusType = displayStatusTypeOf(
    inputs.registrations.liveCount,
    inputs.settings.initialSuspensionCount,
  );
  const images = [...(upload?.images ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const representative = images.find((image) => image.role === 'REPRESENTATIVE') ?? null;
  const fragment = profile.fragment;
  const kcExempt =
    category?.exceptionDecision === 'KC_EXEMPT' && category.certificationExcludeContent
      ? { certificationTargetExcludeContent: category.certificationExcludeContent }
      : {};
  const salePriceKrw = judgement?.salePriceKrw ?? null;
  const requestJson: RegistrationRequestDraft = {
    originProduct: {
      statusType: 'SALE',
      saleType: 'NEW',
      leafCategoryId: candidate.leafCategoryId ?? category?.leafCategoryId ?? null,
      name: assembly?.productName ?? null,
      detailContent: upload?.detailContent ?? null,
      images: {
        representativeImage: representative ? { url: representative.url } : null,
        optionalImages: images
          .filter((image) => image.role === 'ADDITIONAL')
          .map((image) => ({ url: image.url })),
      },
      salePrice: salePriceKrw,
      stockQuantity,
      deliveryInfo: fragment?.deliveryInfo ?? null,
      detailAttribute: {
        afterServiceInfo: fragment?.afterServiceInfo ?? null,
        originAreaInfo: originAreaInfoOf(inputs),
        sellerCodeInfo: sellerManagementCode ? { sellerManagementCode } : null,
        optionInfo: optionInfoOf(
          inputs,
          sizeOptions,
          options.optionType === 'STANDARD' && standardOption.supported,
        ),
        taxType: 'TAX',
        customsTaxType: fragment?.customsTaxType ?? null,
        minorPurchasable: fragment?.minorPurchasable ?? null,
        ...kcExempt,
        productInfoProvidedNotice: assembly
          ? { productInfoProvidedNoticeType: 'SHOES', shoes: { ...assembly.noticeFields } }
          : null,
        seoInfo: { sellerTags: tags?.sellerTags ?? [] },
        purchaseQuantityInfo: fragment
          ? {
              maxPurchaseQuantityPerOrder: fragment.unconfirmedFields.maxPurchaseQuantityPerOrder,
            }
          : null,
      },
    },
    smartstoreChannelProduct: {
      naverShoppingRegistration: true,
      channelProductDisplayStatusType: displayStatusType,
    },
  };
  return {
    optionType: options.optionType,
    standardOption,
    displayStatusType,
    sellerManagementCode,
    salePriceKrw,
    options: sizeOptions,
    stockQuantity,
    requestJson,
  };
}
