import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import {
  CreateManualFxRateDto,
  FxRateLatestSetDto,
  FxRatePageDto,
  FxRateRecordDto,
  ListFxRatesQueryDto,
} from './dto/fx-rate.dto.js';
import { FxRatesService } from './fx-rates.service.js';

const CLIENT_HEADER = {
  name: 'X-AutoStore-Client',
  required: true,
  description: '앱 화면 요청 표시(값 1)',
} as const;
const FORBIDDEN = { description: '로컬 보안 검사 실패(Host·Origin·X-AutoStore-Client)' } as const;
const INTERNAL = { status: 500, description: 'INTERNAL_ERROR' } as const;

/** 환율(05-2 태그 pricing, P2-04 F-ST-06·F-BS-42·43·44): 최신값과 경고·이력·수동 입력 */
@ApiTags('pricing')
@Controller('fx-rates')
export class FxRatesController {
  constructor(private readonly fxRates: FxRatesService) {}

  @Get('latest')
  @ApiOperation({ operationId: 'getLatestFxRates', summary: '종류·통화별 최신 환율과 경고' })
  @ApiOkResponse({ type: FxRateLatestSetDto, description: '최신 환율과 경고' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiResponse(INTERNAL)
  latest(): Promise<FxRateLatestSetDto> {
    return this.fxRates.getLatest();
  }

  @Get()
  @ApiOperation({ operationId: 'listFxRates', summary: '환율 기록 이력' })
  @ApiOkResponse({ type: FxRatePageDto, description: '환율 이력' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiUnprocessableEntityResponse({ description: 'INVALID_QUERY_PARAMETER' })
  @ApiResponse(INTERNAL)
  list(@Query() query: ListFxRatesQueryDto): Promise<FxRatePageDto> {
    return this.fxRates.list(query);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ operationId: 'createManualFxRate', summary: '환율 수동 입력' })
  @ApiHeader(CLIENT_HEADER)
  @ApiCreatedResponse({ type: FxRateRecordDto, description: '저장한 환율 기록' })
  @ApiBadRequestResponse({ description: 'MALFORMED_REQUEST' })
  @ApiForbiddenResponse(FORBIDDEN)
  @ApiUnprocessableEntityResponse({
    description: 'VALIDATION_FAILED — rateValue ≤ 0, USD인데 unit=100, 원가 환율인데 USD(Proposed)',
  })
  @ApiResponse(INTERNAL)
  create(@Body() body: CreateManualFxRateDto): Promise<FxRateRecordDto> {
    return this.fxRates.createManual(body);
  }
}
