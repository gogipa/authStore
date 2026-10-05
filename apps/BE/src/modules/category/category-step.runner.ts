import { Inject, Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../common/audit/user-action-log.service.js';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import type { CategoryGender } from '../../common/rules/category-gender.js';
import { CommerceMetaCacheService } from '../integrations/commerce-meta/commerce-meta-cache.service.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import {
  StepRunnerFor,
  type CandidateEffects,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepRunContext,
  type StepRunner,
  type StepStartContext,
  type Tx,
} from '../step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import {
  CategoryDecisionRepository,
  type CategoryOptionsDraft,
  type CategorySelectionWrite,
} from './category-decision.repository.js';
import {
  CATEGORY_NO_SELECTABLE_MESSAGE,
  CATEGORY_NO_SELECTABLE_OPTION,
  CATEGORY_PENDING_INPUT,
  CATEGORY_WAITING_REASON,
  categoryWordRulesOf,
  exceptionalCategoriesRaw,
  leavesForOptions,
  optionViewOf,
  selectionWriteOf,
} from './category-sources.js';
import { categoryOptionsOf } from './rules/category-options.js';

/** ④ 입력 `sourcing.genre` 값(② 장르·상품유형) */
export interface CategoryGenreInput {
  genreId: number | null;
  genreIdPath: number[];
  productType: string | null;
}

/**
 * ④ 산출물(실행기 결과 `output`). 엔진은 해석하지 않고 `persist`에 그대로 넘긴다.
 * - `CATEGORY_OPTIONS`: 입력 대기 — 후보 목록만 쓴다
 * - `CATEGORY_AUTO`: 후보가 하나이고 막힘·KC가 없어 곧바로 완료(Proposed) — 후보 목록 + 고른 리프 + 감사 기록
 * - `CATEGORY_SELECTED`: 고르기 API(`PUT /category-decisions/{id}/selection`)가 입력 대기를 끝낸다 — 고른 리프만
 */
export type CategoryOutput =
  | { kind: 'CATEGORY_OPTIONS'; draft: CategoryOptionsDraft }
  | {
      kind: 'CATEGORY_AUTO';
      candidateId: number;
      draft: CategoryOptionsDraft;
      selection: CategorySelectionWrite;
    }
  | { kind: 'CATEGORY_SELECTED'; selection: CategorySelectionWrite };

export function isCategoryOutput(value: unknown): value is CategoryOutput {
  const kind = (value as { kind?: unknown } | null)?.kind;
  return kind === 'CATEGORY_OPTIONS' || kind === 'CATEGORY_AUTO' || kind === 'CATEGORY_SELECTED';
}

function genderOf(value: unknown): CategoryGender | null {
  return value === 'MALE' || value === 'FEMALE' ? value : null;
}

function genreOf(value: unknown): CategoryGenreInput {
  const v = (value ?? {}) as Partial<CategoryGenreInput>;
  return {
    genreId: typeof v.genreId === 'number' ? v.genreId : null,
    genreIdPath: Array.isArray(v.genreIdPath)
      ? v.genreIdPath.filter((n): n is number => Number.isInteger(n))
      : [],
    productType: typeof v.productType === 'string' ? v.productType : null,
  };
}

/** 메타 캐시가 비었다(규칙 2, 05-3 COMMERCE_META_NOT_SYNCED details.target=CATEGORY) */
export function categoryMetaNotSynced(): ApiException {
  return new ApiException('COMMERCE_META_NOT_SYNCED', {
    message: formatErrorMessage('COMMERCE_META_NOT_SYNCED', { '카테고리·원산지': '카테고리' }),
    details: { target: 'CATEGORY' },
  });
}

/**
 * ④ CATEGORY 실행기(P2-06 §5 `category-step.runner.ts`, F-CA-01·02·04·07·09, P1-05 실행기 규약). category 모듈 provider로
 * step-engine 레지스트리에 등록된다(`@StepRunnerFor('CATEGORY')`).
 * - 시작 조건(규칙 1): ② 현재 버전 완료 + 후보 성별(엔진이 `STEP_GRAPH`로 먼저 본다 — 없으면 409 STEP_START_CONDITION_UNMET).
 *   ② 장르·상품유형은 없어도 실행한다(URL 후보). ③ 완료는 필요 없다
 * - 메타 캐시(규칙 2): `commerce_category`가 비었으면 `beforeStart`가 409 COMMERCE_META_NOT_SYNCED. 카테고리 id는 캐시에서만 얻는다
 * - 입력: `sourcing.genre`(② 장르·상품유형 — step-engine 창구 `readSourcingGenre`로만 읽는다, sourcing import 없음),
 *   `candidate.gender`(② 자동이면 PREV_STEP, 오너면 OWNER_INPUT), 설정 매핑표·아동·제외 품목 카테고리 말
 * - 실행: 매핑표 + 리프 캐시 + 성별 → 후보(`categoryOptionsOf`). 고를 수 있는 후보가 없으면 실패(Proposed), 후보가 하나이고
 *   막힘·KC가 없으면 곧바로 완료(Proposed — 표 A '여럿·KC 확인 필요 → selection'), 아니면 입력 대기
 * - 산출물은 `persist`에서 `category_decision`에 쓴다. 완료의 후보 `leaf_category_id`·`whole_category_name`은 step-engine이
 *   후보 효과(`leafCategory`)로 같은 끝 트랜잭션에서 쓴다
 */
@StepRunnerFor('CATEGORY')
@Injectable()
export class CategoryStepRunner implements StepRunner {
  readonly stepCode = 'CATEGORY' as const;
  readonly usesAi = false;

  constructor(
    private readonly api: StepEngineApi,
    private readonly cache: CommerceMetaCacheService,
    private readonly decisions: CategoryDecisionRepository,
    private readonly audit: UserActionLogService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 규칙 2: 메타 캐시(사라지지 않은 카테고리)가 비었으면 409 COMMERCE_META_NOT_SYNCED — 실행을 만들지 않는다 */
  async beforeStart(_ctx: StepStartContext): Promise<void> {
    if (!(await this.cache.hasActiveCategories())) throw categoryMetaNotSynced();
  }

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const sourcingStepRunId = ctx.completedRunId('SOURCING');
    const genre =
      sourcingStepRunId !== null
        ? await this.api.readSourcingGenre(sourcingStepRunId, ctx.db)
        : null;
    const gender = genderOf(ctx.candidate.gender);
    const genderInput: StepInput =
      ctx.candidate.genderSource === 'STEP2' && sourcingStepRunId !== null
        ? {
            inputKey: INPUT_KEYS.candidateGender,
            sourceType: 'PREV_STEP',
            sourceStepRunId: sourcingStepRunId,
            isStartCondition: true,
            required: true,
            value: gender,
          }
        : {
            inputKey: INPUT_KEYS.candidateGender,
            sourceType: 'OWNER_INPUT',
            isStartCondition: true,
            required: true,
            value: gender,
          };
    return [
      {
        inputKey: INPUT_KEYS.sourcingGenre,
        sourceType: 'PREV_STEP',
        sourceStepRunId: sourcingStepRunId,
        isStartCondition: true,
        required: true,
        // 장르가 없는 URL 후보도 값은 있다(genreId null — 성별 경로 전체 목록)
        value: genre
          ? {
              genreId: genre.genreId,
              genreIdPath: genre.genreIdPath,
              productType: genre.productType,
            }
          : null,
      },
      genderInput,
      {
        inputKey: INPUT_KEYS.settingsCategoryLeafMapping,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.category.leafMapping,
      },
      {
        inputKey: INPUT_KEYS.settingsChildCategoryWords,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.safety.childCategoryWords,
      },
      {
        inputKey: INPUT_KEYS.settingsExcludedCategoryWords,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.safety.excludedCategoryWords,
      },
    ];
  }

  async run(ctx: StepRunContext): Promise<StepOutcome> {
    const gender = genderOf(
      ctx.inputs.find((i) => i.inputKey === INPUT_KEYS.candidateGender)?.value,
    );
    if (!gender) {
      return {
        kind: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'STEP_START_CONDITION_UNMET',
        errorMessage:
          '여정 성별이 없어 카테고리 후보를 뽑지 못했습니다. 성별을 넣고 다시 실행해 주세요.',
      };
    }
    const genre = genreOf(ctx.inputs.find((i) => i.inputKey === INPUT_KEYS.sourcingGenre)?.value);
    const rules = categoryWordRulesOf(ctx.settings);
    const leaves = await leavesForOptions(this.cache, {
      gender,
      genreIdPath: genre.genreIdPath,
      productType: genre.productType,
      settings: ctx.settings,
    });
    const result = categoryOptionsOf({
      gender,
      genreIdPath: genre.genreIdPath,
      productType: genre.productType,
      mapping: ctx.settings.category.leafMapping,
      leaves,
      childCategoryWords: rules.childCategoryWords,
    });
    const views = await this.cache.findCategories(result.options.map((o) => o.leafCategoryId));
    const byId = new Map(views.map((v) => [v.categoryId, v]));
    const optionViews = result.options.map((o) =>
      optionViewOf(o, byId.get(o.leafCategoryId) ?? null, rules, gender),
    );
    const selectable = optionViews.filter((o) => !o.blocked);
    if (selectable.length === 0) {
      return {
        kind: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: CATEGORY_NO_SELECTABLE_OPTION,
        errorMessage: CATEGORY_NO_SELECTABLE_MESSAGE,
      };
    }
    const draft: CategoryOptionsDraft = {
      inputGenreId: genre.genreId,
      inputProductType: genre.productType,
      gender,
      candidateSource: result.candidateSource,
      categoryOptions: result.options,
    };
    // 자동 완료(Proposed): 후보가 하나이고 그 후보가 막히지 않았고 KC 확인이 필요 없을 때
    const only = optionViews.length === 1 ? optionViews[0]! : null;
    const leaf = only ? byId.get(only.leafCategoryId) : undefined;
    if (only && leaf && !only.blocked && !only.kcExemptionRequired) {
      const selection = selectionWriteOf({
        leaf,
        exceptionalCategories: await exceptionalCategoriesRaw(this.cache, leaf),
        decision: 'PASS',
        certificationExcludeContent: null,
        now: this.clock.now(),
      });
      const output: CategoryOutput = {
        kind: 'CATEGORY_AUTO',
        candidateId: ctx.candidateId,
        draft,
        selection,
      };
      const effects: CandidateEffects = {
        leafCategory: {
          leafCategoryId: selection.leafCategoryId,
          wholeCategoryName: selection.wholeCategoryName,
        },
      };
      return { kind: 'COMPLETED', output, candidateEffects: effects };
    }
    const output: CategoryOutput = { kind: 'CATEGORY_OPTIONS', draft };
    return {
      kind: 'WAITING_INPUT',
      waitingReasonCode: CATEGORY_WAITING_REASON,
      pendingInputs: [CATEGORY_PENDING_INPUT],
      output,
    };
  }

  async persist(tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void> {
    if (outcome.kind === 'FAILED') return;
    const output = outcome.output;
    if (!isCategoryOutput(output)) return;
    if (output.kind === 'CATEGORY_OPTIONS') {
      await this.decisions.insertOptions(tx, stepRunId, output.draft);
      return;
    }
    if (output.kind === 'CATEGORY_AUTO') {
      await this.decisions.insertDecided(tx, stepRunId, output.draft, output.selection);
      // 판단 감사(규칙 13): 자동 확정도 통과(PASS)로 남긴다
      await this.audit.record(
        {
          eventType: 'CATEGORY_DECISION',
          candidateId: output.candidateId,
          stepRunId,
          stepCode: 'CATEGORY',
          detail: {
            decision: 'PASS',
            auto: true,
            leafCategoryId: output.selection.leafCategoryId,
            wholeCategoryName: output.selection.wholeCategoryName,
            candidateSource: output.draft.candidateSource,
          },
          occurredAt: output.selection.decidedAt,
        },
        tx,
      );
      return;
    }
    await this.decisions.applySelection(tx, stepRunId, output.selection);
  }

  /** 이전 버전 다시 고르기: 결정을 새 버전으로 복사하고, 고른 리프가 있으면 후보 리프도 그 값으로 */
  async copyOutput(
    tx: Tx,
    fromStepRunId: number,
    toStepRunId: number,
  ): Promise<CandidateEffects | void> {
    const copied = await this.decisions.copy(tx, fromStepRunId, toStepRunId);
    if (copied?.leafCategoryId && copied.wholeCategoryName) {
      return {
        leafCategory: {
          leafCategoryId: copied.leafCategoryId,
          wholeCategoryName: copied.wholeCategoryName,
        },
      };
    }
  }
}
