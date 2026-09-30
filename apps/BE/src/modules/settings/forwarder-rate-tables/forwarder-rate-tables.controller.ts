import {
  Body,
  Controller,
  Get,
  Param,
  type PipeTransform,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
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
import {
  ForwarderRateTableDetailDto,
  ForwarderRateTableImportResultDto,
  ForwarderRateTablePageDto,
  ImportForwarderRateTableFieldsDto,
  ListForwarderRateTablesQueryDto,
} from './dto/forwarder-rate-table.dto.js';
import {
  ForwarderRateTablesService,
  RATE_TABLE_MAX_BYTES,
  type UploadedCsvFile,
} from './forwarder-rate-tables.service.js';

const MAX_ID = 2_147_483_647;

/** 경로 id: 1 이상 int4가 아니면 404 RATE_TABLE_NOT_FOUND(P1-01·P2-01과 같은 방식) */
export class RateTableIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text) && Number(text) <= MAX_ID) {
      return Number(text);
    }
    throw new ApiException('RATE_TABLE_NOT_FOUND');
  }
}

/** 새 버전 조회 경로(Location) */
export function rateTableLocation(id: number): string {
  return `/api/v1/forwarder-rate-tables/${id}`;
}

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const INTERNAL = { status: 500, description: 'INTERNAL_ERROR' } as const;

/** 배대지 요금표(05-2 태그 settings, P2-04 F-ST-04): CSV 가져오기·버전 목록·버전 상세 */
@ApiTags('settings')
@Controller('forwarder-rate-tables')
export class ForwarderRateTablesController {
  constructor(private readonly rateTables: ForwarderRateTablesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: RATE_TABLE_MAX_BYTES, files: 1, fields: 5, fieldSize: 4096 },
      // 한글 파일 이름(busboy 기본은 latin1)
      defParamCharset: 'utf8',
    }),
  )
  @ApiOperation({ operationId: 'importForwarderRateTable', summary: '배대지 요금표 CSV 가져오기' })
  @ApiHeader(CLIENT_HEADER)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: '배대지 요금표 CSV(5MB 이하)' },
        forwarderName: { type: 'string', maxLength: 100, description: '배대지 이름(표시용)' },
      },
    },
  })
  @ApiOkResponse({
    type: ForwarderRateTableImportResultDto,
    description: '같은 파일 — 기존 버전을 다시 활성화',
  })
  @ApiCreatedResponse({
    type: ForwarderRateTableImportResultDto,
    description: '새 요금표 버전을 만들고 활성화. Location: /api/v1/forwarder-rate-tables/{id}',
  })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiPayloadTooLargeResponse({ description: 'PAYLOAD_TOO_LARGE — 파일이 5MB를 넘음' })
  @ApiUnprocessableEntityResponse({
    description:
      'IMPORT_PARSE_FAILED(fieldErrors에 row{줄}.{열}) · IMPORT_EMPTY · UNSUPPORTED_FILE_TYPE · VALIDATION_FAILED',
  })
  @ApiResponse(INTERNAL)
  async import(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body() fields: ImportForwarderRateTableFieldsDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ForwarderRateTableImportResultDto> {
    const { created, result } = await this.rateTables.import(file, fields);
    if (created) {
      res.status(201);
      res.setHeader('Location', rateTableLocation(result.rateTable.id));
    } else {
      res.status(200);
    }
    return result;
  }

  @Get()
  @ApiOperation({ operationId: 'listForwarderRateTables', summary: '배대지 요금표 버전 목록 조회' })
  @ApiOkResponse({ type: ForwarderRateTablePageDto, description: '요금표 버전 한 페이지' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse(INTERNAL)
  list(@Query() query: ListForwarderRateTablesQueryDto): Promise<ForwarderRateTablePageDto> {
    return this.rateTables.list(query);
  }

  @Get(':rateTableId')
  @ApiOperation({ operationId: 'getForwarderRateTable', summary: '배대지 요금표 버전 상세 조회' })
  @ApiParam({ name: 'rateTableId', type: 'integer', required: true })
  @ApiOkResponse({ type: ForwarderRateTableDetailDto, description: '요금표 버전과 무게 구간' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiNotFoundResponse({ description: 'RATE_TABLE_NOT_FOUND' })
  @ApiResponse(INTERNAL)
  get(@Param('rateTableId', RateTableIdPipe) id: number): Promise<ForwarderRateTableDetailDto> {
    return this.rateTables.get(id);
  }
}
