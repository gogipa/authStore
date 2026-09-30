import { Inject, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { CLOCK, type Clock } from '../integrations/http/clock.token.js';
import { isRakutenApiError } from '../integrations/rakuten/rakuten-api-error.mapper.js';
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
import { toApiException } from '../step-engine/execution/step-blocks.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import { ThumbnailReferenceRepository } from './references/thumbnail-reference.repository.js';
import {
  SourceImageDownloader,
  SourceImageDownloadError,
} from './source-images/source-image.downloader.js';
import { THUMBNAIL_PENDING_INPUT, THUMBNAIL_WAITING_REASON } from './thumbnail-sources.js';

/**
 * ⑤ 입력 대기 중간 산출물(실행기 결과 `output`, 엔진은 해석하지 않는다). 원본을 받은 뒤 `persist`가 후보의 최신 레퍼런스
 * 선택(이 itemCode 원본일 때만)을 이 버전의 `thumbnail_reference`로 복사한다(P3-01 규칙 6).
 */
export interface ThumbnailOriginalsOutput {
  kind: 'THUMBNAIL_ORIGINALS';
  candidateId: number;
  /** 원본을 받은 ② 소싱 선택 itemCode */
  itemCode: string;
  /** 받은(또는 이미 있던) 원본 image_asset id(페이지 순서) */
  imageAssetIds: number[];
  via: 'MEDIA_IMAGES' | 'API_EX_FALLBACK';
}

export function isThumbnailOriginalsOutput(value: unknown): value is ThumbnailOriginalsOutput {
  return (value as { kind?: unknown } | null)?.kind === 'THUMBNAIL_ORIGINALS';
}

/** 관문·라쿠텐 API 오류 → ⑤ 실패 기록(비밀·로컬 경로 없는 한국어 문구) */
function externalFailure(error: unknown): Extract<StepOutcome, { kind: 'FAILED' }> | null {
  if (error instanceof SourceImageDownloadError) {
    return {
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: error.errorCode,
      errorMessage: error.userMessage,
    };
  }
  if (error instanceof ApiException) {
    return {
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  if (isRakutenApiError(error)) {
    return {
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: error.errorCode,
      errorMessage: error.userMessage,
    };
  }
  return null;
}

/**
 * ⑤ THUMBNAIL 실행기(P3-01 §5 `thumbnail-step.runner.ts`, F-TH-01·02·04, P1-05 실행기 규약). thumbnails 모듈 provider로
 * step-engine 레지스트리에 등록된다(`@StepRunnerFor('THUMBNAIL')`). M1에서 선택 AI 엔진을 쓰지 않는다(`usesAi=false` —
 * step_run.ai_* NULL, AI_ENGINE_UNAVAILABLE로 막지 않는다. G2 전 AI 비용 경고는 엔진이 붙인다).
 * - 시작 조건(규칙 1): ② 현재 버전 완료(엔진 그래프 — 409 STEP_START_CONDITION_UNMET, fieldErrors `sourcing.selection`) +
 *   그 버전의 소싱 선택(`beforeStart` — 없으면 같은 409)
 * - 입력 지문(규칙 2): 설정 두 키 `settings.thumbnail.promptTemplate`·`settings.thumbnail.faceOptionDefault`(SETTINGS)뿐이다.
 *   ② itemCode·원본 목록은 넣지 않는다 — 같은 앵커 키 안에서 샵만 바꿔도 ⑤·G3은 그대로다. 실행 중 오너 입력
 *   `owner.referenceSelection`(최신 선택의 레퍼런스 해시, 지문 밖)을 함께 남긴다. body의 `faceOption`·`promptAdjustment`는
 *   생성(P3-02 `generation_run`)의 값이라 여기서 기록하지 않는다
 * - 실행: ② 선택 상품 원본 받기(`SourceImageDownloader`) → 입력 대기(`THUMBNAIL_REFERENCE_REQUIRED`, pending
 *   `owner.referenceSelection`) → `persist`가 레퍼런스 기본값 복사. 받기 실패는 FAILED(EXTERNAL_API). ⑤는 G3 선택(P3-02)까지
 *   입력 대기다
 * - ② 산출물은 step-engine 창구(`StepEngineApi.currentCompletedRun`·`readSourcingImages`)로만 읽는다(sourcing import 없음)
 */
@StepRunnerFor('THUMBNAIL')
@Injectable()
export class ThumbnailStepRunner implements StepRunner {
  readonly stepCode = 'THUMBNAIL' as const;
  readonly usesAi = false;
  private readonly logger = new Logger(ThumbnailStepRunner.name);

  constructor(
    private readonly api: StepEngineApi,
    private readonly downloader: SourceImageDownloader,
    private readonly references: ThumbnailReferenceRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 규칙 1: ② 현재 완료 버전에 소싱 선택(itemCode)이 없으면 409 STEP_START_CONDITION_UNMET — 실행을 만들지 않는다 */
  async beforeStart(ctx: StepStartContext): Promise<void> {
    const sourcing = await this.api.currentCompletedRun(ctx.candidate.id, 'SOURCING', ctx.db);
    const selection = sourcing ? await this.api.readSourcingSelection(sourcing.id, ctx.db) : null;
    if (!selection) {
      throw toApiException({
        code: 'STEP_START_CONDITION_UNMET',
        stepCode: 'THUMBNAIL',
        missingInputs: [INPUT_KEYS.sourcingSelection],
      });
    }
  }

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    return [
      {
        inputKey: INPUT_KEYS.settingsThumbnailPromptTemplate,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.thumbnail.promptTemplate,
      },
      {
        inputKey: INPUT_KEYS.settingsThumbnailFaceOptionDefault,
        sourceType: 'SETTINGS',
        isStartCondition: true,
        required: true,
        value: ctx.settings.thumbnail.faceOptionDefault,
      },
      {
        // 실행 중 오너 입력(지문 밖): 최신 레퍼런스 선택의 해시(이 itemCode 원본일 때만). 레퍼런스 저장이 새 값으로 다시 쓴다
        inputKey: INPUT_KEYS.ownerReferenceSelection,
        sourceType: 'OWNER_INPUT',
        isStartCondition: false,
        required: false,
        value: await this.references.latestSelectionHash(
          ctx.db,
          ctx.candidate.id,
          ctx.candidate.itemCode,
        ),
      },
    ];
  }

  async run(ctx: StepRunContext): Promise<StepOutcome> {
    const sourcing = await this.api.currentCompletedRun(ctx.candidateId, 'SOURCING');
    const view = sourcing ? await this.api.readSourcingImages(sourcing.id) : null;
    if (!view) {
      return {
        kind: 'FAILED',
        failureKind: 'INPUT_VALIDATION',
        errorCode: 'SOURCING_SELECTION_REQUIRED',
        errorMessage: formatErrorMessage('SOURCING_SELECTION_REQUIRED'),
      };
    }
    try {
      const result = await this.downloader.download(
        {
          itemCode: view.itemCode,
          shopCode: view.shopCode,
          imageUrls: view.imageUrls,
          modelCodeNorm: view.modelCodeNorm,
          colorCode: view.colorCode,
        },
        { candidateId: ctx.candidateId, stepRunId: ctx.stepRunId },
      );
      const output: ThumbnailOriginalsOutput = {
        kind: 'THUMBNAIL_ORIGINALS',
        candidateId: ctx.candidateId,
        itemCode: view.itemCode,
        imageAssetIds: result.images.map((image) => image.imageAssetId),
        via: result.via,
      };
      return {
        kind: 'WAITING_INPUT',
        waitingReasonCode: THUMBNAIL_WAITING_REASON,
        pendingInputs: [THUMBNAIL_PENDING_INPUT],
        output,
      };
    } catch (error) {
      const failure = externalFailure(error);
      if (!failure) throw error;
      this.logger.warn(`⑤ 원본 이미지 받기 실패(실행 #${ctx.stepRunId}): ${failure.errorCode}`);
      return failure;
    }
  }

  /**
   * 끝 트랜잭션: 입력 대기 중간 산출물이면 후보의 최신 레퍼런스 선택(모두 이 itemCode의 ORIGINAL·PRODUCT_IMAGE일 때만)을
   * 이 버전의 `thumbnail_reference`로 복사해 기본값으로 둔다(규칙 6). 같은 실행에 두 번 불려도 이미 있으면 두지 않는다
   */
  async persist(tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void> {
    if (outcome.kind !== 'WAITING_INPUT' || !isThumbnailOriginalsOutput(outcome.output)) return;
    const output = outcome.output;
    const existing = await this.references.referencesOf(tx, stepRunId);
    if (existing.length > 0) return;
    const latest = await this.references.latestEligibleInput(
      tx,
      output.candidateId,
      output.itemCode,
    );
    if (!latest) return;
    await this.references.replaceReferences(
      tx,
      stepRunId,
      latest.rows.map((row) => ({
        imageAssetId: row.imageAssetId,
        sortOrder: row.sortOrder,
        noPersonConfirmedAt: row.noPersonConfirmedAt,
      })),
      this.clock.now(),
    );
  }

  /** 이전 버전 다시 고르기·그대로 유지: 레퍼런스 행을 새 버전으로 그대로 복사한다(생성·G3 선택은 P3-02가 더한다) */
  async copyOutput(
    tx: Tx,
    fromStepRunId: number,
    toStepRunId: number,
  ): Promise<CandidateEffects | void> {
    await this.references.copyReferences(tx, fromStepRunId, toStepRunId);
  }
}
