import { Controller, Delete, HttpCode, Param, Put } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RankedKeywordDto } from './dto/keyword-snapshot.dto.js';
import { KeywordSelectionService } from './keyword-selection.service.js';
import { parsePathId } from './keywords.constants.js';

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const KEYWORD_ID_PARAM = { name: 'keywordId', type: 'integer', required: true } as const;

/** G1 키워드 고르기(05-2 태그 keywords, P2-01 규칙 13). 경로 id가 1 이상 정수가 아니면 404 KEYWORD_NOT_FOUND */
@ApiTags('keywords')
@Controller('keywords/:keywordId/selection')
export class KeywordSelectionController {
  constructor(private readonly selection: KeywordSelectionService) {}

  @Put()
  @ApiOperation({ operationId: 'selectKeyword', summary: 'G1 키워드 고르기' })
  @ApiParam(KEYWORD_ID_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiOkResponse({ type: RankedKeywordDto, description: '고른 뒤의 키워드' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'KEYWORD_NOT_FOUND' })
  @ApiConflictResponse({ description: 'KEYWORD_EXCLUDED — 아동화로 빠진 키워드' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  select(@Param('keywordId') keywordId: string): Promise<RankedKeywordDto> {
    return this.selection.select(parsePathId(keywordId));
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ operationId: 'unselectKeyword', summary: 'G1 키워드 고르기 취소' })
  @ApiParam(KEYWORD_ID_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiNoContentResponse({ description: '취소했다' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'KEYWORD_NOT_FOUND' })
  @ApiConflictResponse({ description: 'KEYWORD_IN_USE — 이 키워드를 출처로 만든 후보가 있음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  async unselect(@Param('keywordId') keywordId: string): Promise<void> {
    await this.selection.unselect(parsePathId(keywordId));
  }
}
