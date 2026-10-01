import { Controller, Get } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CallUsageListDto } from './call-usage.dto.js';
import { CallUsageService } from './call-usage.service.js';

@ApiTags('integrations')
@Controller('call-usage')
export class CallUsageController {
  constructor(private readonly usage: CallUsageService) {}

  @Get()
  @ApiOperation({
    operationId: 'getCallUsage',
    summary: '오늘 외부 조회 수·상한·24시간 쉼 상태 조회',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiOkResponse({ type: CallUsageListDto, description: '대상별 오늘 조회 현황' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  getCallUsage(): Promise<CallUsageListDto> {
    return this.usage.getCallUsage();
  }
}
