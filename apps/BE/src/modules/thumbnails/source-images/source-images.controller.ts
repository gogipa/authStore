import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { CandidateIdPipe } from '../../step-engine/candidates/candidates.controller.js';
import {
  THUMBNAIL_SOURCE_SECTIONS,
  ThumbnailSourceImageListDto,
} from '../dto/thumbnail-source-images.dto.js';
import { SourceImagesService } from './source-images.service.js';

/** 후보의 라쿠텐 원본 이미지 목록(05-2 listCandidateSourceImages, 태그 thumbnails, P3-01) */
@ApiTags('thumbnails')
@Controller()
export class SourceImagesController {
  constructor(private readonly sourceImages: SourceImagesService) {}

  @Get('candidates/:candidateId/source-images')
  @ApiOperation({
    operationId: 'listCandidateSourceImages',
    summary: '후보의 라쿠텐 원본 이미지 목록',
  })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiQuery({
    name: 'sourceSection',
    enum: THUMBNAIL_SOURCE_SECTIONS,
    required: false,
    description: '용도로 거르기. 없으면 둘 다 준다',
  })
  @ApiOkResponse({ type: ThumbnailSourceImageListDto, description: '원본 이미지 목록' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({ description: 'SOURCING_SELECTION_REQUIRED(② 소싱 선택 전)' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER(sourceSection 값)' })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  list(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Query() query: Record<string, unknown>,
  ): Promise<ThumbnailSourceImageListDto> {
    return this.sourceImages.list(candidateId, query);
  }
}
