import { Controller, Get, Param } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CandidateIdPipe } from '../step-engine/candidates/candidates.controller.js';
import { NaverShoppingLinkListDto } from './dto/domestic-price.dto.js';
import { NaverShoppingLinksService } from './naver-shopping-links.service.js';

/** 네이버쇼핑 검색 링크(05-2 listNaverShoppingLinks, 태그 pricing, P2-05) — URL만 만든다 */
@ApiTags('pricing')
@Controller('candidates/:candidateId/naver-shopping-links')
export class NaverShoppingLinksController {
  constructor(private readonly links: NaverShoppingLinksService) {}

  @Get()
  @ApiOperation({ operationId: 'listNaverShoppingLinks', summary: '네이버쇼핑 검색 링크' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiOkResponse({ type: NaverShoppingLinkListDto, description: '검색 링크 목록(0~2개)' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
  ): Promise<NaverShoppingLinkListDto> {
    return this.links.list(candidateId);
  }
}
