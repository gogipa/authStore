import { Body, Controller, Get, Param, type PipeTransform, Post, Query, Res } from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiForbiddenResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ApiException } from '../../common/errors/api.exception.js';
import {
  assertSnapshotCreateShape,
  CreateKeywordSnapshotDto,
  KeywordCollectionAcceptedDto,
  KeywordSnapshotDetailDto,
  KeywordSnapshotDto,
  KeywordSnapshotPageDto,
  ListKeywordSnapshotsQueryDto,
  ListSnapshotKeywordsQueryDto,
  RankedKeywordPageDto,
} from './dto/keyword-snapshot.dto.js';
import { KeywordCollectionService } from './keyword-collection.service.js';
import { KeywordSnapshotsService } from './keyword-snapshots.service.js';
import { DEFAULT_RANK_LIMIT, keywordSnapshotLocation, parsePathId } from './keywords.constants.js';

/** 경로 묶음 id: 1 이상 int4가 아니면 404 KEYWORD_SNAPSHOT_NOT_FOUND(P1-01·P1-04와 같은 방식) */
export class KeywordSnapshotIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const id = parsePathId(value);
    if (id === null) throw new ApiException('KEYWORD_SNAPSHOT_NOT_FOUND');
    return id;
  }
}

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const INTERNAL = { status: 500, description: 'INTERNAL_ERROR' } as const;
const SNAPSHOT_ID_PARAM = { name: 'keywordSnapshotId', type: 'integer', required: true } as const;

/** 키워드 수집 묶음(05-2 태그 keywords, P2-01): 목록·만들기(버튼 202 / 붙여넣기 201)·한 건·묶음 안 키워드 */
@ApiTags('keywords')
@ApiExtraModels(KeywordSnapshotDto, KeywordCollectionAcceptedDto)
@Controller('keyword-snapshots')
export class KeywordSnapshotsController {
  constructor(
    private readonly snapshots: KeywordSnapshotsService,
    private readonly collection: KeywordCollectionService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listKeywordSnapshots', summary: '키워드 수집 묶음 목록' })
  @ApiOkResponse({ type: KeywordSnapshotPageDto, description: '묶음 목록' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER — 허용 밖 필터·정렬 값' })
  @ApiResponse(INTERNAL)
  list(@Query() query: ListKeywordSnapshotsQueryDto): Promise<KeywordSnapshotPageDto> {
    return this.snapshots.list(query);
  }

  @Post()
  @ApiOperation({
    operationId: 'createKeywordSnapshot',
    summary: '키워드 목록 만들기(버튼 수집·붙여넣기)',
  })
  @ApiHeader(CLIENT_HEADER)
  @ApiCreatedResponse({
    type: KeywordSnapshotDto,
    description: '붙여넣기(PASTE)로 만든 묶음. Location: /api/v1/keyword-snapshots/{id}',
  })
  @ApiAcceptedResponse({
    type: KeywordCollectionAcceptedDto,
    description: '버튼 수집(BUTTON)을 받았다. Location: /api/v1/keyword-snapshots/{id}',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiConflictResponse({
    description:
      'ALREADY_IN_PROGRESS(details.job=KEYWORD_COLLECTION) · EXTERNAL_CALL_COOLDOWN(Retry-After) · DAILY_LIMIT_REACHED(Proposed)',
  })
  @ApiPayloadTooLargeResponse({
    description: 'PAYLOAD_TOO_LARGE — 붙여 넣은 글이 100,000자를 넘음',
  })
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED · IMPORT_PARSE_FAILED · IMPORT_EMPTY',
  })
  @ApiServiceUnavailableResponse({ description: 'SETTINGS_INVALID — 버튼 수집에 쓸 설정이 없음' })
  @ApiResponse(INTERNAL)
  async create(
    @Body() body: CreateKeywordSnapshotDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<KeywordSnapshotDto | KeywordCollectionAcceptedDto> {
    assertSnapshotCreateShape(body);
    if (body.method === 'BUTTON') {
      const accepted = await this.collection.start({
        rankLimit: body.rankLimit ?? DEFAULT_RANK_LIMIT,
      });
      res.status(202);
      res.setHeader('Location', keywordSnapshotLocation(accepted.keywordSnapshotId));
      return accepted;
    }
    const created = await this.snapshots.createPaste(body.text!, body.cid ?? null);
    res.status(201);
    res.setHeader('Location', keywordSnapshotLocation(created.id));
    return created;
  }

  @Get(':keywordSnapshotId')
  @ApiOperation({ operationId: 'getKeywordSnapshot', summary: '키워드 수집 묶음 한 건' })
  @ApiParam(SNAPSHOT_ID_PARAM)
  @ApiOkResponse({ type: KeywordSnapshotDetailDto, description: '묶음 한 건' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'KEYWORD_SNAPSHOT_NOT_FOUND' })
  @ApiResponse(INTERNAL)
  get(
    @Param('keywordSnapshotId', KeywordSnapshotIdPipe) id: number,
  ): Promise<KeywordSnapshotDetailDto> {
    return this.snapshots.get(id);
  }

  @Get(':keywordSnapshotId/keywords')
  @ApiOperation({ operationId: 'listSnapshotKeywords', summary: '묶음 안 키워드 목록' })
  @ApiParam(SNAPSHOT_ID_PARAM)
  @ApiOkResponse({ type: RankedKeywordPageDto, description: '키워드 목록' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'KEYWORD_SNAPSHOT_NOT_FOUND' })
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse(INTERNAL)
  listKeywords(
    @Param('keywordSnapshotId', KeywordSnapshotIdPipe) id: number,
    @Query() query: ListSnapshotKeywordsQueryDto,
  ): Promise<RankedKeywordPageDto> {
    return this.snapshots.listKeywords(id, query);
  }
}
