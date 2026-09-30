import { ApiProperty } from '@nestjs/swagger';

/**
 * 구매대행 프로필 응답(05-2 PurchaseAgencyProfile·PurchaseAgencyProfileAddressWarning·PurchaseAgencyProfileSaveResult).
 * 구현 명세(@nestjs/swagger)는 OpenAPI 3.0이라 null 허용은 nullable로 적었다(06-2 §9-5).
 */

export const ADDRESS_WARNING_FIELDS = [
  'overseasShippingCommerceAddressbookId',
  'returnCommerceAddressbookId',
] as const;
export type AddressWarningField = (typeof ADDRESS_WARNING_FIELDS)[number];

export const ADDRESS_WARNING_CODES = ['ADDRESSBOOK_NOT_FOUND', 'ADDRESS_NOT_OVERSEAS'] as const;
export type AddressWarningCode = (typeof ADDRESS_WARNING_CODES)[number];

/** 05-2 PurchaseAgencyProfileAddressWarning(막지 않음) */
export class PurchaseAgencyProfileAddressWarningDto {
  @ApiProperty({ enum: ADDRESS_WARNING_FIELDS })
  field!: AddressWarningField;

  @ApiProperty({
    enum: ADDRESS_WARNING_CODES,
    description:
      'ADDRESSBOOK_NOT_FOUND=최신 동기화에서 사라짐, ADDRESS_NOT_OVERSEAS=해외 출고지가 아님',
  })
  code!: AddressWarningCode;

  @ApiProperty()
  message!: string;
}

/** 05-2 PurchaseAgencyProfile. 행이 없으면 id·createdAt·updatedAt이 null인 빈 기본값 */
export class PurchaseAgencyProfileDto {
  @ApiProperty({ type: 'integer', nullable: true, minimum: 1 })
  id!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 1 })
  overseasShippingCommerceAddressbookId!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 1 })
  returnCommerceAddressbookId!: number | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 40 })
  dispatchDeliveryCompanyCode!: string | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 1 })
  commerceReturnDeliveryCompanyId!: number | null;

  @ApiProperty({ type: 'integer', enum: [0], description: 'M1은 무료배송만(F-ST-10)' })
  deliveryFeeKrw!: 0;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0 })
  returnFeeKrw!: number | null;

  @ApiProperty({ type: 'integer', nullable: true, minimum: 0 })
  exchangeFeeKrw!: number | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  businessName!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 40 })
  afterServicePhone!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 1000 })
  afterServiceGuide!: string | null;

  @ApiProperty({ type: 'string', nullable: true, maxLength: 100 })
  importer!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' } })
  noticeFixedTexts!: Record<string, string>;

  @ApiProperty({ type: 'integer', minimum: 1 })
  maxPurchaseQuantityPerOrder!: number;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  createdAt!: string | null;

  @ApiProperty({ type: 'string', format: 'date-time', nullable: true })
  updatedAt!: string | null;

  @ApiProperty({ type: [String], description: '비어 있는 필수값의 필드 이름' })
  missingFields!: string[];

  @ApiProperty({ type: [PurchaseAgencyProfileAddressWarningDto] })
  addressWarnings!: PurchaseAgencyProfileAddressWarningDto[];
}

/** 05-2 PurchaseAgencyProfileSaveResult */
export class PurchaseAgencyProfileSaveResultDto {
  @ApiProperty({ type: PurchaseAgencyProfileDto })
  profile!: PurchaseAgencyProfileDto;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '⑥-3·⑧·⑨ 중 재실행 필요가 된 후보 단계 수',
  })
  rerunRequiredStepCount!: number;
}
