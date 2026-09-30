import { Controller, Get, Param, type PipeTransform } from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ApiException } from '../../common/errors/api.exception.js';
import { StepRunDetailDto } from './dto/step-run-response.dto.js';
import { StepRailService } from './rail/step-rail.service.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

/** 경로 stepRunId: 1 이상 int4 정수가 아니면 그런 실행은 없다(404 STEP_RUN_NOT_FOUND, 후보 id와 같은 규칙) */
export class StepRunIdPipe implements PipeTransform<unknown, number> {
  transform(value: unknown): number {
    const text = typeof value === 'number' ? String(value) : value;
    if (typeof text === 'string' && /^[1-9]\d{0,9}$/.test(text)) {
      const id = Number(text);
      if (id <= MAX_ID) return id;
    }
    throw new ApiException('STEP_RUN_NOT_FOUND');
  }
}

/** 단계 실행 한 건(05-2 getStepRun). SSE를 놓쳤을 때 확인하는 경로 */
@ApiTags('step-engine')
@Controller('step-runs')
export class StepRunsController {
  constructor(private readonly rail: StepRailService) {}

  @Get(':stepRunId')
  @ApiOperation({ operationId: 'getStepRun', summary: '단계 실행 한 건' })
  @ApiParam({ name: 'stepRunId', type: 'integer', required: true })
  @ApiOkResponse({ type: StepRunDetailDto })
  @ApiForbiddenResponse({ description: '로컬 보안 검사 실패(Host)' })
  @ApiNotFoundResponse({ description: 'STEP_RUN_NOT_FOUND' })
  get(@Param('stepRunId', StepRunIdPipe) stepRunId: number): Promise<StepRunDetailDto> {
    return this.rail.stepRun(stepRunId);
  }
}
