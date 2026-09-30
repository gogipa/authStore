import { Controller, Get } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { KeywordCollectionStatusDto } from './dto/keyword-snapshot.dto.js';
import { KeywordSnapshotsService } from './keyword-snapshots.service.js';

/** 데이터랩 수집 상태(05-2 태그 keywords, P2-01 규칙 14). 설치본당 하나라 단수 리소스 */
@ApiTags('keywords')
@Controller('keyword-collection-status')
export class KeywordCollectionStatusController {
  constructor(private readonly snapshots: KeywordSnapshotsService) {}

  @Get()
  @ApiOperation({ operationId: 'getKeywordCollectionStatus', summary: '데이터랩 수집 상태' })
  @ApiOkResponse({ type: KeywordCollectionStatusDto, description: '수집 상태' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  status(): Promise<KeywordCollectionStatusDto> {
    return this.snapshots.collectionStatus();
  }
}
