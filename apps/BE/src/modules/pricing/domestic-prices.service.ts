import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { parsePageRequest, toPage } from '../../common/paging/page-request.js';
import type { DomesticPrice } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import { StepEngineTransactions } from '../step-engine/candidates/step-engine-tx.js';
import { INPUT_KEYS } from '../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import type {
  CreateDomesticPriceDto,
  DomesticPriceCreatedDto,
  DomesticPriceEntryDto,
  DomesticPricePageDto,
  ListDomesticPricesQueryDto,
  PricingStepStatus,
} from './dto/domestic-price.dto.js';

/** ③ 입력 대기를 이어 가지 못하게 막는 실행 중 단계(② 앞 단계·⑥-3 뒤 단계)와 화면 이름 */
const RESUME_BLOCKING_STEPS = { SOURCING: '② 소싱', NOTICE_HTML: '⑥-3 고시·HTML' } as const;

export function toDomesticPriceEntry(row: DomesticPrice): DomesticPriceEntryDto {
  return {
    id: row.id,
    candidateId: row.candidateId,
    pRefKrw: row.pRefKrw,
    sourceKind: row.sourceKind as DomesticPriceEntryDto['sourceKind'],
    sourceLabel: row.sourceLabel,
    sourceUrl: row.sourceUrl,
    enteredAt: row.enteredAt.toISOString(),
    domesticPriceImportRowId: null,
  };
}

export function domesticPricesLocation(candidateId: number): string {
  return `/api/v1/candidates/${candidateId}/domestic-prices`;
}

function stepLocked(runningStepCode: string, label: string): ApiException {
  return new ApiException('STEP_LOCKED_BY_RUNNING_STEP', {
    message: formatErrorMessage('STEP_LOCKED_BY_RUNNING_STEP', { 단계: label }),
    details: { stepCode: 'PRICING', runningStepCode },
  });
}

/**
 * 국내 기준가(05-2 createDomesticPrice·listDomesticPrices, F-PJ-13·14, P2-05 규칙 13). `domestic_price`는 추가만.
 * - 입력: 후보 잠금 → 잠금(409 CANDIDATE_LOCKED)·제외(409 CANDIDATE_EXCLUDED) → ③ 실행 중이면 409 STEP_LOCKED_BY_RUNNING_STEP
 *   → 새 행. M1은 `sourceKind=MANUAL`만 받는다(SELLAFINDER·domesticPriceImportRowId는 422 VALIDATION_FAILED — Proposed)
 * - ③이 국내 기준가를 기다리면(WAITING_INPUT) 커밋 뒤 step-engine `resumeWaiting`으로 이어 계산한다 → `pricingStepStatus=RUNNING`
 * - ③이 완료(또는 재실행 필요)였으면 같은 트랜잭션에서 `StepEngineApi.ownerInputChanged('owner.domesticPrice')` → 값이 바뀌면
 *   RERUN_REQUIRED(같은 금액이면 그대로 — 값 해시만 본다, Proposed). candidate_step은 pricing이 직접 고치지 않는다
 */
@Injectable()
export class DomesticPricesService {
  private readonly logger = new Logger(DomesticPricesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly api: StepEngineApi,
  ) {}

  async create(
    candidateId: number,
    body: CreateDomesticPriceDto,
  ): Promise<DomesticPriceCreatedDto> {
    const fieldErrors = [];
    if (body.sourceKind !== undefined && body.sourceKind !== 'MANUAL') {
      fieldErrors.push({
        field: 'sourceKind',
        message: 'M1에서는 직접 입력(MANUAL)만 받습니다.',
        rejectedValue: body.sourceKind,
      });
    }
    if (body.domesticPriceImportRowId !== undefined && body.domesticPriceImportRowId !== null) {
      fieldErrors.push({
        field: 'domesticPriceImportRowId',
        message: '셀라파인더 가져오기는 M2입니다.',
        rejectedValue: body.domesticPriceImportRowId,
      });
    }
    if (fieldErrors.length > 0) throw new ApiException('VALIDATION_FAILED', { fieldErrors });
    await this.guard.findOr404(this.prisma, candidateId);
    const saved = await this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
      this.guard.assertMutable(candidate);
      const steps = await scope.tx.candidateStep.findMany({
        where: {
          candidateId,
          stepCode: { in: ['PRICING', ...Object.keys(RESUME_BLOCKING_STEPS)] },
        },
        select: { stepCode: true, status: true, currentStepRunId: true },
      });
      const pricing = steps.find((s) => s.stepCode === 'PRICING');
      if (pricing?.status === 'RUNNING') throw stepLocked('PRICING', '③ 판정');
      if (pricing?.status === 'WAITING_INPUT') {
        for (const [code, label] of Object.entries(RESUME_BLOCKING_STEPS)) {
          if (steps.some((s) => s.stepCode === code && s.status === 'RUNNING')) {
            throw stepLocked(code, label);
          }
        }
      }
      const row = await scope.tx.domesticPrice.create({
        data: {
          candidateId,
          pRefKrw: body.pRefKrw,
          sourceKind: 'MANUAL',
          sourceLabel: body.sourceLabel?.trim() || null,
          sourceUrl: body.sourceUrl?.trim() || null,
          enteredAt: scope.now,
        },
      });
      let status = (pricing?.status ?? 'NOT_RUN') as PricingStepStatus;
      if (status === 'COMPLETED' || status === 'RERUN_REQUIRED') {
        await this.api.ownerInputChanged(candidateId, INPUT_KEYS.ownerDomesticPrice, scope);
        const after = await scope.tx.candidateStep.findUniqueOrThrow({
          where: { candidateId_stepCode: { candidateId, stepCode: 'PRICING' } },
          select: { status: true },
        });
        status = after.status as PricingStepStatus;
      }
      const resumeRunId = status === 'WAITING_INPUT' ? (pricing?.currentStepRunId ?? null) : null;
      return { row, status, resumeRunId };
    });
    let status = saved.status;
    if (saved.resumeRunId !== null) {
      try {
        const resumed = await this.api.resumeWaiting(saved.resumeRunId, {
          data: { domesticPriceId: saved.row.id },
        });
        status = resumed.status as PricingStepStatus;
      } catch (error) {
        // 저장은 끝났다. 이어 가지 못하면(드문 경합) 입력 대기 그대로 알린다 — 다시 넣거나 ③을 다시 실행한다
        if (!(error instanceof ApiException)) throw error;
        this.logger.warn(`③ 입력 대기를 이어 가지 못했습니다(${error.code})`);
      }
    }
    return { ...toDomesticPriceEntry(saved.row), pricingStepStatus: status };
  }

  async list(
    candidateId: number,
    query: ListDomesticPricesQueryDto,
  ): Promise<DomesticPricePageDto> {
    const request = parsePageRequest('/candidates/{candidateId}/domestic-prices', query);
    await this.guard.findOr404(this.prisma, candidateId);
    const where = { candidateId };
    const [rows, total] = await Promise.all([
      this.prisma.domesticPrice.findMany({
        where,
        orderBy: [
          ...request.sort.map((s) => ({ [s.field]: s.direction })),
          { id: request.sort[0]?.direction ?? 'desc' },
        ],
        skip: request.skip,
        take: request.take,
      }),
      this.prisma.domesticPrice.count({ where }),
    ]);
    return toPage(rows.map(toDomesticPriceEntry), request, total);
  }
}
