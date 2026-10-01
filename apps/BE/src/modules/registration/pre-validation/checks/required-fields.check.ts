import type { PreValidationCheck, PreValidationContext } from '../pre-validation.types.js';
import {
  PRODUCT_NAME_MAX,
  productNameLength,
  resultOf,
  type CheckProblem,
} from './check-helpers.js';

function blank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * `REQUIRED_FIELDS`(F-AP-11, US-17 AC1·US-21 AC3, PRD §8.7 RG-08 '필수 필드', P4-02 규칙 3): 요청 초안에 name(100자 이내 — 코드
 * 포인트), detailContent, 대표이미지 URL, salePrice, leafCategoryId, stockQuantity, `SHOES` 필수 항목, originAreaInfo(`importer`
 * 포함), afterServiceInfo, deliveryInfo(`deliveryCompany`·출고지·반품지 포함), customsTaxType, `minorPurchasable`,
 * `naverShoppingRegistration`, `channelProductDisplayStatusType`이 모두 있다.
 */
export function requiredFieldsCheck(ctx: PreValidationContext): PreValidationCheck {
  const problems: CheckProblem[] = [];
  const request = ctx.draft.requestJson;
  const product = request.originProduct;
  const attr = product.detailAttribute;
  const channel = request.smartstoreChannelProduct;
  if (blank(product.name)) {
    problems.push({ message: '상품명이 없습니다', stepCode: 'NOTICE_HTML' });
  } else {
    const length = productNameLength(product.name!);
    if (length > PRODUCT_NAME_MAX) {
      problems.push({
        message: `상품명이 ${length}자로 ${PRODUCT_NAME_MAX}자를 넘습니다`,
        stepCode: 'NOTICE_HTML',
      });
    }
  }
  if (blank(product.detailContent)) {
    problems.push({ message: '상세 본문(detailContent)이 없습니다', stepCode: 'UPLOAD' });
  }
  if (blank(product.images.representativeImage?.url)) {
    problems.push({ message: '대표이미지 주소가 없습니다', stepCode: 'UPLOAD' });
  }
  if (typeof product.salePrice !== 'number') {
    problems.push({ message: '판매가가 없습니다', stepCode: 'PRICING' });
  }
  if (blank(product.leafCategoryId)) {
    problems.push({ message: '리프 카테고리가 없습니다', stepCode: 'CATEGORY' });
  }
  if (typeof product.stockQuantity !== 'number' || product.stockQuantity <= 0) {
    problems.push({ message: '재고 수량이 없습니다', stepCode: 'SOURCING' });
  }
  const notice = attr.productInfoProvidedNotice;
  if (!notice || notice.productInfoProvidedNoticeType !== 'SHOES') {
    problems.push({ message: 'SHOES 상품정보제공고시가 없습니다', stepCode: 'NOTICE_HTML' });
  } else {
    const required = ctx.inputs.assembly?.noticeRequiredKeys ?? [];
    const missing = required.filter((key) => blank(notice.shoes?.[key]));
    if (missing.length > 0) {
      problems.push({
        message: `SHOES 고시 필수 항목이 비었습니다(${missing.join(', ')})`,
        stepCode: 'NOTICE_HTML',
      });
    }
  }
  const origin = attr.originAreaInfo;
  if (!origin || blank(origin.originAreaCode)) {
    problems.push({ message: '원산지 정보(originAreaInfo)가 없습니다', stepCode: 'NOTICE_HTML' });
  } else if (blank(origin.importer)) {
    problems.push({ message: '수입자(importer)가 비었습니다', stepCode: 'NOTICE_HTML' });
  }
  if (ctx.inputs.profile.fragmentError) {
    problems.push({
      message: `구매대행 프로필 값을 요청에 넣지 못했습니다(${ctx.inputs.profile.fragmentError})`,
      stepCode: null,
    });
  }
  const after = attr.afterServiceInfo;
  if (!after || blank(after.afterServiceTelephoneNumber) || blank(after.afterServiceGuideContent)) {
    problems.push({ message: 'A/S 정보(연락처·안내)가 비었습니다', stepCode: null });
  }
  const delivery = product.deliveryInfo;
  if (!delivery) {
    problems.push({ message: '배송 정보(deliveryInfo)가 없습니다', stepCode: null });
  } else {
    if (blank(delivery.deliveryCompany)) {
      problems.push({ message: '배송 정보에 택배사(deliveryCompany)가 없습니다', stepCode: null });
    }
    const claim = delivery.claimDeliveryInfo;
    if (claim?.shippingAddressId == null || claim?.returnAddressId == null) {
      problems.push({
        message: '배송 정보에 해외 출고지·반품지 주소록이 없습니다',
        stepCode: null,
      });
    }
  }
  if (blank(attr.customsTaxType)) {
    problems.push({ message: '관부가세 포함 여부(customsTaxType)가 없습니다', stepCode: null });
  }
  if (typeof attr.minorPurchasable !== 'boolean') {
    problems.push({ message: '미성년자 구매(minorPurchasable)가 없습니다', stepCode: null });
  }
  if (typeof channel?.naverShoppingRegistration !== 'boolean') {
    problems.push({
      message: '네이버쇼핑 노출(naverShoppingRegistration)이 없습니다',
      stepCode: null,
    });
  }
  if (blank(channel?.channelProductDisplayStatusType)) {
    problems.push({
      message: '전시 상태(channelProductDisplayStatusType)가 없습니다',
      stepCode: null,
    });
  }
  return resultOf('REQUIRED_FIELDS', problems);
}
