import { Controller, Get } from '@nestjs/common';
import { ApiForbiddenResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AiCliCheckLatestListDto } from './ai-cli-check.dto.js';
import { AiCliChecksService } from './ai-cli-checks.service.js';

@ApiTags('system')
@Controller('ai-cli-checks')
export class AiCliChecksController {
  constructor(private readonly service: AiCliChecksService) {}

  @Get('latest')
  @ApiOperation({
    operationId: 'getLatestAiCliChecks',
    summary: 'AI 엔진별 최신 점검 결과 조회',
  })
  @ApiOkResponse({
    type: AiCliCheckLatestListDto,
    description: '엔진별 최신 점검 결과와 선택 엔진',
  })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  getLatest(): Promise<AiCliCheckLatestListDto> {
    return this.service.getLatest();
  }
}
