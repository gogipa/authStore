import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  type PipeTransform,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiException } from '../../../common/errors/api.exception.js';
import { CandidateIdPipe } from '../../step-engine/candidates/candidates.controller.js';
import { TagCompetitorInputCreatedDto, TagCompetitorInputListDto } from '../dto/tags.dto.js';
import {
  CompetitorInputsService,
  competitorInputsLocation,
  TAG_INPUT_FILE_HARD_LIMIT,
  type UploadedTagFile,
} from './competitor-inputs.service.js';

const MAX_ID = 2_147_483_647;

/** 경로 inputId: 1 이상 int4가 아니면 404 COMPETITOR_INPUT_NOT_FOUND(P1-01 이미지·P2-04 요금표와 같은 방식) */
export class CompetitorInputIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text) && Number(text) <= MAX_ID) {
      return Number(text);
    }
    throw new ApiException('COMPETITOR_INPUT_NOT_FOUND');
  }
}

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const INTERNAL = { status: 500, description: 'INTERNAL_ERROR' } as const;

/**
 * 경쟁 태그 입력(05-2 태그 tags, P3-05 F-TG-02~06). 파일은 multer 메모리로만 받는다(디스크에 쓰지 않는다 — `dest` 없음).
 * 파일 이름·붙여 넣은 글은 저장·로그·오류 응답에 남기지 않는다(TG-01·CON-09).
 */
@ApiTags('tags')
@Controller()
export class CompetitorInputsController {
  constructor(private readonly inputs: CompetitorInputsService) {}

  @Get('candidates/:candidateId/tag-competitor-inputs')
  @ApiOperation({ operationId: 'listTagCompetitorInputs', summary: '경쟁 태그 입력 목록' })
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiOkResponse({ type: TagCompetitorInputListDto, description: '경쟁 태그 입력 목록' })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiResponse(INTERNAL)
  list(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
  ): Promise<TagCompetitorInputListDto> {
    return this.inputs.list(candidateId);
  }

  @Post('candidates/:candidateId/tag-competitor-inputs')
  @HttpCode(201)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: TAG_INPUT_FILE_HARD_LIMIT, files: 1, fields: 4, fieldSize: 1024 },
    }),
  )
  @ApiOperation({ operationId: 'createTagCompetitorInput', summary: '경쟁 태그 입력 읽어 저장' })
  @ApiHeader(CLIENT_HEADER)
  @ApiParam({ name: 'candidateId', type: 'integer', required: true })
  @ApiExtraModels(TagCompetitorInputCreatedDto)
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['sourceType'],
      properties: {
        sourceType: { type: 'string', enum: ['SELLERFINDER', 'BROWSER_RESPONSE', 'FREE_TEXT'] },
        text: { type: 'string', minLength: 1, description: '붙여 넣은 원문(파싱 뒤 버린다)' },
        file: { type: 'string', format: 'binary', description: '셀라파인더 엑셀(xlsx)·CSV' },
      },
    },
  })
  @ApiCreatedResponse({
    type: TagCompetitorInputCreatedDto,
    description: '저장한 입력과 파싱한 태그. Location: 후보의 경쟁 태그 입력 목록 경로',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'CANDIDATE_NOT_FOUND' })
  @ApiConflictResponse({
    description: 'CANDIDATE_LOCKED, CANDIDATE_EXCLUDED, STEP_LOCKED_BY_RUNNING_STEP(⑦ 실행 중)',
  })
  @ApiPayloadTooLargeResponse({
    description: 'PAYLOAD_TOO_LARGE — 파일 또는 붙여 넣은 글이 크기 상한을 넘음',
  })
  @ApiUnprocessableEntityResponse({
    description:
      'IMPORT_PARSE_FAILED(fieldErrors에 행·열), IMPORT_EMPTY, UNSUPPORTED_FILE_TYPE, VALIDATION_FAILED',
  })
  @ApiResponse(INTERNAL)
  async create(
    @Param('candidateId', CandidateIdPipe) candidateId: number,
    @Body() body: Record<string, unknown>,
    @UploadedFile() file: UploadedTagFile | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TagCompetitorInputCreatedDto> {
    const created = await this.inputs.create(candidateId, body, file);
    res.setHeader('Location', competitorInputsLocation(candidateId));
    return created;
  }

  @Delete('tag-competitor-inputs/:inputId')
  @HttpCode(204)
  @ApiOperation({ operationId: 'removeTagCompetitorInput', summary: '경쟁 태그 입력 빼기' })
  @ApiHeader(CLIENT_HEADER)
  @ApiParam({ name: 'inputId', type: 'integer', required: true })
  @ApiNoContentResponse({ description: '뺐다(또는 이미 뺌)' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'COMPETITOR_INPUT_NOT_FOUND' })
  @ApiConflictResponse({ description: 'CANDIDATE_LOCKED, STEP_LOCKED_BY_RUNNING_STEP(⑦ 실행 중)' })
  @ApiResponse(INTERNAL)
  async remove(@Param('inputId', CompetitorInputIdPipe) inputId: number): Promise<void> {
    await this.inputs.remove(inputId);
  }
}
