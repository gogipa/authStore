import { Body, Controller, Get, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { PurchaseAgencyProfileInputDto } from './dto/purchase-agency-profile-input.dto.js';
import {
  PurchaseAgencyProfileDto,
  PurchaseAgencyProfileSaveResultDto,
} from './dto/purchase-agency-profile.dto.js';
import { PurchaseAgencyProfileService } from './purchase-agency-profile.service.js';

/** 구매대행 프로필(05-2 getPurchaseAgencyProfile·replacePurchaseAgencyProfile). 설치본당 1행이라 단수 리소스다 */
@ApiTags('settings')
@Controller('purchase-agency-profile')
export class PurchaseAgencyProfileController {
  constructor(private readonly profile: PurchaseAgencyProfileService) {}

  @Get()
  @ApiOperation({ operationId: 'getPurchaseAgencyProfile', summary: '구매대행 프로필 조회' })
  @ApiOkResponse({
    type: PurchaseAgencyProfileDto,
    description: '구매대행 프로필(행이 없으면 빈 기본값)',
  })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(): Promise<PurchaseAgencyProfileDto> {
    return this.profile.getCurrent();
  }

  @Put()
  @ApiOperation({ operationId: 'replacePurchaseAgencyProfile', summary: '구매대행 프로필 저장' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({
    type: PurchaseAgencyProfileSaveResultDto,
    description: '저장한 프로필과 재실행 필요 전파 수',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({
    description:
      'ADDRESSBOOK_NOT_FOUND — 주소록 id가 없거나 지워짐 · RETURN_DELIVERY_COMPANY_NOT_FOUND(Proposed)',
  })
  @ApiUnprocessableEntityResponse({
    description: 'ADDRESS_NOT_OVERSEAS · DELIVERY_COMPANY_NOT_ALLOWED · VALIDATION_FAILED',
  })
  @ApiServiceUnavailableResponse({
    description: 'SETTINGS_INVALID — 발송 택배사 코드를 볼 설정 스냅샷이 없음(Proposed)',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  replace(
    @Body() body: PurchaseAgencyProfileInputDto,
  ): Promise<PurchaseAgencyProfileSaveResultDto> {
    return this.profile.replace({
      overseasShippingCommerceAddressbookId: body.overseasShippingCommerceAddressbookId,
      returnCommerceAddressbookId: body.returnCommerceAddressbookId,
      dispatchDeliveryCompanyCode: body.dispatchDeliveryCompanyCode,
      commerceReturnDeliveryCompanyId: body.commerceReturnDeliveryCompanyId,
      returnFeeKrw: body.returnFeeKrw,
      exchangeFeeKrw: body.exchangeFeeKrw,
      businessName: body.businessName,
      afterServicePhone: body.afterServicePhone,
      afterServiceGuide: body.afterServiceGuide,
      importer: body.importer,
      noticeFixedTexts: { ...body.noticeFixedTexts },
      maxPurchaseQuantityPerOrder: body.maxPurchaseQuantityPerOrder,
    });
  }
}
