import { Injectable, Logger } from '@nestjs/common';
import { UserActionLogService } from '../../common/audit/user-action-log.service.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import type { CategoryGender } from '../../common/rules/category-gender.js';
import type { CategoryDecision, Prisma, StepRun } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CommerceMetaCacheService } from '../integrations/commerce-meta/commerce-meta-cache.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import {
  StepEngineTransactions,
  type StepEngineTx,
} from '../step-engine/candidates/step-engine-tx.js';
import type { StepCode } from '../step-engine/domain/steps.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { CategoryDecisionRepository } from './category-decision.repository.js';
import {
  categoryWordRulesOf,
  exceptionalCategoriesRaw,
  optionViewOf,
  selectionWriteOf,
  type CategoryOptionView,
} from './category-sources.js';
import type { CategoryOutput } from './category-step.runner.js';
import type {
  CategoryDecisionDetailDto,
  CategorySelectionRequestDto,
  CategorySelectionResultDto,
} from './dto/category-decision.dto.js';
import {
  BLOCK_ERROR_CODE,
  judgeCategoryException,
  type CategoryBlockReason,
} from './rules/category-exception.js';
import { parseCategoryOptions } from './rules/category-options.js';

const MAX_ID = 2_147_483_647;

type Tx = Prisma.TransactionClient;

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/** 실행 전·산출물 없음(05-2 getCategoryDecision 404, details.stepCode=CATEGORY) */
export function categoryOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '④ 카테고리' }),
    details: { stepCode: 'CATEGORY' },
  });
}

/** 쿼리(05-2 getCategoryDecision: stepRunId만) — 어기면 422 INVALID_QUERY_PARAMETER */
export function parseCategoryDecisionQuery(query: Record<string, unknown>): {
  stepRunId: number | null;
} {
  for (const key of Object.keys(query)) {
    if (key !== 'stepRunId') throw invalidQuery(key, '받지 않는 조건입니다.');
  }
  if (query.stepRunId === undefined) return { stepRunId: null };
  const raw = typeof query.stepRunId === 'string' ? query.stepRunId : '';
  if (!/^[1-9]\d{0,9}$/.test(raw) || Number(raw) > MAX_ID) {
    throw invalidQuery('stepRunId', '1 이상의 정수여야 합니다.');
  }
  return { stepRunId: Number(raw) };
}

function genderOf(value: unknown): CategoryGender | null {
  return value === 'MALE' || value === 'FEMALE' ? value : null;
}

/**
 * 고르기가 차단 판단으로 막혔다(규칙 13). 트랜잭션을 되돌린 뒤 판단을 감사 기록에 남기고 409를 준다.
 */
class CategoryBlockedError extends Error {
  constructor(
    readonly exception: ApiException,
    readonly audit: {
      candidateId: number;
      stepRunId: number;
      leafCategoryId: string;
      wholeCategoryName: string;
      blockReason: CategoryBlockReason;
      reason: string;
    },
  ) {
    super(exception.message);
  }
}

/**
 * ④ 카테고리 결정 조회·고르기(05-2 getCategoryDecision·selectCategoryDecisionLeaf, F-CA-03·04·06·07·08·09·10, P2-06 규칙 5·7·8~13·15).
 */
@Injectable()
export class CategoryDecisionsService {
  private readonly logger = new Logger(CategoryDecisionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly api: StepEngineApi,
    private readonly cache: CommerceMetaCacheService,
    private readonly decisions: CategoryDecisionRepository,
    private readonly settings: SettingsService,
    private readonly audit: UserActionLogService,
  ) {}

  /**
   * 결정 조회(규칙 5·15): 현재 버전(candidate_step.current_step_run_id) 또는 `?stepRunId=` 버전.
   * 없는 후보 404 CANDIDATE_NOT_FOUND, 없는 실행 404 STEP_RUN_NOT_FOUND, 다른 후보·단계의 실행 422 INVALID_QUERY_PARAMETER,
   * 산출물 없음(실행 전·실패) 404 STEP_OUTPUT_NOT_FOUND(details.stepCode=CATEGORY). 후보별 `kcExemptionRequired`·`blocked`
   * (+ `blockReason`)는 `commerce_category`의 **지금** 예외 유형·경로로 계산한다(`category_options`에는 id·이름만).
   */
  async get(
    candidateId: number,
    rawQuery: Record<string, unknown>,
  ): Promise<CategoryDecisionDetailDto> {
    const query = parseCategoryDecisionQuery(rawQuery);
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: candidateId },
      select: { id: true, gender: true },
    });
    if (!candidate) throw new ApiException('CANDIDATE_NOT_FOUND');
    const step = await this.prisma.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'CATEGORY' } },
      select: { currentStepRunId: true },
    });
    const runId = query.stepRunId ?? step?.currentStepRunId ?? null;
    if (runId === null) throw categoryOutputNotFound();
    const run = await this.prisma.stepRun.findUnique({ where: { id: runId } });
    if (!run) throw new ApiException('STEP_RUN_NOT_FOUND');
    if (run.candidateId !== candidateId || run.stepCode !== 'CATEGORY') {
      throw invalidQuery('stepRunId', '이 여정의 ④ 카테고리 실행이 아닙니다.');
    }
    const decision = await this.decisions.findByStepRun(this.prisma, run.id);
    if (!decision) throw categoryOutputNotFound();
    const options = await this.optionViews(decision);
    return toDetailDto(decision, run, step?.currentStepRunId === run.id, options);
  }

  /** 후보 목록 표시(조회 때 계산). 성별 일치는 이 결정의 성별로 본다 */
  private async optionViews(decision: CategoryDecision): Promise<CategoryOptionView[]> {
    const entries = parseCategoryOptions(decision.categoryOptions);
    const leaves = await this.cache.findCategories(entries.map((e) => e.leafCategoryId));
    const byId = new Map(leaves.map((leaf) => [leaf.categoryId, leaf]));
    const settings = this.settings.currentOrNull();
    const rules = settings
      ? categoryWordRulesOf(settings)
      : { childCategoryWords: [], excludedCategoryWords: [] };
    return entries.map((entry) =>
      optionViewOf(entry, byId.get(entry.leafCategoryId) ?? null, rules, genderOf(decision.gender)),
    );
  }

  /**
   * 리프 고르기(규칙 7·10·12·13): 검사 순서(Proposed) — 결정 없음 404 → 입력 대기 아님 409 STEP_RUN_NOT_WAITING_INPUT →
   * 보여 준 목록에 없음·캐시에서 사라짐 422 CATEGORY_NOT_IN_OPTIONS → 아동 409 CATEGORY_CHILD_BLOCKED → 제외 품목 409
   * CATEGORY_EXCLUDED_ITEM → 성별 불일치 409 CATEGORY_GENDER_MISMATCH → KC 확인 없음 409 KC_EXEMPT_CONFIRMATION_REQUIRED →
   * 잠긴 후보 409 CANDIDATE_LOCKED(제외 후보 409 CANDIDATE_EXCLUDED).
   * 통과하면 한 트랜잭션: `category_decision`(리프·경로·성별 일치·예외 판단·KC 면제·확정 시각) + ④ 완료(step-engine
   * `resumeWaiting({ outcome })` — 끝 지문·후보 `leaf_category_id`·`whole_category_name`·뒷단계 재실행 필요 전파·상태 재평가) +
   * 감사 기록(CATEGORY_DECISION). 차단(아동·제외 품목·성별)은 되돌린 뒤 따로 감사 기록을 남기고 409를 준다(결정은 입력 대기
   * 그대로 — `exception_decision=BLOCKED`는 쓰지 않는다, Proposed).
   */
  async select(
    categoryDecisionId: number,
    body: CategorySelectionRequestDto,
  ): Promise<CategorySelectionResultDto> {
    if (body.candidateSource !== undefined) {
      throw new ApiException('VALIDATION_FAILED', {
        fieldErrors: [
          {
            field: 'candidateSource',
            message: '리프 검색·직접 선택(SEARCH)은 M2 기능입니다. 보여 드린 목록에서 골라 주세요.',
            rejectedValue: body.candidateSource,
          },
        ],
      });
    }
    try {
      return await this.transactions.run((scope) =>
        this.selectInScope(scope, categoryDecisionId, body),
      );
    } catch (error) {
      if (error instanceof CategoryBlockedError) {
        await this.recordBlocked(error);
        throw error.exception;
      }
      throw error;
    }
  }

  private async selectInScope(
    scope: StepEngineTx,
    categoryDecisionId: number,
    body: CategorySelectionRequestDto,
  ): Promise<CategorySelectionResultDto> {
    const found = await this.decisions.findById(scope.tx, categoryDecisionId);
    if (!found) throw new ApiException('CATEGORY_DECISION_NOT_FOUND');
    const candidateId = found.stepRun.candidateId;
    const candidate = await this.guard.lockForUpdate(scope.tx, candidateId);
    const run = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: found.stepRunId } });
    if (run.status !== 'WAITING_INPUT') throw new ApiException('STEP_RUN_NOT_WAITING_INPUT');
    const decision = (await this.decisions.findByStepRun(scope.tx, run.id))!;

    const entry = parseCategoryOptions(decision.categoryOptions).find(
      (option) => option.leafCategoryId === body.leafCategoryId,
    );
    if (!entry) {
      throw new ApiException('CATEGORY_NOT_IN_OPTIONS', {
        details: { leafCategoryId: body.leafCategoryId, reason: 'NOT_IN_OPTIONS' },
      });
    }
    const leaf = await this.cache.findCategory(entry.leafCategoryId);
    if (!leaf || leaf.removedAt !== null) {
      throw new ApiException('CATEGORY_NOT_IN_OPTIONS', {
        message:
          '네이버 카테고리 목록에서 사라진 카테고리입니다. 메타데이터를 다시 동기화한 뒤 ④를 다시 실행해 주세요.',
        details: { leafCategoryId: entry.leafCategoryId, reason: 'REMOVED' },
      });
    }
    // 예외 판단은 캐시의 지금 값으로 다시 한다(§8 '캐시는 값 복사'). 성별은 후보의 지금 값(재확인 반영)
    const gender = genderOf(candidate.gender) ?? genderOf(decision.gender);
    const judged = judgeCategoryException(
      leaf,
      categoryWordRulesOf(this.settings.current()),
      gender,
    );
    if (judged.decision === 'BLOCKED') {
      throw new CategoryBlockedError(new ApiException(BLOCK_ERROR_CODE[judged.blockReason]), {
        candidateId,
        stepRunId: run.id,
        leafCategoryId: leaf.categoryId,
        wholeCategoryName: leaf.wholeCategoryName,
        blockReason: judged.blockReason,
        reason: judged.reasonText,
      });
    }
    if (judged.decision === 'KC_EXEMPT' && body.kcExemptAdultConfirmed !== true) {
      throw new ApiException('KC_EXEMPT_CONFIRMATION_REQUIRED', {
        details: { leafCategoryId: leaf.categoryId },
      });
    }
    this.guard.assertMutable(candidate);

    const selection = selectionWriteOf({
      leaf,
      exceptionalCategories: await exceptionalCategoriesRaw(this.cache, leaf),
      decision: judged.decision,
      certificationExcludeContent:
        judged.decision === 'KC_EXEMPT' ? { ...judged.certificationExcludeContent } : null,
      now: scope.now,
    });
    const stepsBefore = await stepStatuses(scope.tx, candidateId);
    const output: CategoryOutput = { kind: 'CATEGORY_SELECTED', selection };
    const closed = await this.api.resumeWaiting(run.id, {
      scope,
      outcome: {
        kind: 'COMPLETED',
        output,
        candidateEffects: {
          leafCategory: {
            leafCategoryId: selection.leafCategoryId,
            wholeCategoryName: selection.wholeCategoryName,
          },
        },
      },
    });
    await this.audit.record(
      {
        eventType: 'CATEGORY_DECISION',
        candidateId,
        stepRunId: run.id,
        stepCode: 'CATEGORY',
        detail: {
          decision: selection.exceptionDecision,
          leafCategoryId: selection.leafCategoryId,
          wholeCategoryName: selection.wholeCategoryName,
          candidateSource: decision.candidateSource,
          ...(selection.exceptionDecision === 'KC_EXEMPT' ? { kcExemptAdultConfirmed: true } : {}),
        },
        occurredAt: scope.now,
      },
      scope.tx,
    );
    const stepsAfter = await stepStatuses(scope.tx, candidateId);
    const staleDownstreamSteps = [...stepsAfter.entries()]
      .filter(
        ([code, status]) =>
          code !== 'CATEGORY' &&
          status === 'RERUN_REQUIRED' &&
          stepsBefore.get(code) !== 'RERUN_REQUIRED',
      )
      .map(([code]) => code);
    return {
      categoryDecisionId: decision.id,
      stepRunId: run.id,
      candidateId,
      stepStatus: closed.status as CategorySelectionResultDto['stepStatus'],
      leafCategoryId: selection.leafCategoryId,
      wholeCategoryName: selection.wholeCategoryName,
      exceptionDecision: selection.exceptionDecision,
      kcExemptAdultConfirmedAt: selection.kcExemptAdultConfirmedAt?.toISOString() ?? null,
      decidedAt: selection.decidedAt.toISOString(),
      staleDownstreamSteps,
    };
  }

  /** 차단 판단 감사 기록(규칙 13 — 되돌린 트랜잭션 밖). 실패해도 409 응답은 그대로 준다 */
  private async recordBlocked(error: CategoryBlockedError): Promise<void> {
    try {
      await this.audit.record({
        eventType: 'CATEGORY_DECISION',
        candidateId: error.audit.candidateId,
        stepRunId: error.audit.stepRunId,
        stepCode: 'CATEGORY',
        detail: {
          decision: 'BLOCKED',
          leafCategoryId: error.audit.leafCategoryId,
          wholeCategoryName: error.audit.wholeCategoryName,
          blockReason: error.audit.blockReason,
          reason: error.audit.reason,
        },
        occurredAt: this.transactions.now(),
      });
    } catch (e) {
      this.logger.error({ err: e }, '카테고리 차단 판단을 감사 기록에 남기지 못했습니다');
    }
  }
}

async function stepStatuses(tx: Tx, candidateId: number): Promise<Map<StepCode, string>> {
  const rows = await tx.candidateStep.findMany({
    where: { candidateId },
    select: { stepCode: true, status: true },
  });
  return new Map(rows.map((r) => [r.stepCode as StepCode, r.status]));
}

function toDetailDto(
  decision: CategoryDecision,
  run: StepRun,
  isCurrent: boolean,
  options: CategoryOptionView[],
): CategoryDecisionDetailDto {
  return {
    id: decision.id,
    stepRunId: run.id,
    candidateId: run.candidateId,
    version: run.version,
    stepStatus: run.status as CategoryDecisionDetailDto['stepStatus'],
    isCurrent,
    inputGenreId: decision.inputGenreId,
    inputProductType: decision.inputProductType,
    gender: decision.gender as CategoryDecisionDetailDto['gender'],
    genderChangedInRun: decision.genderChangedInRun,
    candidateSource: decision.candidateSource as CategoryDecisionDetailDto['candidateSource'],
    categoryOptions: options,
    leafCategoryId: decision.leafCategoryId,
    wholeCategoryName: decision.wholeCategoryName,
    genderPathMatch: decision.genderPathMatch,
    exceptionalCategories: decision.exceptionalCategories ?? null,
    exceptionDecision: decision.exceptionDecision as CategoryDecisionDetailDto['exceptionDecision'],
    blockReason: decision.blockReason,
    kcExemptAdultConfirmedAt: decision.kcExemptAdultConfirmedAt?.toISOString() ?? null,
    certificationExcludeContent: decision.certificationExcludeContent ?? null,
    decidedAt: decision.decidedAt?.toISOString() ?? null,
    createdAt: decision.createdAt.toISOString(),
    updatedAt: decision.updatedAt.toISOString(),
  };
}
