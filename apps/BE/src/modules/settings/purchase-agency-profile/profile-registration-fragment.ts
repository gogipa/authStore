import { PROFILE_FIXED_VALUES } from './profile-fixed-values.js';
import type { PurchaseAgencyProfileValues } from './profile-values.js';

/** 조각 함수가 읽는 주소록 캐시 한 행(commerce_addressbook). 로컬 `id`와 네이버 주소록 번호(`addressBookNo`)가 다르다 */
export interface FragmentAddressbook {
  id: number;
  addressBookNo: string;
}

/** 조각 함수가 읽는 반품 택배사 캐시 한 행(commerce_return_delivery_company) */
export interface FragmentReturnDeliveryCompany {
  id: number;
  code: string;
}

export interface ProfileFragmentAddressbooks {
  /** 프로필 `overseasShippingCommerceAddressbookId`가 가리키는 행(없으면 null) */
  shipping: FragmentAddressbook | null;
  /** 프로필 `returnCommerceAddressbookId`가 가리키는 행(없으면 null) */
  return: FragmentAddressbook | null;
}

/**
 * ⑨ 등록 요청 본문의 배송·A/S 조각(R04 §2.11 골격의 필드 이름). P4-03이 자리에 넣는다:
 * `deliveryInfo`는 `originProduct.deliveryInfo`, 나머지 셋은 `originProduct.detailAttribute` 아래다.
 * 빈칸(null)은 그대로 null로 둔다 — 빈칸 검사는 G4 사전 검증(P4-02)이 `missingFields`로 먼저 한다.
 */
export interface ProfileRegistrationFragment {
  deliveryInfo: {
    deliveryType: 'DELIVERY';
    /** R04 §2.11 골격 그대로(일반 배송) */
    deliveryAttributeType: 'NORMAL';
    /** 발송 택배사 코드(설정 목록). 해외 출고용 코드는 M0 S3 */
    deliveryCompany: string | null;
    deliveryFee: {
      deliveryFeeType: typeof PROFILE_FIXED_VALUES.deliveryFeeType;
      /** R04 §2.11 [추정] 오너 정책 — M0 S3에서 확인 */
      deliveryFeePayType: 'PREPAID';
    };
    claimDeliveryInfo: {
      returnDeliveryFee: number | null;
      exchangeDeliveryFee: number | null;
      /** 해외 출고지의 **네이버 주소록 번호**(int64). 로컬 commerce_addressbook.id가 아니다 */
      shippingAddressId: number | null;
      /** 반품·교환지의 네이버 주소록 번호 */
      returnAddressId: number | null;
    };
    businessCustomsClearanceSaleYn: typeof PROFILE_FIXED_VALUES.businessCustomsClearanceSaleYn;
  };
  customsTaxType: typeof PROFILE_FIXED_VALUES.customsTaxType;
  minorPurchasable: typeof PROFILE_FIXED_VALUES.minorPurchasable;
  afterServiceInfo: {
    afterServiceTelephoneNumber: string | null;
    afterServiceGuideContent: string | null;
  };
  /**
   * M0 S3 전이라 필드 이름·자리가 확인되지 않은 값. 요청 본문에 바로 넣지 않고 P4-03이 S3 결과로 자리를 정한다.
   * - `maxPurchaseQuantityPerOrder`: 주문당 구매수량 제한(기본 1, F-ST-10). 추정 자리 `detailAttribute.purchaseQuantityInfo`
   * - `returnDeliveryCompanyCode`: 반품 택배사(동기화 목록의 코드). 추정 자리 `claimDeliveryInfo` 안
   */
  unconfirmedFields: {
    maxPurchaseQuantityPerOrder: number;
    returnDeliveryCompanyCode: string | null;
  };
}

/** 조각 함수 입력이 잘못됐다(주소록 번호가 숫자가 아니거나 안전한 정수 범위 밖, 가리킨 행이 아님) */
export class ProfileFragmentError extends Error {}

/**
 * 네이버 주소록 번호(varchar, ck_addressbook_no `^[0-9]+$`) → 요청 본문의 숫자(int64).
 * JS number로 정확히 담을 수 없는 번호(2^53 이상)는 던진다 — 반올림된 번호로 엉뚱한 출고지에 등록되지 않게.
 */
export function addressBookNoToNumber(addressBookNo: string): number {
  if (!/^[0-9]+$/.test(addressBookNo)) {
    throw new ProfileFragmentError('주소록 번호가 숫자가 아닙니다.');
  }
  const value = Number(addressBookNo);
  if (!Number.isSafeInteger(value)) {
    throw new ProfileFragmentError('주소록 번호가 너무 커서 정확히 보낼 수 없습니다.');
  }
  return value;
}

function addressNo(
  row: FragmentAddressbook | null,
  expectedId: number | null,
  field: string,
): number | null {
  if (expectedId === null) return null;
  if (!row) return null;
  if (row.id !== expectedId) {
    throw new ProfileFragmentError(`${field}가 가리키는 주소록 행이 아닙니다.`);
  }
  return addressBookNoToNumber(row.addressBookNo);
}

/**
 * 프로필 + 고정값 → ⑨ 요청 본문의 배송·A/S 조각(P4-03이 쓴다). 순수 함수.
 * 주소는 로컬 `id`가 아니라 네이버 주소록 번호(`address_book_no`, 숫자)로 바꾼다. 잘못 넣으면 실제 스토어에 엉뚱한
 * 출고지로 등록된다(P1-09 §8). 주소록·반품 택배사 행은 부르는 쪽이 `CommerceMetaCacheService`로 읽어 넘긴다
 * (`PurchaseAgencyProfileService.registrationFragment()`가 그렇게 한다).
 */
export function buildProfileFragment(
  profile: PurchaseAgencyProfileValues,
  addressbooks: ProfileFragmentAddressbooks,
  returnCompany: FragmentReturnDeliveryCompany | null,
): ProfileRegistrationFragment {
  if (
    returnCompany &&
    profile.commerceReturnDeliveryCompanyId !== null &&
    returnCompany.id !== profile.commerceReturnDeliveryCompanyId
  ) {
    throw new ProfileFragmentError(
      'commerceReturnDeliveryCompanyId가 가리키는 반품 택배사가 아닙니다.',
    );
  }
  return {
    deliveryInfo: {
      deliveryType: 'DELIVERY',
      deliveryAttributeType: 'NORMAL',
      deliveryCompany: profile.dispatchDeliveryCompanyCode,
      deliveryFee: {
        deliveryFeeType: PROFILE_FIXED_VALUES.deliveryFeeType,
        deliveryFeePayType: 'PREPAID',
      },
      claimDeliveryInfo: {
        returnDeliveryFee: profile.returnFeeKrw,
        exchangeDeliveryFee: profile.exchangeFeeKrw,
        shippingAddressId: addressNo(
          addressbooks.shipping,
          profile.overseasShippingCommerceAddressbookId,
          'overseasShippingCommerceAddressbookId',
        ),
        returnAddressId: addressNo(
          addressbooks.return,
          profile.returnCommerceAddressbookId,
          'returnCommerceAddressbookId',
        ),
      },
      businessCustomsClearanceSaleYn: PROFILE_FIXED_VALUES.businessCustomsClearanceSaleYn,
    },
    customsTaxType: PROFILE_FIXED_VALUES.customsTaxType,
    minorPurchasable: PROFILE_FIXED_VALUES.minorPurchasable,
    afterServiceInfo: {
      afterServiceTelephoneNumber: profile.afterServicePhone,
      afterServiceGuideContent: profile.afterServiceGuide,
    },
    unconfirmedFields: {
      maxPurchaseQuantityPerOrder: profile.maxPurchaseQuantityPerOrder,
      returnDeliveryCompanyCode:
        profile.commerceReturnDeliveryCompanyId !== null && returnCompany
          ? returnCompany.code
          : null,
    },
  };
}
