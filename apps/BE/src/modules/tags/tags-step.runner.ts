import { Inject, Injectable } from '@nestjs/common';
import { SECRET_STORE, type SecretStore } from '../../common/secrets/secret-store.port.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import {
  COMMERCE_TAGS_PORT,
  type CommerceTagsPort,
} from '../integrations/naver-commerce/commerce-tags.port.js';
import {
  StepRunnerFor,
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
import { activeInputIds, competitorRowsOf } from './competitor-inputs/competitor-input.store.js';
import { evaluatePool } from './pipeline/evaluate.js';
import { resolveOwnBrand } from './pipeline/rule-filter.js';
import { selectFinal } from './pipeline/select-final.js';
import { applyEdits, buildTagPool, type RecommendGroup } from './pipeline/tag-pool.js';
import { editOfRow, insertTagSet, latestTagSetBefore, type TagSetDraft } from './tag-set.store.js';
import { TagsOwnerEditHandler } from './tags-owner-edit.handler.js';
import {
  assertCommerceKeys,
  externalFailure,
  inputFailure,
  isTagsOutput,
  ruleContextOf,
  type TagsOutput,
} from './tags-run.js';
import {
  brandAttributeOf,
  productTypeOf,
  recommendKeywordsOf,
  seedKeywordOf,
  selectedKeywordOf,
  tagsRunInputsOf,
  type TagsLeafPath,
  type TagsModelInfo,
} from './tags-sources.js';

/**
 * ⑦ TAGS 실행기(P3-05 §5.1 `tags-step.runner.ts`, F-TG-01·07~12·15, 규칙 1·2·7~12·14). tags 모듈 provider로 step-engine
 * 레지스트리에 등록된다(`@StepRunnerFor('TAGS')`). AI를 쓰지 않는다(`usesAi=false` — 관련성 AI 판정은 M1 꺼짐 고정).
 * - 시작 조건(규칙 1): 필수 = 시드 키워드(① 선택 키워드 → ② 검색어 → ② 型番 — Proposed), ② 모델명·상품유형(`sourcing.modelInfo`),
 *   후보 성별. 선택 = 활성 경쟁 태그 입력(`owner.competitorTags` — 입력 id 목록, 없으면 null 해시), ④ 리프 경로(④ 현재 버전이
 *   완료일 때만, 없으면 null 해시 → ④가 끝나면 ⑦이 재실행 필요). 설정 `tags.useWords`·`tags.rules`
 * - 시작 전(Proposed): 커머스API 키가 없으면 409 SECRET_NOT_CONFIGURED(실행을 만들지 않는다 — 표 A ⑦ 행에 더함)
 * - 실행: 추천 조회(키워드마다 recommend-tags, 메모리 캐시) → 직전 버전 편집 목록 다시 적용 → 정규화 → 규칙 필터 → restricted-tags
 *   1차 검증(설정 개수씩) → 선정(최대 10개) → `persist`가 `tag_set`·`tag_candidate`·`tag_owner_edit`·`tag_set_competitor_input`
 * - 오너 수정(TAGS EDIT 202·RESTORE_VERSION): `TagsOwnerEditHandler`
 * ⑤·⑥ 산출물은 읽지 않는다. 네이버쇼핑에는 요청하지 않는다(커머스API 포트만).
 */
@StepRunnerFor('TAGS')
@Injectable()
export class TagsStepRunner implements StepRunner {
  readonly stepCode = 'TAGS' as const;
  readonly usesAi = false;

  constructor(
    private readonly api: StepEngineApi,
    private readonly prisma: PrismaService,
    private readonly edits: TagsOwnerEditHandler,
    @Inject(COMMERCE_TAGS_PORT) private readonly tags: CommerceTagsPort,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async beforeStart(_ctx: StepStartContext): Promise<void> {
    await assertCommerceKeys(this.secrets);
  }

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const { candidate, settings } = ctx;
    const sourcingRunId = ctx.completedRunId('SOURCING');
    const categoryRunId = ctx.completedRunId('CATEGORY');
    const content =
      sourcingRunId !== null ? await this.api.readSourcingItemContent(sourcingRunId, ctx.db) : null;
    const genre =
      sourcingRunId !== null ? await this.api.readSourcingGenre(sourcingRunId, ctx.db) : null;
    const keyword = await selectedKeywordOf(ctx.db, candidate.sourceKeywordId);
    const modelCode = content?.modelCode?.trim() ? content.modelCode.trim() : null;
    const seed = seedKeywordOf(keyword, candidate.rakutenQuery, modelCode);
    const brandAttribute = content ? brandAttributeOf(content.itemAttributes) : null;
    const modelInfo: TagsModelInfo | null = content
      ? {
          modelCode,
          productType: genre?.productType?.trim() ? genre.productType.trim() : null,
          brand: resolveOwnBrand(
            [seed.value, brandAttribute, content.itemName],
            settings.tags.rules.brands,
          ),
        }
      : null;
    const leaf: TagsLeafPath | null =
      categoryRunId !== null && candidate.leafCategoryId !== null
        ? {
            leafCategoryId: candidate.leafCategoryId,
            wholeCategoryName: candidate.wholeCategoryName,
          }
        : null;
    const competitorIds = await activeInputIds(ctx.db, candidate.id);
    const genderInput: StepInput =
      candidate.genderSource === 'STEP2' && sourcingRunId !== null
        ? {
            inputKey: INPUT_KEYS.candidateGender,
            sourceType: 'PREV_STEP',
            sourceStepRunId: sourcingRunId,
            isStartCondition: true,
            required: true,
            value: candidate.gender,
          }
        : {
            inputKey: INPUT_KEYS.candidateGender,
            sourceType: 'OWNER_INPUT',
            isStartCondition: true,
            required: true,
            value: candidate.gender,
          };
    const seedInput: StepInput =
      seed.source === 'MODEL_CODE' && sourcingRunId !== null
        ? {
            inputKey: INPUT_KEYS.candidateSeedKeyword,
            sourceType: 'PREV_STEP',
            sourceStepRunId: sourcingRunId,
            isStartCondition: true,
            required: true,
            value: seed.value,
          }
        : {
            inputKey: INPUT_KEYS.candidateSeedKeyword,
            sourceType: 'OWNER_INPUT',
            isStartCondition: true,
            required: true,
            value: seed.value,
          };
    const setting = (inputKey: string, value: unknown): StepInput => ({
      inputKey,
      sourceType: 'SETTINGS',
      isStartCondition: true,
      required: true,
      value,
    });
    return [
      seedInput,
      {
        inputKey: INPUT_KEYS.sourcingModelInfo,
        sourceType: 'PREV_STEP',
        sourceStepRunId: sourcingRunId,
        isStartCondition: true,
        required: true,
        value: modelInfo,
      },
      genderInput,
      {
        inputKey: INPUT_KEYS.ownerCompetitorTags,
        sourceType: 'OWNER_INPUT',
        isStartCondition: true,
        required: false,
        value: competitorIds.length > 0 ? competitorIds : null,
      },
      {
        inputKey: INPUT_KEYS.categoryLeafPath,
        sourceType: 'PREV_STEP',
        sourceStepRunId: categoryRunId,
        isStartCondition: true,
        required: false,
        value: leaf,
      },
      setting(INPUT_KEYS.settingsTagsUseWords, settings.tags.useWords),
      setting(INPUT_KEYS.settingsTagsRules, settings.tags.rules),
    ];
  }

  async run(ctx: StepRunContext): Promise<StepOutcome> {
    if (ctx.ownerEdit) return this.edits.run(ctx, this.prisma);
    const inputs = tagsRunInputsOf(ctx.inputs);
    if (inputs.seed === null || inputs.modelInfo === null) {
      return inputFailure(
        'STEP_START_CONDITION_UNMET',
        '시드 키워드와 ② 모델명을 읽지 못했습니다. ② 소싱을 확인한 뒤 ⑦을 다시 실행해 주세요.',
      );
    }
    const settings = ctx.settings.tags;
    const keywords = recommendKeywordsOf([
      inputs.seed,
      inputs.modelInfo.modelCode,
      productTypeOf(inputs.modelInfo, inputs.leaf),
      ...settings.useWords,
    ]);
    const previous = await latestTagSetBefore(this.prisma, ctx.candidateId, ctx.version);
    const edits = previous ? previous.edits.map(editOfRow) : [];
    const call = { candidateId: ctx.candidateId, stepRunId: ctx.stepRunId };
    try {
      const groups: RecommendGroup[] = [];
      for (const keyword of keywords) {
        groups.push({
          keyword,
          tags: await this.tags.recommendTags(keyword, {
            ...call,
            cacheTtlMs: settings.recommendCacheMinutes * 60_000,
          }),
        });
      }
      const competitor = await competitorRowsOf(
        this.prisma,
        ctx.candidateId,
        inputs.competitorInputIds,
      );
      const applied = applyEdits(buildTagPool(groups, competitor), edits);
      const evaluated = await evaluatePool({
        pool: applied.pool,
        removedKeys: applied.removedKeys,
        ruleContext: ruleContextOf(inputs, ctx.settings),
        batchSize: settings.restrictedBatchSize,
        restricted: (batch) => this.tags.restrictedTags(batch, call),
      });
      const draft: TagSetDraft = {
        recommendKeywords: keywords,
        leafCategoryId: inputs.leaf?.leafCategoryId ?? null,
        restrictedCheckedAt: evaluated.calls > 0 ? this.clock.now().toISOString() : null,
        aiRelevanceEnabled: false,
        competitorInputIds: inputs.competitorInputIds,
        candidates: selectFinal(evaluated.judged, applied.addedKeys),
        edits,
      };
      const output: TagsOutput = { kind: 'TAG_SET', draft };
      return { kind: 'COMPLETED', output };
    } catch (error) {
      const failure = externalFailure(error);
      if (failure) return failure;
      throw error;
    }
  }

  async persist(tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void> {
    if (outcome.kind !== 'COMPLETED' || !isTagsOutput(outcome.output)) return;
    if (await tx.tagSet.findUnique({ where: { stepRunId }, select: { id: true } })) return;
    await insertTagSet(tx, stepRunId, outcome.output.draft);
  }

  checkOwnerEdit(db: Tx, baseStepRunId: number, edit: unknown): Promise<void> {
    return this.edits.check(db, baseStepRunId, edit);
  }

  async copyOutput(
    tx: Tx,
    fromStepRunId: number,
    toStepRunId: number,
    edit?: unknown,
  ): Promise<void> {
    await this.edits.copy(tx, fromStepRunId, toStepRunId, edit);
  }
}
