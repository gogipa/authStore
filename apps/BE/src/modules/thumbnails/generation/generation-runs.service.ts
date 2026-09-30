import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { GenerationRun } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  IMAGE_GEN_PROVIDER,
  type ImageGenProvider,
} from '../../integrations/image-gen/image-gen.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import { StepEngineTransactions } from '../../step-engine/candidates/step-engine-tx.js';
import type {
  GenerationRunAcceptedDto,
  GenerationRunDetailDto,
  ThumbnailGenerationSummaryDto,
} from '../dto/generation-run.dto.js';
import { checkThumbnailPrompt } from '../prompt/thumbnail-prompt-previews.service.js';
import { ThumbnailReferenceRepository } from '../references/thumbnail-reference.repository.js';
import { notThumbnailRun } from '../references/thumbnail-references.service.js';
import { GENERATION_JOB, REFERENCE_MAX, REFERENCE_MIN } from '../thumbnail-sources.js';
import {
  generationReferenceSetSha256,
  nextAttempt,
  parseGenerationRequest,
  type GenerationStatus,
  type GenerationTriggerType,
} from './generation-rules.js';
import { generationRunEvent, GenerationWorker } from './generation.worker.js';

/** 생성 시도 조회 경로(Location, 05-2 createThumbnailGenerationRuns) */
export function generationRunLocation(id: number): string {
  return `/api/v1/generation-runs/${id}`;
}

/** generation_run → 05-2 ThumbnailGenerationSummary(프롬프트 전문 제외, M2 값은 null) */
export function toGenerationSummary(
  run: GenerationRun,
  adopted: boolean,
): ThumbnailGenerationSummaryDto {
  return {
    generationRunId: run.id,
    slotNo: run.slotNo,
    attemptNo: run.attemptNo,
    triggerType: run.triggerType as GenerationTriggerType,
    promptAdjusted: run.promptAdjusted,
    faceOption: run.faceOption as ThumbnailGenerationSummaryDto['faceOption'],
    requestedSizePx: run.requestedSizePx,
    provider: run.provider as ThumbnailGenerationSummaryDto['provider'],
    model: run.model,
    providerVersion: run.providerVersion,
    status: run.status as GenerationStatus,
    refusalReason: run.refusalReason,
    errorMessage: run.errorMessage,
    resultImageAssetId: run.resultImageAssetId,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    adopted,
    shoeRatio: null,
    shoeRatioMetric: null,
    detailPass: null,
    colorDeltaE: null,
  };
}

/**
 * AI 썸네일 후보 생성·다시 만들기와 시도 조회(05-2 `createThumbnailGenerationRuns`·`getThumbnailGenerationRun`, F-TH-07·08·09·13,
 * P3-02 규칙 1~5·8). 검사 순서(Proposed): 404 STEP_RUN_NOT_FOUND → 422 INVALID_STEP_CODE(⑤ 실행 아님) → 422 VALIDATION_FAILED
 * (번호 1..N·중복·얼굴 옵션·조정 2000자) → 422 REAL_PERSON_NAME_BLOCKED(서버 재검사 — 조정 문구 포함 전체 프롬프트, 행을 만들지
 * 않는다) → (후보 행 잠금) 409 CANDIDATE_LOCKED·CANDIDATE_EXCLUDED → 409 STEP_RUN_NOT_WAITING_INPUT(입력 대기인 현재 ⑤ 버전이
 * 아님) → 409 REFERENCES_NOT_CONFIRMED(확인한 레퍼런스 1~3장 없음) → 409 ALREADY_IN_PROGRESS(같은 번호 생성 중,
 * details.job=GENERATION·slotNos).
 * 번호마다 `generation_run` 1행(RUNNING): 회차 = 그 번호 최대 + 1, 첫 시도 INITIAL·그 뒤 OWNER_RETRY, 저장하는 `prompt`는 검사를
 * 통과한 전문뿐, 공급자·모델·버전 = 설정 공급자(`thumbnail.imageProvider`)로 `ImageGenProvider.identify`. 커밋 뒤 SSE(RUNNING)와
 * 생성 작업 대기열. 호출마다 새 회차(비멱등). ⑤는 입력 대기 그대로다.
 */
@Injectable()
export class GenerationRunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly settings: SettingsService,
    private readonly references: ThumbnailReferenceRepository,
    private readonly worker: GenerationWorker,
    private readonly events: ProgressEventsService,
    @Inject(IMAGE_GEN_PROVIDER) private readonly provider: ImageGenProvider,
  ) {}

  async create(
    stepRunId: number,
    body: Record<string, unknown>,
  ): Promise<GenerationRunAcceptedDto> {
    const run = await this.prisma.stepRun.findUnique({ where: { id: stepRunId } });
    if (!run) throw new ApiException('STEP_RUN_NOT_FOUND');
    if (run.stepCode !== 'THUMBNAIL') throw notThumbnailRun(run);
    const settings = this.settings.current();
    const request = parseGenerationRequest(body, settings.thumbnail.candidateCount);
    const checked = checkThumbnailPrompt(settings, request.faceOption, request.promptAdjustment);
    if (checked.blockedTerms.length > 0) {
      throw new ApiException('REAL_PERSON_NAME_BLOCKED', {
        message: formatErrorMessage('REAL_PERSON_NAME_BLOCKED', {
          단어: checked.blockedTerms.join(', '),
        }),
        details: { blockedTerms: checked.blockedTerms },
      });
    }
    const identity = this.provider.identify(settings.thumbnail.imageProvider);

    return this.transactions.run(async (scope) => {
      const candidate = await this.guard.lockForUpdate(scope.tx, run.candidateId);
      this.guard.assertMutable(candidate);
      const fresh = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: run.id } });
      const step = await scope.tx.candidateStep.findUniqueOrThrow({
        where: { candidateId_stepCode: { candidateId: run.candidateId, stepCode: 'THUMBNAIL' } },
      });
      if (fresh.status !== 'WAITING_INPUT' || step.currentStepRunId !== run.id) {
        throw new ApiException('STEP_RUN_NOT_WAITING_INPUT', {
          details: { stepRunId: run.id, status: fresh.status },
        });
      }
      const refs = await this.references.referencesOf(scope.tx, run.id);
      if (
        refs.length < REFERENCE_MIN ||
        refs.length > REFERENCE_MAX ||
        !refs.every((ref) => ref.noPersonConfirmedAt instanceof Date)
      ) {
        throw new ApiException('REFERENCES_NOT_CONFIRMED', {
          details: { stepRunId: run.id, referenceCount: refs.length },
        });
      }
      const existing = await scope.tx.generationRun.findMany({
        where: { stepRunId: run.id },
        select: { slotNo: true, attemptNo: true, status: true },
      });
      const busy = request.slotNos.filter((slot) =>
        existing.some((row) => row.slotNo === slot && row.status === 'RUNNING'),
      );
      if (busy.length > 0) {
        throw new ApiException('ALREADY_IN_PROGRESS', {
          message: formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: '썸네일 생성' }),
          details: { job: GENERATION_JOB, slotNos: busy },
        });
      }
      const referenceSetSha256 = generationReferenceSetSha256(
        refs.map((ref) => ({ sha256: ref.imageAsset.sha256 })),
      );
      const created: GenerationRun[] = [];
      for (const slotNo of request.slotNos) {
        const { attemptNo, triggerType } = nextAttempt(existing, slotNo);
        created.push(
          await scope.tx.generationRun.create({
            data: {
              stepRunId: run.id,
              slotNo,
              attemptNo,
              triggerType,
              prompt: checked.prompt,
              promptAdjusted: checked.promptAdjusted,
              faceOption: request.faceOption,
              requestedSizePx: checked.requestedSizePx,
              provider: identity.provider,
              model: identity.model.slice(0, 100),
              providerVersion: identity.providerVersion?.slice(0, 40) ?? null,
              referenceSetSha256,
              status: 'RUNNING',
              startedAt: scope.now,
            },
          }),
        );
      }
      scope.afterCommit(() => {
        for (const row of created) {
          this.events.publish('generation-run.updated', generationRunEvent(row, run.candidateId));
        }
        this.worker.submit(created.map((row) => row.id));
      });
      return {
        stepRunId: run.id,
        candidateId: run.candidateId,
        generationRuns: created.map((row) => ({
          generationRunId: row.id,
          slotNo: row.slotNo,
          attemptNo: row.attemptNo,
          triggerType: row.triggerType as GenerationTriggerType,
          status: 'RUNNING' as const,
        })),
      };
    });
  }

  /**
   * 시도 한 건 그대로(프롬프트 전문·공급자·거부 사유). `adopted` = 결과 이미지가 G3 선택본(어느 ⑤ 버전이든)에 들어 있는지.
   * 없으면 404 GENERATION_RUN_NOT_FOUND
   */
  async get(generationRunId: number): Promise<GenerationRunDetailDto> {
    const run = await this.prisma.generationRun.findUnique({
      where: { id: generationRunId },
      include: { stepRun: { select: { candidateId: true } } },
    });
    if (!run) throw new ApiException('GENERATION_RUN_NOT_FOUND');
    const adopted =
      run.resultImageAssetId !== null &&
      (await this.prisma.thumbnailSelectionImage.count({
        where: { imageAssetId: run.resultImageAssetId },
      })) > 0;
    return {
      ...toGenerationSummary(run, adopted),
      stepRunId: run.stepRunId,
      candidateId: run.stepRun.candidateId,
      prompt: run.prompt,
      referenceSetSha256: run.referenceSetSha256,
      shoeBox: null,
      detailVerdict: null,
    };
  }
}
