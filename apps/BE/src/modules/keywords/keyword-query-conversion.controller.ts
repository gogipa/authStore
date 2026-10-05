import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RakutenQueryConversionDto } from './dto/rakuten-query-conversion.dto.js';
import { KeywordQueryConversionService } from './keyword-query-conversion.service.js';
import { parsePathId } from './keywords.constants.js';

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const KEYWORD_ID_PARAM = { name: 'keywordId', type: 'integer', required: true } as const;

/**
 * 한글 키워드 → 일본어 라쿠텐 검색어(05-2 태그 keywords, F-BS-70). 경로 id가 1 이상 정수가 아니면 404 KEYWORD_NOT_FOUND.
 * 동기 AI 호출이라 응답까지 몇 초~2분 걸린다. 저장하지 않는다.
 */
@ApiTags('keywords')
@Controller('keywords/:keywordId/rakuten-query-conversions')
export class KeywordQueryConversionController {
  constructor(private readonly conversion: KeywordQueryConversionService) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    operationId: 'convertKeywordToRakutenQuery',
    summary: '한글 키워드를 일본어 라쿠텐 검색어로 바꾸기(AI)',
    description:
      '고른 한글 키워드 1개를 선택한 AI 엔진의 텍스트 모델에 보내 라쿠텐에서 찾을 수 있는 일본어(또는 영문 브랜드·모델) 검색어를 받는다. 저장하지 않는다. 네이버 데이터 AI 입력 제한(F-BS-14)의 예외 KEYWORD_QUERY_CONVERSION을 쓴다(키워드 1개·한 줄, 켠 사실을 기록). 화면이 [이 검색어로 소싱]을 누를 때 칸이 비었거나 한글이면 부른다.',
  })
  @ApiParam(KEYWORD_ID_PARAM)
  @ApiHeader(CLIENT_HEADER)
  @ApiOkResponse({ type: RakutenQueryConversionDto, description: '바꾼 검색어(저장 없음)' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'KEYWORD_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'KEYWORD_EXCLUDED · AI_ENGINE_UNAVAILABLE(details.engineCode·reason·settingsPath)',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  @ApiBadGatewayResponse({ description: 'AI_CALL_FAILED(details.errorCode)' })
  convert(@Param('keywordId') keywordId: string): Promise<RakutenQueryConversionDto> {
    return this.conversion.convert(parsePathId(keywordId));
  }
}
