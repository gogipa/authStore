import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { STEP_FLOW, type StepCode } from '../domain/steps.js';
import { ContinuousRunSummaryDto } from './candidate-response.dto.js';
import { StepRunSummaryDto } from './step-run-response.dto.js';

/** 연속 실행 요청·응답(05-2 ContinuousRunStartRequest·ContinuousRunAccepted·ContinuousRunDetail, P1-06) */

const CHAIN_START_CODES = STEP_FLOW.filter((code) => code !== 'REGISTER');

/**
 * POST /candidates/{candidateId}/continuous-runs body. kind는 여기서(422 VALIDATION_FAILED), startStepCode는
 * 서비스에서 본다: FROM_HERE인데 없으면 422 VALIDATION_FAILED, 모르는 코드·REGISTER면 422 INVALID_STEP_CODE.
 * RERUN_STALE에 startStepCode를 주면 쓰지 않는다(묶음은 흐름 순서 전체).
 */
export class ContinuousRunStartRequestDto {
  @ApiProperty({ enum: ['FROM_HERE', 'RERUN_STALE'] })
  @IsIn(['FROM_HERE', 'RERUN_STALE'], { message: 'FROM_HERE·RERUN_STALE 중 하나여야 합니다.' })
  kind!: 'FROM_HERE' | 'RERUN_STALE';

  @ApiPropertyOptional({
    enum: CHAIN_START_CODES,
    description: '시작 단계(FROM_HERE 필수). G2 전에는 SOURCING·PRICING만',
  })
  @IsOptional()
  @IsString({ message: '단계 코드여야 합니다.' })
  startStepCode?: string;
}

/** 05-2 ContinuousRunAccepted */
export class ContinuousRunAcceptedDto {
  @ApiProperty({ type: 'integer' })
  stepChainId!: number;

  @ApiProperty({ type: 'integer' })
  candidateId!: number;

  @ApiProperty({ enum: ['FROM_HERE', 'RERUN_STALE'] })
  kind!: 'FROM_HERE' | 'RERUN_STALE';

  @ApiProperty({ enum: STEP_FLOW, nullable: true })
  startStepCode!: StepCode | null;

  @ApiProperty({ type: 'string', format: 'date-time' })
  startedAt!: string;

  @ApiProperty({ enum: ['RUNNING'], description: '묶음 상태(ended_at이 null이면 RUNNING)' })
  status!: 'RUNNING';

  @ApiProperty({ type: 'integer', nullable: true, description: '곧바로 시작한 단계 실행' })
  stepRunId!: number | null;

  @ApiProperty({ enum: STEP_FLOW, nullable: true })
  stepCode!: StepCode | null;
}

/** 05-2 ContinuousRunDetail */
export class ContinuousRunDetailDto extends ContinuousRunSummaryDto {
  @ApiProperty({ type: [StepRunSummaryDto], description: '이 묶음으로 만든 단계 실행' })
  stepRuns!: StepRunSummaryDto[];

  @ApiProperty({ enum: STEP_FLOW, isArray: true, description: '완료·최신이라 건너뛴 단계' })
  skippedStepCodes!: StepCode[];
}
