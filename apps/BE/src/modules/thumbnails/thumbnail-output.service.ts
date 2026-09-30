import { Injectable } from '@nestjs/common';
import { ApiException } from '../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../common/errors/error-codes.js';
import { imageAssetFileUrl } from '../../common/files/image-assets.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { CandidateGuardService } from '../step-engine/candidates/candidate-guard.service.js';
import { StepEngineApi } from '../step-engine/step-engine.api.js';
import type { ThumbnailG3ChecklistDto, ThumbnailOutputDto } from './dto/thumbnail-output.dto.js';
import { toGenerationSummary } from './generation/generation-runs.service.js';
import { ThumbnailReferenceRepository } from './references/thumbnail-reference.repository.js';
import {
  sameProductColorRequired,
  toReferenceItem,
} from './references/thumbnail-references.service.js';
import { ThumbnailSelectionRepository } from './selection/thumbnail-selection.repository.js';
import { REFERENCE_MAX, REFERENCE_MIN } from './thumbnail-sources.js';

/** int4 상한 */
const MAX_ID = 2_147_483_647;

/** 설정을 읽지 못했을 때 후보 칸 수(IM-03 기본 2) */
const DEFAULT_CANDIDATE_COUNT = 2;

function invalidQuery(field: string, message: string): ApiException {
  return new ApiException('INVALID_QUERY_PARAMETER', { fieldErrors: [{ field, message }] });
}

/** 쿼리(05-2 getCandidateThumbnail: stepRunId만) — 어기면 422 INVALID_QUERY_PARAMETER */
export function parseThumbnailOutputQuery(query: Record<string, unknown>): {
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

/** ⑤ 미실행(05-2 getCandidateThumbnail 404, details.stepCode=THUMBNAIL) */
export function thumbnailOutputNotFound(): ApiException {
  return new ApiException('STEP_OUTPUT_NOT_FOUND', {
    message: formatErrorMessage('STEP_OUTPUT_NOT_FOUND', { 단계: '⑤ 썸네일' }),
    details: { stepCode: 'THUMBNAIL' },
  });
}

/**
 * ⑤ 썸네일 산출물 조회(05-2 `getCandidateThumbnail`, F-TH-03·04·08·09·12·15·16·17, P3-02 규칙 8). 한 화면 단위:
 * - 버전: 기본은 현재 버전(candidate_step.current_step_run_id), `?stepRunId=`면 그 버전. 이 후보의 ⑤ 실행이 아니면 404
 *   STEP_RUN_NOT_FOUND, ⑤ 미실행이면 404 STEP_OUTPUT_NOT_FOUND
 * - 레퍼런스(thumbnail_reference) + `referencesConfirmed`(1~3장 모두 '사람·얼굴 없음' 확인)
 * - 생성 후보: 이 버전의 생성 시도(번호·회차 순, 프롬프트 전문 제외 — `GET /generation-runs/{id}`). 오너 수정 버전(G3 다시
 *   고르기·이전 버전 다시 고르기)은 자기 시도가 없어 바탕 버전 사슬의 시도를 보인다(P3-02 Proposed). `adopted` = 이 버전의
 *   선택본에 들었는지
 * - G3 선택(thumbnail_selection + image, `generationRunId`는 계산) · G3 유효(최신 gate_pass + 지문 재계산 — 후보 단위) ·
 *   `sameProductColorRequired`(앵커 키가 다르거나 색상 코드를 모르는 레퍼런스) · `candidateCount`(설정 후보 칸 수, P3-02 추가)
 */
@Injectable()
export class ThumbnailOutputService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: CandidateGuardService,
    private readonly api: StepEngineApi,
    private readonly settings: SettingsService,
    private readonly references: ThumbnailReferenceRepository,
    private readonly selections: ThumbnailSelectionRepository,
  ) {}

  async get(candidateId: number, rawQuery: Record<string, unknown>): Promise<ThumbnailOutputDto> {
    const query = parseThumbnailOutputQuery(rawQuery);
    const db = this.prisma;
    const candidate = await this.guard.findOr404(db, candidateId);
    const step = await db.candidateStep.findUnique({
      where: { candidateId_stepCode: { candidateId, stepCode: 'THUMBNAIL' } },
      select: { currentStepRunId: true },
    });
    const currentId = step?.currentStepRunId ?? null;
    let runId: number;
    if (query.stepRunId !== null) {
      const found = await db.stepRun.findUnique({ where: { id: query.stepRunId } });
      if (!found || found.candidateId !== candidateId || found.stepCode !== 'THUMBNAIL') {
        throw new ApiException('STEP_RUN_NOT_FOUND', { details: { stepRunId: query.stepRunId } });
      }
      runId = found.id;
    } else {
      if (currentId === null) throw thumbnailOutputNotFound();
      runId = currentId;
    }
    const run = await db.stepRun.findUniqueOrThrow({ where: { id: runId } });
    const [refs, selection, sourceRunId, g3] = await Promise.all([
      this.references.referencesOf(db, run.id),
      this.selections.selectionOf(db, run.id),
      this.selections.generationSourceRunId(db, run.id),
      this.api.gateState(candidateId, 'G3', db),
    ]);
    const generationRuns = await this.selections.generationRunsOf(db, sourceRunId);
    const selected = new Set(selection?.images.map((image) => image.imageAssetId) ?? []);
    const runIdOfImage = await this.selections.generationRunIdsOf(db, [...selected]);
    return {
      stepRunId: run.id,
      candidateId,
      version: run.version,
      stepRunStatus: run.status as ThumbnailOutputDto['stepRunStatus'],
      isCurrent: currentId === run.id,
      references: refs.map((row) => toReferenceItem(row, candidate)),
      referencesConfirmed:
        refs.length >= REFERENCE_MIN &&
        refs.length <= REFERENCE_MAX &&
        refs.every((row) => row.noPersonConfirmedAt instanceof Date),
      candidateCount:
        this.settings.currentOrNull()?.thumbnail.candidateCount ?? DEFAULT_CANDIDATE_COUNT,
      generationRuns: generationRuns.map((row) =>
        toGenerationSummary(
          row,
          row.resultImageAssetId !== null && selected.has(row.resultImageAssetId),
        ),
      ),
      selection: selection
        ? {
            thumbnailSelectionId: selection.id,
            checklist: selection.checklist as unknown as ThumbnailG3ChecklistDto,
            sameProductColorConfirmedAt: selection.sameProductColorConfirmedAt
              ? selection.sameProductColorConfirmedAt.toISOString()
              : null,
            selectedAt: selection.selectedAt.toISOString(),
            images: selection.images.map((image) => ({
              imageAssetId: image.imageAssetId,
              generationRunId: runIdOfImage.get(image.imageAssetId) ?? null,
              role: image.role as 'REPRESENTATIVE' | 'ADDITIONAL',
              sortOrder: image.sortOrder,
              fileUrl: imageAssetFileUrl(image.imageAssetId),
            })),
          }
        : null,
      g3: {
        gatePassId: g3.gatePassId,
        passedAt: g3.passedAt ? g3.passedAt.toISOString() : null,
        basisStepRunId: g3.basisStepRunId,
        valid: g3.valid,
        changedBasisKeys: g3.changedBasisKeys,
      },
      sameProductColorRequired: sameProductColorRequired(refs, candidate),
    };
  }
}
