import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { StorageUsageDto, StorageUsageQueryDto } from './storage-usage.dto.js';
import { StorageUsageService } from './storage-usage.service.js';

/** 저장 공간(05-2 getStorageUsage, SCR-13 '저장 공간' 패널, D-25). 읽기 전용 GET 하나 */
@ApiTags('system')
@Controller('storage-usage')
export class StorageUsageController {
  constructor(private readonly service: StorageUsageService) {}

  @Get()
  @ApiOperation({
    operationId: 'getStorageUsage',
    summary: '저장 공간 조회(agy 기록·앱 이미지 폴더 크기, 디스크 남은 공간)',
  })
  @ApiOkResponse({ type: StorageUsageDto, description: '저장 공간' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiUnprocessableEntityResponse({
    description: 'INVALID_QUERY_PARAMETER(refresh가 true·false가 아님)',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  get(@Query() query: StorageUsageQueryDto): Promise<StorageUsageDto> {
    return this.service.get(query.refresh === true);
  }
}
