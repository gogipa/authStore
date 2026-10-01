import { Inject, Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { assertCommerceKeys } from '../../../common/secrets/assert-commerce-keys.js';
import { SECRET_STORE, type SecretStore } from '../../../common/secrets/secret-store.port.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  StepRunnerFor,
  type StepInput,
  type StepInputContext,
  type StepOutcome,
  type StepRunContext,
  type StepRunner,
  type StepStartContext,
  type Tx,
} from '../../step-engine/contracts/step-runner.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { buildDetailContent, DetailContentError } from './detail-content.js';
import { ImageNormalizeError } from './image-normalizer.js';
import {
  ImageNotAllowedError,
  ImageUploadService,
  UploadSourceMissingError,
} from './image-upload.service.js';
import { uploadStepInputs } from './upload-inputs.js';
import {
  copyUploadResult,
  insertUploadResult,
  isUploadOutput,
  type UploadOutput,
} from './upload-result.store.js';

/** ⑧ 실패 문구(한국어, 실행 기록 errorMessage — 로컬 경로·비밀 없음) */
export const UPLOAD_FAILURE_MESSAGES = {
  imageNotAllowed: formatErrorMessage('IMAGE_NOT_ALLOWED', {
    이유: '참조 전용 원본·레퍼런스 이미지는 스마트스토어에 올리지 않습니다. ⑤에서 AI 생성 이미지로 다시 골라 주세요',
  }),
  imageUnreadable: '업로드할 이미지 파일을 읽지 못했습니다. ⑤에서 이미지를 다시 골라 주세요.',
  inputsMissing:
    '⑤ G3 선택본이나 ⑥-3 상세 HTML을 읽지 못했습니다. 두 단계를 확인한 뒤 ⑧을 다시 실행해 주세요.',
  placeholderLeft: (n: number) =>
    `상세 HTML의 이미지 자리표시자 ${n}개를 업로드 주소로 바꾸지 못했습니다. ⑥-3을 다시 실행해 주세요.`,
  uploadFailed: (detail: string) => `커머스API 이미지 업로드에 실패했습니다. ${detail}`,
} as const;

/** 실행 기록 error_code(외부 실패는 ApiException 코드 그대로) */
export const UPLOAD_ERROR_CODES = {
  imageNotAllowed: 'IMAGE_NOT_ALLOWED',
  imageUnreadable: 'UPLOAD_IMAGE_UNREADABLE',
  inputsMissing: 'STEP_START_CONDITION_UNMET',
  placeholderLeft: 'DETAIL_PLACEHOLDER_LEFT',
} as const;

function inputFailure(errorCode: string, errorMessage: string): StepOutcome {
  return { kind: 'FAILED', failureKind: 'INPUT_VALIDATION', errorCode, errorMessage };
}

/** 이미지 행·파일이 없는 경우(로컬 문제 — 입력 검증 실패로 본다) */
const LOCAL_FILE_ERROR_CODES = new Set(['IMAGE_FILE_MISSING', 'IMAGE_ASSET_NOT_FOUND']);

/** 업로드 중 예외 → ⑧ 실행 결과(모르는 예외는 null — 엔진이 앱 오류로 남긴다) */
export function uploadFailureOf(error: unknown): StepOutcome | null {
  if (error instanceof ImageNotAllowedError) {
    return inputFailure(
      UPLOAD_ERROR_CODES.imageNotAllowed,
      UPLOAD_FAILURE_MESSAGES.imageNotAllowed,
    );
  }
  if (error instanceof ImageNormalizeError || error instanceof UploadSourceMissingError) {
    return inputFailure(
      UPLOAD_ERROR_CODES.imageUnreadable,
      UPLOAD_FAILURE_MESSAGES.imageUnreadable,
    );
  }
  if (error instanceof ApiException) {
    if (LOCAL_FILE_ERROR_CODES.has(error.code)) {
      return inputFailure(
        UPLOAD_ERROR_CODES.imageUnreadable,
        UPLOAD_FAILURE_MESSAGES.imageUnreadable,
      );
    }
    // 4xx·5xx·타임아웃·연결 실패·키 없음·인증 실패 — HTTP 오류가 아니라 ⑧ FAILED(EXTERNAL_API) + SSE(규칙 14)
    return {
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: error.code,
      errorMessage: UPLOAD_FAILURE_MESSAGES.uploadFailed(error.message),
    };
  }
  return null;
}

/**
 * ⑧ UPLOAD 실행기(P4-01 §5 `upload.step-runner.ts`, F-AP-01~07·F-BS-45, 규칙 1~14). registration 모듈 provider로 step-engine
 * 레지스트리에 등록된다(`@StepRunnerFor('UPLOAD')`). AI를 쓰지 않는다(`usesAi=false` — `step_run.ai_*` NULL).
 * - 시작 조건(규칙 1·3): ⑤ G3 선택본(완료 버전의 `thumbnail_selection_image` 해시, sort_order 순)과 ⑥-3 `html_sha256` — 둘 다
 *   step-engine 창구(`readThumbnailSelectionOf`·`readNoticeHtml`)로만 읽는다(thumbnails·content를 import하지 않는다).
 *   G3 무효·없음은 엔진이 409 `GATE_NOT_PASSED`(`STEP_GRAPH.UPLOAD.gates`), 임시 후보는 409 `TEMP_CANDIDATE_NOT_ALLOWED`,
 *   잠긴 후보는 409 `CANDIDATE_LOCKED`로 막는다
 * - 시작 전(`beforeStart`): 커머스API 키가 키체인에 없으면 409 `SECRET_NOT_CONFIGURED`(실행을 만들지 않는다)
 * - 실행: `ImageUploadService.uploadSelection`(참조 전용 거부 → 해시 재사용 → 정규화 → 직렬 묶음 업로드) → ⑥-3 HTML 자리표시자를
 *   업로드 URL로 바꿔 최종 `detailContent`. ⑥-3만 바뀐 다시 실행은 해시가 모두 있어 업로드 호출 0건이다
 * - 저장(규칙 12): `persist`가 P1-05 끝 트랜잭션 안에서 `upload_result`(+image)를 쓴다
 * - 이전 버전 다시 고르기(RESTORE_VERSION): 바탕 버전 산출물을 복사한다. ⑧에는 '그대로 유지'·EDIT가 없다(엔진이 막는다)
 */
@StepRunnerFor('UPLOAD')
@Injectable()
export class UploadStepRunner implements StepRunner {
  readonly stepCode = 'UPLOAD' as const;
  readonly usesAi = false;

  constructor(
    private readonly api: StepEngineApi,
    private readonly prisma: PrismaService,
    private readonly uploads: ImageUploadService,
    @Inject(SECRET_STORE) private readonly secrets: SecretStore,
  ) {}

  async beforeStart(_ctx: StepStartContext): Promise<void> {
    await assertCommerceKeys(this.secrets);
  }

  async readInputs(ctx: StepInputContext): Promise<StepInput[]> {
    const thumbnailStepRunId = ctx.completedRunId('THUMBNAIL');
    const noticeHtmlStepRunId = ctx.completedRunId('NOTICE_HTML');
    const selection =
      thumbnailStepRunId !== null ? await this.selectionHashes(ctx.db, thumbnailStepRunId) : null;
    const html =
      noticeHtmlStepRunId !== null
        ? await this.api.readNoticeHtml(noticeHtmlStepRunId, ctx.db)
        : null;
    return uploadStepInputs({
      thumbnailStepRunId,
      selection,
      noticeHtmlStepRunId,
      htmlSha256: html?.htmlSha256 ?? null,
    });
  }

  async run(ctx: StepRunContext): Promise<StepOutcome> {
    const runIdOf = (key: string) =>
      ctx.inputs.find((input) => input.inputKey === key)?.sourceStepRunId ?? null;
    const thumbnailStepRunId = runIdOf(INPUT_KEYS.thumbnailSelection);
    const noticeHtmlStepRunId = runIdOf(INPUT_KEYS.noticeHtmlHtml);
    const selection =
      thumbnailStepRunId !== null
        ? await this.api.readThumbnailSelectionOf(thumbnailStepRunId, this.prisma)
        : null;
    const html =
      noticeHtmlStepRunId !== null
        ? await this.api.readNoticeHtml(noticeHtmlStepRunId, this.prisma)
        : null;
    if (!selection || selection.images.length === 0 || !html) {
      return inputFailure(UPLOAD_ERROR_CODES.inputsMissing, UPLOAD_FAILURE_MESSAGES.inputsMissing);
    }
    let uploaded;
    try {
      uploaded = await this.uploads.uploadSelection(selection.images, {
        candidateId: ctx.candidateId,
        stepRunId: ctx.stepRunId,
      });
    } catch (error) {
      const failure = uploadFailureOf(error);
      if (failure) return failure;
      throw error;
    }
    let detail;
    try {
      detail = buildDetailContent(
        html.html,
        new Map(uploaded.map((image) => [image.sortOrder, image.url])),
      );
    } catch (error) {
      if (error instanceof DetailContentError) {
        return inputFailure(
          UPLOAD_ERROR_CODES.placeholderLeft,
          UPLOAD_FAILURE_MESSAGES.placeholderLeft(error.remaining),
        );
      }
      throw error;
    }
    const output: UploadOutput = {
      kind: 'UPLOAD_RESULT',
      detailContent: detail.detailContent,
      detailContentSha256: detail.detailContentSha256,
      images: uploaded.map((image) => ({
        uploadedImageId: image.uploadedImageId,
        role: image.role,
        sortOrder: image.sortOrder,
      })),
    };
    return { kind: 'COMPLETED', output };
  }

  async persist(tx: Tx, stepRunId: number, outcome: StepOutcome): Promise<void> {
    if (outcome.kind !== 'COMPLETED' || !isUploadOutput(outcome.output)) return;
    await insertUploadResult(tx, stepRunId, outcome.output);
  }

  async copyOutput(tx: Tx, fromStepRunId: number, toStepRunId: number): Promise<void> {
    if (await copyUploadResult(tx, fromStepRunId, toStepRunId)) return;
    throw new ApiException('STEP_OUTPUT_NOT_FOUND', {
      message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑧ 이미지 업로드' }),
      details: { stepCode: 'UPLOAD', stepRunId: fromStepRunId },
    });
  }

  /** ⑤ 버전의 선택본 → `{sortOrder, sha256}`(원천 파일 해시 — image_asset은 common 표) */
  private async selectionHashes(
    db: Tx,
    thumbnailStepRunId: number,
  ): Promise<{ sortOrder: number; sha256: string }[] | null> {
    const selection = await this.api.readThumbnailSelectionOf(thumbnailStepRunId, db);
    if (!selection) return null;
    const assets = await db.imageAsset.findMany({
      where: { id: { in: selection.images.map((image) => image.imageAssetId) } },
      select: { id: true, sha256: true },
    });
    const shaOf = new Map(assets.map((asset) => [asset.id, asset.sha256]));
    return selection.images.map((image) => ({
      sortOrder: image.sortOrder,
      sha256: shaOf.get(image.imageAssetId) ?? '',
    }));
  }
}
