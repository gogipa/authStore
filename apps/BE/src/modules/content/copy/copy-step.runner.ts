import { Injectable, Logger } from '@nestjs/common';
import { isAiOutputInvalid } from '../../integrations/ai-engine/ai-engine.errors.js';
import { AiExecutor } from '../../integrations/ai-engine/ai-executor.service.js';
import type {
  AiExecutionResult,
  AiExecutorInput,
  PinnedAiContext,
} from '../../integrations/ai-engine/ai-executor.types.js';
import {
  StepRunnerFor,
  type CandidateEffects,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepRunContext,
  type StepRunner,
  type Tx,
} from '../../step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { attributesInputValue, flattenAttributes, itemTextInputValue } from '../content-sources.js';
import {
  draftOf,
  fieldsOf,
  insertFields,
  latestVersionWithOutput,
} from '../fields/content-field.store.js';
import { carryCopyFields, overlayCopy } from './copy-fields.js';
import { CopyOwnerEditHandler } from './copy-owner-edit.handler.js';
import { buildCopyPrompt, COPY_AI_TASK } from './copy.prompt.js';
import { COPY_SCHEMA, copyJson, type CopyDraft } from './copy.schema.js';

/** ⑥-1 실행 결과(엔진은 해석하지 않고 `persist`에 넘긴다) */
export interface CopyGeneratedOutput {
  kind: 'COPY_GENERATED';
  /** AI 원 결과(앱 재검증 통과본) */
  generatedCopy: CopyDraft;
}

export function isCopyGeneratedOutput(value: unknown): value is CopyGeneratedOutput {
  return (value as { kind?: unknown } | null)?.kind === 'COPY_GENERATED';
}

/** ⑥-1 AI 호출 최대 횟수(D-17: 첫 호출 + 결과 검증 실패 때 1회 다시 부르기) */
export const COPY_AI_MAX_ATTEMPTS = 2;

/**
 * ⑥-1 COPY 실행기(P3-03 §5.1 `copy/copy-step.runner.ts`, F-CT-05·06, P1-05 실행기 규약, P1-10 AI 실행기).
 * - 시작 조건(규칙 1): ② 현재 완료 버전의 상품명·설명 글(NFKC·공백 정리)과 SKU 속성뿐이다. ⑥-2를 읽지 않는다. AI 엔진·모델은
 *   입력 지문에 넣지 않는다(엔진이 `step_run.ai_*`로 시작 때 고정 — R9)
 * - 실행: 선택 엔진의 텍스트 모델로 `AiExecutor.run`(카피 스키마 — 규칙 2, 금지 규칙·데이터 블록 격리 프롬프트 — 규칙 3).
 *   어댑터를 직접 고르지 않는다. 결과가 앱 검증에서 떨어지면(`AI_OUTPUT_INVALID`) 같은 엔진·모델로 1회 바로 다시 부르고
 *   (D-17, `generate`), 두 번째도 떨어지면 그 오류를 던져 엔진이 FAILED(AI, `AI_OUTPUT_INVALID`)로 닫는다.
 *   실행 중 엔진을 쓸 수 없게 되면 FAILED(`AI_ENGINE_UNAVAILABLE`) — 다른 엔진으로 넘어가지 않는다(규칙 4)
 * - 저장(규칙 5·7): `content_draft_copy`(AI 원 결과 + 유효 카피) + 이전 버전의 오너 입력 필드(덮어쓰지 않고, AI 값이 다르면
 *   `choice_pending`)
 * - 오너 수정(규칙 6·8): `copyOutput` → `CopyOwnerEditHandler`
 * - ② 산출물은 step-engine 창구(`StepEngineApi.readSourcingItemContent`)로만 읽는다(sourcing import 없음)
 */
@StepRunnerFor('COPY')
@Injectable()
export class CopyStepRunner implements StepRunner {
  readonly stepCode = 'COPY' as const;
  readonly usesAi = true;
  readonly aiModelKind = 'TEXT' as const;
  private readonly logger = new Logger(CopyStepRunner.name);

  constructor(
    private readonly api: StepEngineApi,
    private readonly ai: AiExecutor,
    private readonly edits: CopyOwnerEditHandler,
  ) {}

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const sourcingRunId = ctx.completedRunId('SOURCING');
    const content =
      sourcingRunId !== null ? await this.api.readSourcingItemContent(sourcingRunId, ctx.db) : null;
    return [
      {
        inputKey: INPUT_KEYS.sourcingItemText,
        sourceType: 'PREV_STEP',
        sourceStepRunId: sourcingRunId,
        isStartCondition: true,
        required: true,
        value: content ? itemTextInputValue(content) : null,
      },
      {
        inputKey: INPUT_KEYS.sourcingSkuAttributes,
        sourceType: 'PREV_STEP',
        sourceStepRunId: sourcingRunId,
        isStartCondition: true,
        required: true,
        value: content
          ? attributesInputValue(flattenAttributes(content.itemAttributes, content.skuAttributes))
          : null,
      },
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
        errorMessage: '② 소싱 선택 상품을 찾지 못했습니다. ②를 확인한 뒤 ⑥-1을 다시 실행해 주세요.',
      };
    }
    if (!ctx.pinnedAi) throw new Error('⑥-1은 AI 단계인데 고정한 AI 문맥이 없습니다');
    const input = buildCopyPrompt({
      itemName: content.itemName,
      descriptionText: content.descriptionText,
      attributes: flattenAttributes(content.itemAttributes, content.skuAttributes),
    });
    const result = await this.generate(ctx.pinnedAi, input);
    const output: CopyGeneratedOutput = { kind: 'COPY_GENERATED', generatedCopy: result.output };
    return { kind: 'COMPLETED', output };
  }

  /**
   * 카피 AI 호출(D-17, `F-CT-41`, AI-04 일부). 결과가 앱 검증에서 떨어지면(`AI_OUTPUT_INVALID` — 스키마 불일치, 필드 속 결과
   * JSON·`placeholder` 같은 모양 깨짐) 시작 때 고정한 같은 엔진·모델(`pinned`)과 같은 입력으로 **1회 바로** 다시 부른다.
   * - 두 번째 오류는 바꾸지 않고 그대로 던진다(엔진이 지금처럼 FAILED(AI, `AI_OUTPUT_INVALID`)로 닫는다)
   * - 시간 초과·CLI 실패·AGY_ERROR·엔진 사용 불가·`AI_IMAGES_NOT_SEEN`·입력 차단·그 밖의 오류는 다시 부르지 않는다
   * - 두 호출 모두 `AiExecutor.run`을 지난다: 호출마다 call_log 1행(같은 step_run_id — id 순서가 시도 순서), 격리, 재검증
   * - 두 번째 호출 전에 엔진을 쓸 수 없게 되면 그 호출의 오류(`AI_ENGINE_UNAVAILABLE`)가 그대로 나간다(규칙 4와 같다)
   * 다시 부를 때 앱 로그에 시도 번호와 사유(필드 경로뿐, 값·출력 본문 없음 — NFR-02)를 남긴다
   */
  private async generate(
    pinned: PinnedAiContext,
    input: AiExecutorInput,
  ): Promise<AiExecutionResult<CopyDraft>> {
    try {
      return await this.ai.run<CopyDraft>(pinned, COPY_AI_TASK, COPY_SCHEMA, input);
    } catch (error) {
      if (!isAiOutputInvalid(error)) throw error;
      this.logger.warn(
        {
          stepRunId: pinned.stepRunId ?? null,
          task: COPY_AI_TASK.name,
          engine: pinned.engine,
          attempt: 1,
          nextAttempt: COPY_AI_MAX_ATTEMPTS,
          errorCode: error.errorCode,
          detail: error.detail,
        },
        `⑥-1 AI 결과가 정해진 형식과 달라(${error.detail}) 같은 엔진·모델로 1회 다시 부릅니다(D-17)`,
      );
      return this.ai.run<CopyDraft>(pinned, COPY_AI_TASK, COPY_SCHEMA, input);
    }
  }

  /**
   * 끝 트랜잭션: 카피 행을 쓴다. 이 후보의 앞 버전(산출물이 있는 가장 최근 — 재실행 필요 포함)의 오너 입력 필드를 가져온다(규칙 7).
   * 같은 실행에 두 번 불려도 이미 있으면 다시 쓰지 않는다
   */
  async persist(tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void> {
    if (outcome.kind !== 'COMPLETED' || !isCopyGeneratedOutput(outcome.output)) return;
    const exists = await tx.contentDraftCopy.findUnique({ where: { stepRunId } });
    if (exists) return;
    const run = await tx.stepRun.findUniqueOrThrow({ where: { id: stepRunId } });
    const generated = outcome.output.generatedCopy;
    const previousId = await latestVersionWithOutput(tx, run.candidateId, 'COPY', run.version);
    const previous = previousId !== null ? (await fieldsOf(tx, previousId)).map(draftOf) : [];
    const carried = carryCopyFields(previous, generated);
    await tx.contentDraftCopy.create({
      data: {
        stepRunId,
        generatedCopy: copyJson(generated),
        copy: copyJson(overlayCopy(generated, carried)),
      },
    });
    await insertFields(tx, stepRunId, carried);
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
