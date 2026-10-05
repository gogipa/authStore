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

/**
 * G1 키워드 고르기(05-2 태그 keywords, P2-01 규칙 13, D-33). 경로 id가 1 이상 정수가 아니면 404 KEYWORD_NOT_FOUND.
 * PUT = '이 키워드를 지금 고른 키워드로 한다'(한 묶음에 하나, selected_at이 가장 늦은 것). DELETE는 M1 화면이 부르지 않는다(남겨 둔 API).
 */
@ApiTags('keywords')
@Controller('keywords/:keywordId/selection')
export class KeywordSelectionController {
  constructor(private readonly selection: KeywordSelectionService) {}

  @Put()
  @ApiOperation({
    operationId: 'selectKeyword',
    summary: 'G1 키워드 고르기',
    description:
      "G1 기록 = keyword.selected_at. 화면은 한 묶음에서 키워드를 하나만 고르며(D-33), 고르는 일이 곧 G1 통과다. 한 묶음에서 selected_at이 가장 늦은 키워드가 '지금 고른 키워드'다(KeywordSnapshotDetail.selectedKeyword). 이미 지금 고른 키워드면 그대로 둔다(멱등, 기록 없음). 앞서 골랐지만 지금 고른 것이 아닌 키워드를 다시 고르거나 아직 안 고른 키워드를 고르면 selected_at을 이 묶음의 가장 늦은 값보다 늦게(지금 시각, 같거나 앞서면 1ms 뒤) 정하고 감사 기록을 남긴다. 다른 키워드의 selected_at은 지우지 않는다(후보의 G1 통과 시각과 승인 이력이 남는다).",
  })
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
  @ApiOperation({
    operationId: 'unselectKeyword',
    summary: 'G1 키워드 고르기 취소',
    description:
      'selected_at을 비운다. 이미 비어 있으면 그대로 204. 화면은 하나만 고르는 방식(D-33)이라 M1 화면이 부르지 않는다(남겨 둔 API). 지금 고른 키워드를 비우면 그 묶음에서 그다음으로 늦게 고른 키워드가 지금 고른 키워드가 된다.',
  })
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
