import { Inject, Injectable, Logger } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import { FileStorageService } from '../../../common/files/file-storage.service.js';
import { ImageAssetsService } from '../../../common/files/image-assets.service.js';
import { UnsupportedImageError } from '../../../common/files/image-asset.rules.js';
import type { GenerationRun, Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  IMAGE_GEN_PROVIDER,
  ImageGenError,
  type ImageGenProvider,
  type ImageGenProviderCode,
  type ImageGenResult,
} from '../../integrations/image-gen/image-gen.port.js';
import { SettingsService } from '../../settings/settings.service.js';
import {
  clipText,
  GENERATION_ERROR_MESSAGES,
  generationTimeoutMs,
  REFUSAL_REASON_UNKNOWN,
  runWithTimeout,
  type GenerationStatus,
  type GenerationTriggerType,
} from './generation-rules.js';

/** 끝난 시도의 마감 값(한 번만 쓴다) */
export type GenerationFinish =
  | { status: 'SUCCEEDED'; resultImageAssetId: number }
  | { status: 'REFUSED'; refusalReason: string }
  | { status: 'FAILED'; errorMessage: string };

/** SSE `generation-run.updated` 한 건(05-1 §3) */
export function generationRunEvent(run: GenerationRun, candidateId: number) {
  return {
    candidateId,
    stepRunId: run.stepRunId,
    generationRunId: run.id,
    slotNo: run.slotNo,
    attemptNo: run.attemptNo,
    triggerType: run.triggerType as GenerationTriggerType,
    status: run.status as GenerationStatus,
    refusalReason: run.refusalReason,
    errorMessage: run.errorMessage,
    resultImageAssetId: run.resultImageAssetId,
  };
}

/** 마감 시각: 지금(CLOCK)이 시작보다 이르면 시작 시각(`ck_gen_time`) */
export function finishTimeOf(now: Date, startedAt: Date): Date {
  return now.getTime() < startedAt.getTime() ? startedAt : now;
}

/**
 * 생성 결과 바이트의 형식을 **내용으로** 판별한다(P3-02 규칙 5 — 공급자가 `.jpg` 이름으로 PNG를 줘도 image/png). 이미지가
 * 아니면 null. 확장자·공급자가 말한 형식은 보지 않는다(agy는 확장자와 실제 형식이 다를 수 있다 — M0 S1 전)
 */
export async function detectGeneratedImage(
  bytes: Buffer,
): Promise<{ mimeType: string; width: number; height: number } | null> {
  try {
    const info = await ImageAssetsService.detect(bytes);
    return { mimeType: info.mimeType, width: info.width, height: info.height };
  } catch (error) {
    if (error instanceof UnsupportedImageError) return null;
    throw error;
  }
}

/**
 * ⑤ 썸네일 생성 작업(P3-02 §5.1 `generation.worker.ts`, 규칙 5~7). 이미지 슬롯 하나로 **순서대로** 돈다(이미지 작업은 동시에
 * 1개 — AI-03·D-16 R13. P1-10 실행기(StepExecutor)에는 이미지 슬롯이 없어 여기에 직렬 대기열을 둔다, Proposed).
 * 시도 하나: 레퍼런스 파일 → `ImageGenProvider.generate`(하드 타임아웃 = 설정 `thumbnail.generationTimeoutSeconds`, 최대 15분) →
 * - 이미지: 내용으로 형식을 판별해 `image_asset`(kind=GENERATED, usage_right=PERMITTED, candidate_id)을 만들고 같은 트랜잭션에서
 *   `status=SUCCEEDED`·`result_image_asset_id`·`finished_at`을 한 번에 채운다. 크기는 바꾸지 않는다(1000×1000 JPEG는 P4-01)
 * - 거부: `REFUSED` + `refusal_reason`(필수) / 그 밖: `FAILED` + 한국어 `error_message`(비밀·로컬 경로 없음)
 * RUNNING 행만 한 번 마감한다(재시작 정리가 먼저 닫았으면 건너뛴다). ⑤ 단계 상태는 바꾸지 않는다(시도 하나의 결과).
 * 마감할 때마다 SSE `generation-run.updated`. 테스트는 `whenIdle()`로 기다린다(sleep 금지).
 */
@Injectable()
export class GenerationWorker {
  private readonly logger = new Logger(GenerationWorker.name);
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly images: ImageAssetsService,
    private readonly files: FileStorageService,
    private readonly events: ProgressEventsService,
    @Inject(IMAGE_GEN_PROVIDER) private readonly provider: ImageGenProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 시도들을 대기열 끝에 넣는다(요청 순서 = 번호 순서) */
  submit(generationRunIds: readonly number[]): void {
    for (const id of generationRunIds) {
      this.tail = this.tail.then(() =>
        this.process(id).catch((error: unknown) => {
          this.logger.error({ err: error }, `썸네일 생성 #${id}을 처리하지 못했습니다`);
        }),
      );
    }
  }

  /** 대기열이 빌 때까지(테스트·종료) */
  async whenIdle(): Promise<void> {
    let seen: Promise<void>;
    do {
      seen = this.tail;
      await seen;
    } while (seen !== this.tail);
  }

  private timeoutMs(): number {
    const seconds = this.settings.currentOrNull()?.thumbnail.generationTimeoutSeconds ?? 900;
    return generationTimeoutMs(seconds);
  }

  /** 시도 하나 */
  async process(generationRunId: number): Promise<void> {
    const run = await this.prisma.generationRun.findUnique({
      where: { id: generationRunId },
      include: { stepRun: { select: { candidateId: true } } },
    });
    if (!run || run.status !== 'RUNNING') return;
    const candidateId = run.stepRun.candidateId;
    const refs = await this.prisma.thumbnailReference.findMany({
      where: { stepRunId: run.stepRunId },
      orderBy: { sortOrder: 'asc' },
      include: { imageAsset: { select: { filePath: true } } },
    });
    const paths: string[] = [];
    for (const ref of refs) {
      if (!(await this.files.exists(ref.imageAsset.filePath))) break;
      paths.push(this.files.resolve(ref.imageAsset.filePath));
    }
    if (refs.length === 0 || paths.length !== refs.length) {
      await this.finish(run, candidateId, {
        status: 'FAILED',
        errorMessage: GENERATION_ERROR_MESSAGES.referenceMissing,
      });
      return;
    }

    const timeoutMs = this.timeoutMs();
    let result: ImageGenResult;
    try {
      const timed = await runWithTimeout(
        (signal) =>
          this.provider.generate({
            identity: {
              provider: run.provider as ImageGenProviderCode,
              model: run.model,
              providerVersion: run.providerVersion,
            },
            prompt: run.prompt,
            referenceImagePaths: paths,
            sizePx: run.requestedSizePx,
            timeoutMs,
            signal,
          }),
        timeoutMs,
      );
      if (timed.kind === 'TIMEOUT') {
        await this.finish(run, candidateId, {
          status: 'FAILED',
          errorMessage: GENERATION_ERROR_MESSAGES.timeout(timeoutMs),
        });
        return;
      }
      result = timed.value;
    } catch (error) {
      const message =
        error instanceof ImageGenError
          ? clipText(error.userMessage)
          : GENERATION_ERROR_MESSAGES.internal;
      if (!(error instanceof ImageGenError)) {
        this.logger.error({ err: error }, `썸네일 생성 #${run.id} 공급자 오류`);
      }
      await this.finish(run, candidateId, { status: 'FAILED', errorMessage: message });
      return;
    }

    if (result.kind === 'REFUSED') {
      await this.finish(run, candidateId, {
        status: 'REFUSED',
        refusalReason: clipText(result.reason) || REFUSAL_REASON_UNKNOWN,
      });
      return;
    }
    if (result.bytes.length === 0) {
      await this.finish(run, candidateId, {
        status: 'FAILED',
        errorMessage: GENERATION_ERROR_MESSAGES.empty,
      });
      return;
    }
    if (!(await detectGeneratedImage(result.bytes))) {
      await this.finish(run, candidateId, {
        status: 'FAILED',
        errorMessage: GENERATION_ERROR_MESSAGES.unsupported,
      });
      return;
    }
    await this.finishWithImage(run, candidateId, result.bytes);
  }

  /** 이미지 저장 + SUCCEEDED 마감을 한 트랜잭션으로(마감할 RUNNING 행이 없으면 되돌린다) */
  private async finishWithImage(
    run: GenerationRun,
    candidateId: number,
    bytes: Buffer,
  ): Promise<void> {
    const finishedAt = finishTimeOf(this.clock.now(), run.startedAt);
    const updated = await this.prisma
      .$transaction(async (tx) => {
        const asset = await this.images.saveImage(bytes, { kind: 'GENERATED', candidateId }, tx);
        const closed = await this.close(tx, run.id, {
          status: 'SUCCEEDED',
          resultImageAssetId: asset.id,
          finishedAt,
        });
        if (!closed) throw new AlreadyClosed();
        return closed;
      })
      .catch((error: unknown) => {
        if (error instanceof AlreadyClosed) return null;
        throw error;
      });
    if (updated) this.publish(updated, candidateId);
  }

  /** 거부·실패 마감 */
  async finish(run: GenerationRun, candidateId: number, finish: GenerationFinish): Promise<void> {
    const finishedAt = finishTimeOf(this.clock.now(), run.startedAt);
    const data =
      finish.status === 'SUCCEEDED'
        ? { status: 'SUCCEEDED', resultImageAssetId: finish.resultImageAssetId, finishedAt }
        : finish.status === 'REFUSED'
          ? { status: 'REFUSED', refusalReason: finish.refusalReason, finishedAt }
          : { status: 'FAILED', errorMessage: finish.errorMessage, finishedAt };
    const closed = await this.close(this.prisma, run.id, data);
    if (closed) this.publish(closed, candidateId);
  }

  /** RUNNING인 행만 한 번 마감한다. 마감했으면 새 행, 이미 닫혔으면 null */
  private async close(
    db: Prisma.TransactionClient,
    id: number,
    data: Prisma.GenerationRunUncheckedUpdateManyInput,
  ): Promise<GenerationRun | null> {
    const { count } = await db.generationRun.updateMany({
      where: { id, status: 'RUNNING' },
      data,
    });
    return count === 1 ? db.generationRun.findUniqueOrThrow({ where: { id } }) : null;
  }

  private publish(run: GenerationRun, candidateId: number): void {
    this.events.publish('generation-run.updated', generationRunEvent(run, candidateId));
  }
}

class AlreadyClosed extends Error {}
