/**
 * 구매대행 등록 요청의 고정값(F-ST-10, F-AP-25, US-21 AC2, PRD §8.7 요청 골격). 열·설정이 아니라 코드 상수다.
 * - 관부가세 포함(`customsTaxType=INCLUDED`): 해외 출고지면 필수(R04 §2.3)
 * - 개인통관(`businessCustomsClearanceSaleYn=false`): 주문서에 개인통관고유부호 칸이 붙는다
 * - 미성년자 구매 가능(`minorPurchasable=true`)
 * - 무료배송(`deliveryFeeType=FREE`): M1은 무료배송만 지원한다(프로필 delivery_fee_krw=0 고정, ck_pap_free_delivery)
 */
export const PROFILE_FIXED_VALUES = {
  customsTaxType: 'INCLUDED',
  businessCustomsClearanceSaleYn: false,
  minorPurchasable: true,
  deliveryFeeType: 'FREE',
} as const;

/** 배송비(원). 무료배송이라 0 고정(F-ST-10) */
export const FIXED_DELIVERY_FEE_KRW = 0;
