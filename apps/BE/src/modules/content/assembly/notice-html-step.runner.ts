import { Injectable } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  profileStepInputs,
  PROFILE_FIELDS_BY_STEP,
  profileInputKey,
} from '../../settings/purchase-agency-profile/profile-input-keys.js';
import {
  emptyProfileValues,
  type PurchaseAgencyProfileValues,
} from '../../settings/purchase-agency-profile/profile-values.js';
import { PurchaseAgencyProfileService } from '../../settings/purchase-agency-profile/purchase-agency-profile.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import {
  StepRunnerFor,
  type CandidateEffects,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepPersistHooks,
  type StepRunContext,
  type StepRunner,
  type StepStartContext,
  type Tx,
} from '../../step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import type { CandidateWarning } from '../../step-engine/domain/warnings.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { isCopyDraft } from '../copy/copy.schema.js';
import {
  draftOf,
  fieldsOf,
  insertFields,
  latestVersionWithOutput,
  type FieldDraft,
} from '../fields/content-field.store.js';
import type { RecheckReason } from '../fields/field-keys.js';
import { AssemblyOwnerEditHandler } from './assembly-owner-edit.handler.js';
import {
  materialBasisSha256,
  originBasisSha256,
  sizeBasisSha256,
  type AssemblyFacts,
} from './assembly-facts.js';
import { carryAssemblyFields, overridesOf } from './assembly-fields.js';
import {
  assemblyMissingFields,
  assemblyProfileOf,
  keywordOf,
  modelInfoOf,
  profileIncomplete,
  readAssemblyFacts,
  readCopyDoc,
  type SourcingModelInfo,
} from './assembly-sources.js';
import { findAssembly, insertAssembly } from './assembly.store.js';
import { assemble, type AssemblyRow } from './assemble.js';
import { DisclosureTemplateError } from './disclosure/disclosure-renderer.js';
import { OriginCodeResolver, planOriginArea } from './notice/origin-code.resolver.js';
import { productNameWarnings } from './product-name/product-name.warnings.js';

/** ⑥-3 실행 결과(엔진은 해석하지 않고 `persist`에 넘긴다) */
export interface NoticeHtmlOutput {
  kind: 'NOTICE_HTML_ASSEMBLY';
  candidateId: number;
  row: AssemblyRow;
  /** 가져온 오너 입력 행(notice.*·product_name) */
  fields: FieldDraft[];
  /** 이번 버전에서 새로 '재확인 필요'를 붙인 키(사유별 — SSE content-field.recheck-flagged) */
  flagged: Partial<Record<RecheckReason, string[]>>;
}

export function isNoticeHtmlOutput(value: unknown): value is NoticeHtmlOutput {
  return (value as { kind?: unknown } | null)?.kind === 'NOTICE_HTML_ASSEMBLY';
}

function failed(errorCode: string, errorMessage: string): StepOutcome {
  return { kind: 'FAILED', failureKind: 'INPUT_VALIDATION', errorCode, errorMessage };
}

function inputValue(ctx: StepRunContext, key: string): unknown {
  return ctx.inputs.find((input) => input.inputKey === key)?.value ?? null;
}

/** 입력 값 → 프로필 값(시작 때 읽은 `profile.*`) */
function profileFromInputs(ctx: StepRunContext): PurchaseAgencyProfileValues {
  const values = emptyProfileValues() as unknown as Record<string, unknown>;
  for (const field of PROFILE_FIELDS_BY_STEP.NOTICE_HTML) {
    const found = ctx.inputs.find((input) => input.inputKey === profileInputKey(field));
    if (found) values[field] = found.value;
  }
  return values as unknown as PurchaseAgencyProfileValues;
}

function isSizes(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((v) => Number.isInteger(v));
}

function isFacts(value: unknown): value is AssemblyFacts {
  const v = value as Partial<AssemblyFacts> | null;
  return !!v && Array.isArray(v.origin) && !!v.materials && typeof v.materials === 'object';
}

/**
 * ⑥-3 NOTICE_HTML 실행기(P3-04 §5.1, F-CT-01~04·16~34, 규칙 1~15). AI를 쓰지 않는다(`usesAi=false` — `step_run.ai_*` NULL,
 * AI_ENGINE_UNAVAILABLE로 막지 않는다). G3 선택은 읽지 않는다.
 * - 시작 조건(규칙 1): ⑥-1 카피(`copy.draft`), ⑥-2 결과(`noticeRaw.facts`), ③ 판매 사이즈(`pricing.saleSizes` — step-engine
 *   창구), ② 모델명·並行輸入品·브랜드 속성(`sourcing.modelInfo`), 후보 성별, (선택) ④ 리프 경로·앵커 키·① 키워드, 고지 설정
 *   (`settings.notice`)·나라 사전·여러 원산지 방식, 프로필(`profile.*` — P1-09 `profileStepInputs`)
 * - 시작 전(규칙 2): 프로필 상호·A/S 연락처·A/S 안내·수입자(+ 반품비·설정 배송기간 — Proposed)가 비면 409 PROFILE_INCOMPLETE
 *   (`details.missingFields`)
 * - 실행: 원산지 코드(원산지 캐시 — 못 찾으면 FAILED `COMMERCE_META_NOT_SYNCED`) → 이전 버전 오너 입력 가져오기(재확인 필요) →
 *   조립(`assemble` — 고시·사양 블록·고지·HTML·상품명)
 * - 끝(`persist`): `content_draft_assembly` + 오너 입력 행. 새로 재확인 필요를 붙였으면 커밋 뒤 SSE `content-field.recheck-flagged`
 * - 오너 수정(`copyOutput` → `AssemblyOwnerEditHandler`): EDIT notice.*·product_name·원산지 코드, RESTORE_VERSION
 */
@StepRunnerFor('NOTICE_HTML')
@Injectable()
export class NoticeHtmlStepRunner implements StepRunner {
  readonly stepCode = 'NOTICE_HTML' as const;
  readonly usesAi = false;

  constructor(
    private readonly api: StepEngineApi,
    private readonly profiles: PurchaseAgencyProfileService,
    private readonly settings: SettingsService,
    private readonly origins: OriginCodeResolver,
    private readonly edits: AssemblyOwnerEditHandler,
    private readonly events: ProgressEventsService,
    private readonly prisma: PrismaService,
  ) {}

  async beforeStart(ctx: StepStartContext): Promise<void> {
    const missing = assemblyMissingFields(
      await this.profiles.currentValues(ctx.db),
      ctx.settings.notice,
    );
    if (missing.length > 0) throw profileIncomplete(missing);
  }

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const copyRunId = ctx.completedRunId('COPY');
    const factRunId = ctx.completedRunId('NOTICE_RAW');
    const pricingRunId = ctx.completedRunId('PRICING');
    const sourcingRunId = ctx.completedRunId('SOURCING');
    const categoryRunId = ctx.completedRunId('CATEGORY');
    const copy = copyRunId !== null ? await readCopyDoc(ctx.db, copyRunId) : null;
    const facts = factRunId !== null ? await readAssemblyFacts(ctx.db, factRunId) : null;
    const sizes =
      pricingRunId !== null ? await this.api.readPricingSaleSizes(pricingRunId, ctx.db) : null;
    const content =
      sourcingRunId !== null ? await this.api.readSourcingItemContent(sourcingRunId, ctx.db) : null;
    const candidate = ctx.candidate;
    const prev = (
      inputKey: string,
      sourceStepRunId: number | null,
      value: unknown,
      required = true,
    ): StepInput => ({
      inputKey,
      sourceType: 'PREV_STEP',
      sourceStepRunId,
      isStartCondition: true,
      required,
      value,
    });
    const setting = (inputKey: string, value: unknown): StepInput => ({
      inputKey,
      sourceType: 'SETTINGS',
      isStartCondition: true,
      required: true,
      value,
    });
    const genderInput: StepInput =
      candidate.genderSource === 'STEP2' && sourcingRunId !== null
        ? prev(INPUT_KEYS.candidateGender, sourcingRunId, candidate.gender)
        : {
            inputKey: INPUT_KEYS.candidateGender,
            sourceType: 'OWNER_INPUT',
            isStartCondition: true,
            required: true,
            value: candidate.gender,
          };
    const anchor = {
      modelCode: candidate.anchorModelCode,
      itemCode: candidate.anchorItemCode,
      colorCode: candidate.anchorColorCode,
    };
    const hasAnchor = anchor.modelCode !== null || anchor.itemCode !== null;
    const keyword = await keywordOf(ctx.db, candidate.sourceKeywordId);
    const profile = await this.profiles.currentValues(ctx.db);
    return [
      prev(INPUT_KEYS.copyDraft, copyRunId, copy),
      prev(INPUT_KEYS.noticeRawFacts, factRunId, facts),
      prev(INPUT_KEYS.pricingSaleSizes, pricingRunId, sizes ? sizes.saleSizesMm : null),
      prev(INPUT_KEYS.sourcingModelInfo, sourcingRunId, content ? modelInfoOf(content) : null),
      // ④ 리프 경로는 선택 입력(P1-05 — 상품명 상품유형). ④ 완료일 때만 후보 리프 경로를 읽는다
      prev(
        INPUT_KEYS.categoryLeafPath,
        categoryRunId,
        categoryRunId !== null ? candidate.wholeCategoryName : null,
        false,
      ),
      genderInput,
      hasAnchor && sourcingRunId !== null
        ? prev(INPUT_KEYS.candidateAnchorKey, sourcingRunId, anchor, false)
        : {
            inputKey: INPUT_KEYS.candidateAnchorKey,
            sourceType: 'OWNER_INPUT',
            isStartCondition: true,
            required: false,
            value: hasAnchor ? anchor : null,
          },
      {
        inputKey: INPUT_KEYS.candidateSeedKeyword,
        sourceType: 'OWNER_INPUT',
        isStartCondition: true,
        required: false,
        value: keyword,
      },
      setting(INPUT_KEYS.settingsNotice, ctx.settings.notice),
      setting(INPUT_KEYS.settingsContentOriginCountries, ctx.settings.content.originCountries),
      setting(INPUT_KEYS.settingsContentMultiOriginMode, ctx.settings.content.multiOriginMode),
      ...profileStepInputs('NOTICE_HTML', profile),
    ];
  }

  async run(ctx: StepRunContext): Promise<StepOutcome> {
    const copy = inputValue(ctx, INPUT_KEYS.copyDraft);
    const facts = inputValue(ctx, INPUT_KEYS.noticeRawFacts);
    const sizes = inputValue(ctx, INPUT_KEYS.pricingSaleSizes);
    const modelInfo = inputValue(ctx, INPUT_KEYS.sourcingModelInfo) as SourcingModelInfo | null;
    const gender = inputValue(ctx, INPUT_KEYS.candidateGender);
    if (!isCopyDraft(copy) || !isFacts(facts) || !isSizes(sizes) || !modelInfo) {
      return failed(
        'STEP_START_CONDITION_UNMET',
        '⑥-1 카피·⑥-2 원산지·소재·③ 판매 사이즈를 읽지 못했습니다. 앞 단계를 확인한 뒤 ⑥-3을 다시 실행해 주세요.',
      );
    }
    if (gender !== 'MALE' && gender !== 'FEMALE') {
      return failed('GENDER_REQUIRED', '여정 성별이 없어 고시를 만들 수 없습니다.');
    }
    const settings = ctx.settings;
    const profile = assemblyProfileOf(profileFromInputs(ctx));
    const deliveryDaysMin = settings.notice.values.deliveryDaysMin;
    const deliveryDaysMax = settings.notice.values.deliveryDaysMax;
    if (!profile || deliveryDaysMin === null || deliveryDaysMax === null) {
      const missing = assemblyMissingFields(profileFromInputs(ctx), settings.notice);
      return failed('PROFILE_INCOMPLETE', profileIncomplete(missing).message);
    }
    const origin = await planOriginArea(facts.origin, settings.content, this.origins.lookup);
    if (!origin.ok) {
      return failed(
        'COMMERCE_META_NOT_SYNCED',
        origin.country
          ? `원산지 코드 목록에서 '${origin.country}'를 찾지 못했습니다. 시스템 상태에서 메타데이터를 동기화한 뒤 ⑥-3을 다시 실행해 주세요.`
          : '⑥-2 원산지가 비어 있어 원산지 코드를 정할 수 없습니다.',
      );
    }
    const previousId = await latestVersionWithOutput(
      this.prisma,
      ctx.candidateId,
      'NOTICE_HTML',
      ctx.version,
    );
    const previous =
      previousId !== null ? (await fieldsOf(this.prisma, previousId)).map(draftOf) : [];
    const leafPath = inputValue(ctx, INPUT_KEYS.categoryLeafPath);
    const keyword = inputValue(ctx, INPUT_KEYS.candidateSeedKeyword);
    const anchor = inputValue(ctx, INPUT_KEYS.candidateAnchorKey) as { modelCode?: unknown } | null;
    const input = {
      copy,
      facts,
      sizes,
      gender,
      profile,
      notice: {
        ...settings.notice,
        values: {
          deliveryDaysMin,
          deliveryDaysMax,
          exchangePolicy: settings.notice.values.exchangePolicy,
        },
      },
      cautionFallback: settings.content.cautionTemplates.default,
      origin: origin.plan,
      naming: {
        keyword: typeof keyword === 'string' ? keyword : null,
        brandAttribute: modelInfo.brandAttribute,
        modelCode:
          modelInfo.modelCode ?? (typeof anchor?.modelCode === 'string' ? anchor.modelCode : null),
        wholeCategoryName: typeof leafPath === 'string' ? leafPath : null,
        parallelImport: modelInfo.parallelImport,
      },
    } as const;
    try {
      // 생성 값을 먼저 만들어 오너 행의 generated_value·재확인 근거를 정하고, 오너 값을 덮어 다시 조립한다
      const plain = assemble(input, { notice: {} });
      const carried = carryAssemblyFields(previous, plain.generated, {
        size: sizeBasisSha256(sizes),
        material: materialBasisSha256(facts),
        origin: originBasisSha256(facts),
      });
      const result = assemble(input, overridesOf(carried.drafts));
      const output: NoticeHtmlOutput = {
        kind: 'NOTICE_HTML_ASSEMBLY',
        candidateId: ctx.candidateId,
        row: result.row,
        fields: carried.drafts,
        flagged: carried.flagged,
      };
      return { kind: 'COMPLETED', output };
    } catch (error) {
      if (error instanceof DisclosureTemplateError) {
        return failed(
          'NOTICE_TEMPLATE_INVALID',
          `구매대행 고지 템플릿을 쓸 수 없습니다: ${error.message}`,
        );
      }
      throw error;
    }
  }

  /** 끝 트랜잭션: 조립 행 + 오너 입력 행. 새 재확인 표시는 커밋 뒤 SSE(사유마다 1건) */
  async persist(
    tx: Tx,
    stepRunId: number,
    outcome: StepOutcome,
    hooks?: StepPersistHooks,
  ): Promise<void> {
    if (outcome.kind !== 'COMPLETED' || !isNoticeHtmlOutput(outcome.output)) return;
    const output = outcome.output;
    if (await findAssembly(tx, stepRunId)) return;
    await insertAssembly(tx, stepRunId, output.row);
    await insertFields(tx, stepRunId, output.fields);
    if (!hooks) return;
    for (const [reason, fieldKeys] of Object.entries(output.flagged)) {
      if (!fieldKeys || fieldKeys.length === 0) continue;
      const data = {
        candidateId: output.candidateId,
        stepCode: 'NOTICE_HTML' as const,
        stepRunId,
        fieldKeys: [...fieldKeys],
        recheckReason: reason as RecheckReason,
      };
      hooks.afterCommit(() => {
        this.events.publish('content-field.recheck-flagged', data, {
          candidateId: output.candidateId,
        });
      });
    }
  }

  async copyOutput(
    tx: Tx,
    fromStepRunId: number,
    toStepRunId: number,
    edit?: unknown,
  ): Promise<CandidateEffects | void> {
    await this.edits.copy(tx, fromStepRunId, toStepRunId, edit);
  }

  /** 오너 수정 새 버전의 경고(상품명 100자 초과·금지 수식어·반복 — 막지 않는다, 규칙 14) */
  async editWarnings(db: Tx, stepRunId: number): Promise<CandidateWarning[]> {
    const row = await findAssembly(db, stepRunId);
    if (!row) return [];
    const banned = this.settings.currentOrNull()?.content.productNameBannedWords ?? [];
    return productNameWarnings(row.productName, banned);
  }
}
