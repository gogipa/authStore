import { Controller, Get } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DispatchDeliveryCompaniesService } from './dispatch-delivery-companies.service.js';
import { DispatchDeliveryCompanyListDto } from './dto/dispatch-delivery-company.dto.js';

/** 05-2 listDispatchDeliveryCompanies */
@ApiTags('settings')
@Controller('dispatch-delivery-companies')
export class DispatchDeliveryCompaniesController {
  constructor(private readonly companies: DispatchDeliveryCompaniesService) {}

  @Get()
  @ApiOperation({
    operationId: 'listDispatchDeliveryCompanies',
    summary: '발송 택배사 코드 목록 조회',
  })
  @ApiOkResponse({ type: DispatchDeliveryCompanyListDto, description: '발송 택배사 코드 목록' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID — 로드된 설정 스냅샷이 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(): DispatchDeliveryCompanyListDto {
    return this.companies.list();
  }
}
