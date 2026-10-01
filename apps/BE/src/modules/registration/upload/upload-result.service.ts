import { Injectable } from '@nestjs/common';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import type { UploadResultOutputDto, UploadStepRunStatus } from '../dto/upload-result.dto.js';
import { readUploadResult } from './upload-result.store.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/** 조회 쿼리(stepRunId만) — 어기면 422 INVALID_QUERY_PARAMETER */
export function parseUploadResultQuery(query: Record<string, unknown>): {
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

/** 아직 ⑧을 실행하지 않았다(또는 그 버전에 산출물이 없다 — 실행 중·실패) */
export function uploadOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑧ 이미지 업로드' }),
    details: { stepCode: 'UPLOAD' },
  });
}

/**
 * ⑧ 산출물 조회(05-2 `getCandidateUploadResult`, 규칙 13, F-AP-01·04~07). 기본 현재 버전(`candidate_step.current_step_run_id`),
 * `?stepRunId=`면 그 버전(이 후보의 ⑧ 실행이 아니면 404 STEP_RUN_NOT_FOUND — ⑤~⑦과 같은 규칙). 순서: 쿼리 422 → 후보 404 →
 * 실행 404 → 산출물 404. `reused` = `uploaded_image.uploaded_at` < 이 실행 시작 시각(계산). 로컬 파일 경로는 넣지 않는다.
 */
@Injectable()
export class UploadResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
  ) {}

  async get(
    candidateId: number,
    rawQuery: Record<string, unknown>,
  ): Promise<UploadResultOutputDto> {
    const query = parseUploadResultQuery(rawQuery);
    await this.guard.findOr404(this.prisma, candidateId);
    const step = await this.prisma.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'UPLOAD' } },
      select: { currentStepRunId: true },
    });
    const currentId = step?.currentStepRunId ?? null;
    let runId: number;
    if (query.stepRunId !== null) {
      const found = await this.prisma.stepRun.findUnique({ where: { id: query.stepRunId } });
      if (!found || found.candidateId !== candidateId || found.stepCode !== 'UPLOAD') {
        throw new ApiException('STEP_RUN_NOT_FOUND', { details: { stepRunId: query.stepRunId } });
      }
      runId = found.id;
    } else {
      if (currentId === null) throw uploadOutputNotFound();
      runId = currentId;
    }
    const run = await this.prisma.stepRun.findUniqueOrThrow({ where: { id: runId } });
    const result = await readUploadResult(this.prisma, run.id);
    if (!result) throw uploadOutputNotFound();
    return {
      stepRunId: run.id,
      candidateId,
      version: run.version,
      stepRunStatus: run.status as UploadStepRunStatus,
      isCurrent: currentId === run.id,
      uploadResultId: result.id,
      detailContent: result.detailContent,
      detailContentSha256: result.detailContentSha256,
      createdAt: result.createdAt.toISOString(),
      images: result.images.map((image) => ({
        id: image.id,
        uploadedImageId: image.uploadedImageId,
        role: image.role === 'REPRESENTATIVE' ? 'REPRESENTATIVE' : 'ADDITIONAL',
        sortOrder: image.sortOrder,
        url: image.uploadedImage.url,
        sourceSha256: image.uploadedImage.sourceSha256,
        imageAssetId: image.uploadedImage.imageAssetId,
        uploadedAt: image.uploadedImage.uploadedAt.toISOString(),
        traceId: image.uploadedImage.traceId,
        reused: image.uploadedImage.uploadedAt.getTime() < run.startedAt.getTime(),
      })),
    };
  }
}
