import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { ChildKeywordTermsService } from './child-keyword-terms.service.js';
import {
  ChildKeywordTermCreateDto,
  ChildKeywordTermCreatedDto,
  ChildKeywordTermListDto,
} from './dto/child-keyword-term.dto.js';

/**
 * 아동 단어(05-2 태그 keywords, P2-01 규칙 11). 더할 수만 있어 DELETE 라우트를 만들지 않는다(F-KW-07) —
 * `DELETE /child-keyword-terms/…`는 404 ROUTE_NOT_FOUND다.
 */
@ApiTags('keywords')
@Controller('child-keyword-terms')
export class ChildKeywordTermsController {
  constructor(private readonly terms: ChildKeywordTermsService) {}

  @Get()
  @ApiOperation({ operationId: 'listChildKeywordTerms', summary: '아동 단어 목록' })
  @ApiOkResponse({ type: ChildKeywordTermListDto, description: '아동 단어 목록' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID — 읽을 설정이 없음' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(): ChildKeywordTermListDto {
    return this.terms.list();
  }

  @Post()
  @ApiOperation({ operationId: 'addChildKeywordTerm', summary: '아동 단어 더하기' })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiCreatedResponse({
    type: ChildKeywordTermCreatedDto,
    description: '더한 단어와 새 설정 스냅샷 id',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiConflictResponse({ description: 'CHILD_TERM_ALREADY_EXISTS — 같은 단어' })
  @ApiUnprocessableEntityResponse({ description: 'VALIDATION_FAILED — 빈 값·길이 초과' })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  add(@Body() body: ChildKeywordTermCreateDto): Promise<ChildKeywordTermCreatedDto> {
    return this.terms.add(body.term);
  }
}
