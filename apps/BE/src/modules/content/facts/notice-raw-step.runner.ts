import { Injectable } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AiExecutor } from '../../integrations/ai-engine/ai-executor.service.js';
import {
  StepRunnerFor,
  type CandidateEffects,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepPersistHooks,
  type StepRunContext,
  type StepRunner,
  type Tx,
} from '../../step-engine/contracts/step-runner.js';
import { normalizeText } from '../../step-engine/domain/fingerprint.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import {
  attributesInputValue,
  flattenAttributes,
  htmlToRawText,
  type ItemAttribute,
} from '../content-sources.js';
import {
  draftOf,
  fieldsOf,
  insertFields,
  latestVersionWithOutput,
  type FieldDraft,
} from '../fields/content-field.store.js';
import { buildFactDrafts, pendingFactInputs } from './fact-drafts.js';
import { FactOwnerEditHandler } from './fact-owner-edit.handler.js';
import { mergeFacts, missingFacts, type FactExtraction } from './fact.schema.js';
import { cautionDraft, cautionFromTemplates } from './caution.supplement.js';
import { colorKoDraft, colorKoFromDictionary } from './color-ko.resolver.js';
import {
  buildFactPrompt,
  factAiSchema,
  factAiTask,
  interpretAiExtras,
  interpretAiFacts,
  type AiExtraField,
} from './extractors/ai-fact.extractor.js';
import { extractFromDescription } from './extractors/description-pattern.extractor.js';
import { extractFromAttributes } from './extractors/sku-attribute.extractor.js';
import { carryOwnerFacts } from './recheck.js';
import { SpecImageCollector, specImageUrlsOf, type SpecImage } from './spec-image.collector.js';

/** ⑥-2 입력 대기 이유(원산지 미확정 — 규칙 12) */
export const NOTICE_RAW_WAITING_REASON = 'NOTICE_RAW_ORIGIN_REQUIRED';

/** ⑥-2 머리 행 값(content_draft_fact) */
export interface FactHead {
  sourceItemCode: string;
  sourcePageUrl: string;
  selectedColorRaw: string | null;
}

/** ⑥-2 실행 결과(입력 대기·완료 공통 — 엔진은 해석하지 않고 `persist`에 넘긴다) */
export interface NoticeRawFactsOutput {
  kind: 'NOTICE_RAW_FACTS';
  candidateId: number;
  head: FactHead;
  fields: FieldDraft[];
  /** 이번 버전에서 새로 '재확인 필요'를 붙인 필드(SSE content-field.recheck-flagged) */
  flagged: string[];
}

export function isNoticeRawFactsOutput(value: unknown): value is NoticeRawFactsOutput {
  return (value as { kind?: unknown } | null)?.kind === 'NOTICE_RAW_FACTS';
}

/** 입력 대기를 오너 입력으로 끝낼 때의 결과(산출물은 이미 있다) */
export const NOTICE_RAW_INPUT_DONE = { kind: 'NOTICE_RAW_INPUT_DONE' } as const;

/**
 * ⑥-2 NOTICE_RAW 실행기(P3-03 §5.1 `facts/notice-raw-step.runner.ts`, F-CT-09~15, 규칙 9~12·14·15).
 * - 시작 조건(규칙 9): ② 소싱 선택 itemCode, 속성·설명 글·스펙 이미지(주소)·선택 색상 원문 + 나라 사전·소재 말·항목 이름·스펙 이미지
 *   고르기 설정. AI 단계다(선택 엔진 사용 가능 판정·`step_run.ai_*` 시작 때 고정 — 규칙으로 끝나 AI를 부르지 않아도 기록한다,
 *   P3-03 주의 Proposed)
 * - 추출(규칙 9·11): SKU 속성 → 설명문 패턴 → AI(글 + 설명 속 스펙표 이미지 OCR, 못 찾은 필드만) → 없음. 앞 순위를 뒤가 덮지 않는다.
 *   AI는 못 찾은 필드가 있을 때만 부른다. 이미지를 넘기면 비전(`images_seen` 검사 — 규칙 15), 없으면 텍스트
 * - 값(규칙 10): 한국어 정리(설정 사전 — Proposed), 필드마다 원문 발췌·출처 URL·방법·basis itemCode(+ OCR 이미지 id)
 * - 다시 실행(규칙 14): 이전 버전의 오너 입력 사실 필드를 가져가고 itemCode가 바뀌었으면 `ITEM_CODE_CHANGED` + SSE
 * - 원산지를 확정하지 못하면 입력 대기(`NOTICE_RAW_ORIGIN_REQUIRED`, pending `fact.origin` — 규칙 12). 오너 입력은
 *   `PUT /step-runs/{id}/content-fields/fact.origin`(`ContentFieldsService`)
 * - P3-04(F-CT-17·21): 색상 한국어 표기(`fact.color_ko` — 사전 → 사전에 없으면 같은 AI 호출에서 보조)와 소재별 주의 문구
 *   (`fact.caution` — 템플릿 + AI를 부를 때 보완 한 문장)를 더해 버전마다 일곱 행을 둔다. 둘 다 입력 대기 사유가 아니다
 */
@StepRunnerFor('NOTICE_RAW')
@Injectable()
export class NoticeRawStepRunner implements StepRunner {
  readonly stepCode = 'NOTICE_RAW' as const;
  readonly usesAi = true;
  readonly aiModelKind = 'VISION' as const;

  constructor(
    private readonly api: StepEngineApi,
    private readonly ai: AiExecutor,
    private readonly specImages: SpecImageCollector,
    private readonly edits: FactOwnerEditHandler,
    private readonly events: ProgressEventsService,
    private readonly prisma: PrismaService,
  ) {}

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const sourcingRunId = ctx.completedRunId('SOURCING');
    const content =
      sourcingRunId !== null ? await this.api.readSourcingItemContent(sourcingRunId, ctx.db) : null;
    const settings = ctx.settings.content;
    const prev = (inputKey: string, value: unknown): StepInput => ({
      inputKey,
      sourceType: 'PREV_STEP',
      sourceStepRunId: sourcingRunId,
      isStartCondition: true,
      required: true,
      value,
    });
    const setting = (inputKey: string, value: unknown): StepInput => ({
      inputKey,
      sourceType: 'SETTINGS',
      isStartCondition: true,
      required: true,
      value,
    });
    return [
      prev(INPUT_KEYS.sourcingSelection, content ? content.itemCode : null),
      prev(
        INPUT_KEYS.sourcingAttributes,
        content
          ? {
              attributes: attributesInputValue(
                flattenAttributes(content.itemAttributes, content.skuAttributes),
              ),
              descriptionText: normalizeText(content.descriptionText ?? ''),
              specImageUrls: specImageUrlsOf(content.descriptionHtml, settings.specImages.maxCount),
            }
          : null,
      ),
      // 선택 색상 원문은 없을 수 있다(색상 라벨 없는 URL 후보) — 필수 값은 빈 글로 둔다
      prev(INPUT_KEYS.sourcingSelectedColor, content ? (content.selectedColorRaw ?? '') : null),
      setting(INPUT_KEYS.settingsContentOriginCountries, settings.originCountries),
      setting(INPUT_KEYS.settingsContentMaterialTerms, settings.materialTerms),
      setting(INPUT_KEYS.settingsContentFactLabels, settings.factLabels),
      setting(INPUT_KEYS.settingsContentSpecImages, settings.specImages),
      // P3-04: 색상 한국어 표기 사전·소재별 주의 문구 템플릿
      setting(INPUT_KEYS.settingsContentColorTerms, settings.colorTerms),
      setting(INPUT_KEYS.settingsContentCautionTemplates, settings.cautionTemplates),
    ];
  }

  async run(ctx: StepRunContext): Promise<StepOutcome> {
    const sourcing = await this.api.currentCompletedRun(ctx.candidateId, 'SOURCING');
    const content = sourcing ? await this.api.readSourcingItemContent(sourcing.id) : null;
    if (!content) {
      return {
        kind: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'SOURCING_SELECTION_REQUIRED',
        errorMessage: '② 소싱 선택 상품을 찾지 못했습니다. ②를 확인한 뒤 ⑥-2를 다시 실행해 주세요.',
      };
    }
    const settings = ctx.settings.content;
    const attributes = flattenAttributes(content.itemAttributes, content.skuAttributes);
    const rawText = content.descriptionHtml
      ? htmlToRawText(content.descriptionHtml)
      : (content.descriptionText ?? '');
    let extraction = mergeFacts(
      extractFromAttributes(attributes, settings.factLabels),
      extractFromDescription(rawText, settings.factLabels),
    );
    let images: SpecImage[] = [];
    let extras: Partial<Record<AiExtraField, { value: string; quote: string }>> = {};
    const missing = missingFacts(extraction);
    // P3-04 규칙 6: 색상은 사전 먼저, 사전에 없으면 같은 AI 호출에서 보조한다. 주의 문구 보완은 AI를 부를 때만 묶는다
    const colorByDictionary = colorKoFromDictionary(content.selectedColorRaw, settings.colorTerms);
    const extraNames: AiExtraField[] =
      colorByDictionary === null && content.selectedColorRaw?.trim() ? ['color_ko'] : [];
    if (missing.length > 0 || extraNames.length > 0) {
      const found = await this.extractWithAi(ctx, content, attributes, rawText, missing, [
        ...extraNames,
        'caution',
      ]);
      images = found.images;
      extras = found.extras;
      extraction = mergeFacts(extraction, found.extraction);
    }
    const built = buildFactDrafts({
      extraction,
      settings,
      itemCode: content.itemCode,
      itemUrl: content.itemUrl,
      imageAssetIds: images.map((image) => image.imageAssetId),
    });
    const { unresolvedOrigins } = built;
    const materialOf = (key: string) => {
      const value = built.drafts.find((d) => d.fieldKey === key)?.value;
      return typeof value === 'string' ? value : null;
    };
    const drafts = [
      ...built.drafts,
      colorKoDraft({
        selectedColorRaw: content.selectedColorRaw,
        dictionaryValue: colorByDictionary,
        ai: extras.color_ko ?? null,
        itemCode: content.itemCode,
        itemUrl: content.itemUrl,
      }),
      cautionDraft({
        templateText: cautionFromTemplates(
          ['fact.material_upper', 'fact.material_lining', 'fact.material_sole'].map(materialOf),
          settings.cautionTemplates,
        ),
        supplement: extras.caution ?? null,
        itemCode: content.itemCode,
        itemUrl: content.itemUrl,
      }),
    ];
    const previousId = await this.previousFactsRunId(ctx);
    const previous = previousId !== null ? await this.previousFields(previousId) : [];
    const carried = carryOwnerFacts(previous, drafts, content.itemCode);
    const output: NoticeRawFactsOutput = {
      kind: 'NOTICE_RAW_FACTS',
      candidateId: ctx.candidateId,
      head: {
        sourceItemCode: content.itemCode,
        sourcePageUrl: content.itemUrl,
        selectedColorRaw: content.selectedColorRaw,
      },
      fields: carried.drafts,
      flagged: carried.flagged,
    };
    const pending = pendingFactInputs(carried.drafts, unresolvedOrigins);
    if (pending.length > 0) {
      return {
        kind: 'WAITING_INPUT',
        waitingReasonCode: NOTICE_RAW_WAITING_REASON,
        pendingInputs: pending,
        output,
      };
    }
    return { kind: 'COMPLETED', output };
  }

  /**
   * 3순위 AI(규칙 9-3·15): 스펙 이미지를 받아(있으면) 못 찾은 필드만 묻는다. P3-04: 같은 호출에 색상 표기 보조(사전에 없을 때)·
   * 주의 문구 보완(`extras`)을 묶는다
   */
  private async extractWithAi(
    ctx: StepRunContext,
    content: NonNullable<Awaited<ReturnType<StepEngineApi['readSourcingItemContent']>>>,
    attributes: readonly ItemAttribute[],
    rawText: string,
    missing: ReturnType<typeof missingFacts>,
    extraNames: readonly AiExtraField[],
  ): Promise<{
    extraction: FactExtraction;
    images: SpecImage[];
    extras: Partial<Record<AiExtraField, { value: string; quote: string }>>;
  }> {
    if (!ctx.pinnedAi) throw new Error('⑥-2는 AI 단계인데 고정한 AI 문맥이 없습니다');
    const settings = ctx.settings.content;
    const urls = specImageUrlsOf(content.descriptionHtml, settings.specImages.maxCount);
    const images =
      urls.length > 0
        ? await this.specImages.collect(
            {
              itemCode: content.itemCode,
              shopCode: content.itemCode.split(':')[0] ?? null,
              urls,
              maxBytes: settings.specImages.maxBytes,
            },
            { candidateId: ctx.candidateId, stepRunId: ctx.stepRunId },
          )
        : [];
    const names = [...missing, ...extraNames];
    const input = buildFactPrompt({
      names,
      itemName: content.itemName,
      descriptionText: content.descriptionText,
      attributes,
      imageCount: images.length,
      selectedColorRaw: content.selectedColorRaw,
    });
    const result = await this.ai.run(
      ctx.pinnedAi,
      factAiTask(images.length > 0),
      factAiSchema(names),
      images.length > 0 ? { ...input, imagePaths: images.map((image) => image.filePath) } : input,
    );
    const knownText = [
      content.itemName,
      rawText,
      content.descriptionText ?? '',
      content.selectedColorRaw ?? '',
      ...attributes.map((a) => `${a.name}:${a.text}`),
    ].join('\n');
    const extraction = interpretAiFacts(result.output, {
      names: missing,
      imageCount: images.length,
      imagesSeen: result.imagesSeen,
      knownText,
    });
    const extras = interpretAiExtras(result.output, {
      names: extraNames,
      knownText,
      imageCount: images.length,
    });
    return { extraction, images, extras };
  }

  /** 이전 버전(닫혀 동결된 행 — 트랜잭션 밖에서 읽어도 바뀌지 않는다) */
  private previousFactsRunId(ctx: StepRunContext): Promise<number | null> {
    return latestVersionWithOutput(this.prisma, ctx.candidateId, 'NOTICE_RAW', ctx.version);
  }

  private async previousFields(stepRunId: number): Promise<FieldDraft[]> {
    return (await fieldsOf(this.prisma, stepRunId)).map(draftOf);
  }

  /**
   * 끝 트랜잭션: 머리 행 + 사실 필드 다섯 행을 쓴다(입력 대기로 멈출 때 처음 쓰고, 오너 입력으로 끝낼 때는 다시 쓰지 않는다).
   * 새로 '재확인 필요'를 붙인 필드가 있으면 커밋 뒤 SSE `content-field.recheck-flagged`(1건)
   */
  async persist(
    tx: Tx,
    stepRunId: number,
    outcome: StepOutcome,
    hooks?: StepPersistHooks,
  ): Promise<void> {
    if (outcome.kind === 'FAILED' || !isNoticeRawFactsOutput(outcome.output)) return;
    const output = outcome.output;
    const exists = await tx.contentDraftFact.findUnique({ where: { stepRunId } });
    if (exists) return;
    await tx.contentDraftFact.create({
      data: {
        stepRunId,
        sourceItemCode: output.head.sourceItemCode,
        sourcePageUrl: output.head.sourcePageUrl,
        selectedColorRaw: output.head.selectedColorRaw?.slice(0, 128) ?? null,
      },
    });
    await insertFields(tx, stepRunId, output.fields);
    if (output.flagged.length > 0 && hooks) {
      const data = {
        candidateId: output.candidateId,
        stepCode: 'NOTICE_RAW' as const,
        stepRunId,
        fieldKeys: [...output.flagged],
        recheckReason: 'ITEM_CODE_CHANGED' as const,
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
}
