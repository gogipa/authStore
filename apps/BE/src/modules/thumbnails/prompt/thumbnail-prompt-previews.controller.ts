import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  ThumbnailPromptPreviewDto,
  ThumbnailPromptPreviewRequestDto,
} from '../dto/thumbnail-prompt-preview.dto.js';
import { ThumbnailPromptPreviewsService } from './thumbnail-prompt-previews.service.js';

/** 썸네일 프롬프트 미리보기와 실존 인물 차단어 검사(05-2 createThumbnailPromptPreview, 태그 thumbnails, P3-01) */
@ApiTags('thumbnails')
@Controller()
export class ThumbnailPromptPreviewsController {
  constructor(private readonly previews: ThumbnailPromptPreviewsService) {}

  @Post('thumbnail-prompt-previews')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'createThumbnailPromptPreview',
    summary: '썸네일 프롬프트 미리보기와 실존 인물 차단어 검사',
  })
  @ApiHeader({ name: 'X-AutoStore-Client', required: true, description: '앱 화면 요청 표시(값 1)' })
  @ApiOkResponse({ type: ThumbnailPromptPreviewDto, description: '채운 프롬프트와 검사 결과' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' })
  @ApiNotFoundResponse({ description: 'STEP_RUN_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED, INVALID_STEP_CODE(⑤ 실행이 아님)',
  })
  @ApiResponse({ status: 500, description: 'INTERNAL_ERROR' })
  preview(@Body() body: ThumbnailPromptPreviewRequestDto): Promise<ThumbnailPromptPreviewDto> {
    return this.previews.preview(body);
  }
}
