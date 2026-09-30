import { Injectable } from '@nestjs/common';
import { UserActionLogService } from '../../../common/audit/user-action-log.service.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { formatErrorMessage } from '../../../common/errors/error-codes.js';
import { imageAssetFileUrl } from '../../../common/files/image-assets.service.js';
import type { Candidate, ImageAsset, StepRun } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CandidateGuardService } from '../../step-engine/candidates/candidate-guard.service.js';
import {
  StepEngineTransactions,
  type StepEngineTx,
} from '../../step-engine/candidates/step-engine-tx.js';
import { INPUT_KEYS } from '../../step-engine/domain/input-keys.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import type {
  ThumbnailReferenceItemDto,
  ThumbnailReferencesRequestDto,
  ThumbnailReferencesResultDto,
} from '../dto/thumbnail-references.dto.js';
import { anchorOf } from '../source-images/source-images.service.js';
import { isSameAnchor } from '../thumbnail-anchor.js';
import { GENERATION_JOB, REFERENCE_MAX, REFERENCE_MIN } from '../thumbnail-sources.js';
import {
  sameChoices,
  ThumbnailReferenceRepository,
  type ConfirmedReference,
  type ReferenceChoice,
  type ReferenceRowWithImage,
} from './thumbnail-reference.repository.js';

/** 레퍼런스가 될 수 없는 이유(IMAGE_NOT_ALLOWED `details.reason`·`{이유}`, P3-01 Proposed 문구) */
export const IMAGE_NOT_ALLOWED_REASONS = {
  NOT_ORIGINAL: '라쿠텐 원본 이미지만 레퍼런스로 고를 수 있습니다',
  NOT_PRODUCT_IMAGE: '설명 속 스펙표 이미지는 레퍼런스로 쓸 수 없습니다',
  OTHER_ITEM: '지금 ② 소싱 선택 상품의 원본이 아닙니다',
} as const;
export type ImageNotAllowedReason = keyof typeof IMAGE_NOT_ALLOWED_REASONS;

/** ⑤ 실행 기록이 아님(422 INVALID_STEP_CODE) */
export function notThumbnailRun(run: Pick<StepRun, 'stepCode'>): ApiException {
  return new ApiException('INVALID_STEP_CODE', {
    details: { stepCode: run.stepCode, reason: 'NOT_THUMBNAIL' },
  });
}

/** 개수(1~3) → 순서 범위(1~3)·겹침 검사 — 순서 오름차순으로 돌려준다 */
export function validateChoices(references: readonly ReferenceChoice[]): ReferenceChoice[] {
  if (references.length < REFERENCE_MIN || references.length > REFERENCE_MAX) {
    throw new ApiException('IMAGE_COUNT_INVALID', {
      details: { count: references.length, min: REFERENCE_MIN, max: REFERENCE_MAX },
    });
  }
  const outOfRange = references.find((r) => r.sortOrder < 1 || r.sortOrder > REFERENCE_MAX);
  if (outOfRange) {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [{ field: 'references.sortOrder', message: '1~3이어야 합니다.' }],
    });
  }
  const ids = new Set(references.map((r) => r.imageAssetId));
  const orders = new Set(references.map((r) => r.sortOrder));
  if (ids.size !== references.length || orders.size !== references.length) {
    throw new ApiException('VALIDATION_FAILED', {
      fieldErrors: [
        {
          field: 'references',
          message: '같은 이미지나 같은 순서를 두 번 넣을 수 없습니다.',
        },
      ],
    });
  }
  return [...references]
    .map((r) => ({ imageAssetId: r.imageAssetId, sortOrder: r.sortOrder }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/** 이 이미지를 레퍼런스로 쓸 수 없는 이유. 쓸 수 있으면 null(P3-01 규칙 7) */
export function referenceBlockReason(
  image: ImageAsset,
  itemCode: string | null,
): ImageNotAllowedReason | null {
  if (image.kind !== 'ORIGINAL') return 'NOT_ORIGINAL';
  if (image.sourceSection !== 'PRODUCT_IMAGE') return 'NOT_PRODUCT_IMAGE';
  if (itemCode === null || image.sourceItemCode !== itemCode) return 'OTHER_ITEM';
  return null;
}

/** 버전의 레퍼런스 행 → 05-2 ThumbnailReferenceItem */
export function toReferenceItem(
  row: ReferenceRowWithImage,
  candidate: Candidate,
): ThumbnailReferenceItemDto {
  return {
    id: row.id,
    imageAssetId: row.imageAssetId,
    sortOrder: row.sortOrder,
    noPersonConfirmedAt: row.noPersonConfirmedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    isSameAnchor: isSameAnchor(anchorOf(candidate), row.imageAsset),
    fileUrl: imageAssetFileUrl(row.imageAssetId),
  };
}

/**
 * 레퍼런스 컷 고르기와 '사람·얼굴 없음' 확인(05-2 `putThumbnailReferences`, F-TH-04·05, P3-01 규칙 7~10).
 * 검사 순서(Proposed): 실행 없음 404 `STEP_RUN_NOT_FOUND` → ⑤ 아님 422 `INVALID_STEP_CODE` → 1~3장 아님 422
 * `IMAGE_COUNT_INVALID`(겹침은 `VALIDATION_FAILED`) → 확인 없음 422 `NO_PERSON_CONFIRMATION_REQUIRED` → (후보 행 잠금) 잠김·제외
 * 409 → 입력 대기인 현재 버전 아님 409 `STEP_RUN_NOT_WAITING_INPUT`(완료된 ⑤는 다시 실행으로만 바꾼다) → 생성 중 409
 * `ALREADY_IN_PROGRESS`(details.job=GENERATION) → 없는 이미지 404 `IMAGE_ASSET_NOT_FOUND` → 쓸 수 없는 이미지 422
 * `IMAGE_NOT_ALLOWED`(details.reason).
 * 저장은 한 트랜잭션(규칙 8): `thumbnail_reference_input` 새 `input_no`(max + 1, 확인 시각 = 지금) → 열린 ⑤의
 * `thumbnail_reference`를 이 선택으로 교체 → `step_run_input` `owner.referenceSelection` 해시 갱신(step-engine
 * `refreshWaitingRunInputs`) → 감사 기록(OWNER_CONFIRMED). 최신 선택과 같은 선택이면 새 입력 행 없이 200(PUT 멱등).
 * '사람·얼굴 없음' 확인은 웹 화면 요청으로만 들어온다(Origin·`X-AutoStore-Client` 가드 — 05-1 §1.2).
 */
@Injectable()
export class ThumbnailReferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: StepEngineTransactions,
    private readonly guard: CandidateGuardService,
    private readonly api: StepEngineApi,
    private readonly references: ThumbnailReferenceRepository,
    private readonly audit: UserActionLogService,
  ) {}

  async put(
    stepRunId: number,
    body: ThumbnailReferencesRequestDto,
  ): Promise<ThumbnailReferencesResultDto> {
    const run = await this.prisma.stepRun.findUnique({ where: { id: stepRunId } });
    if (!run) throw new ApiException('STEP_RUN_NOT_FOUND');
    if (run.stepCode !== 'THUMBNAIL') throw notThumbnailRun(run);
    const choices = validateChoices(body.references);
    if (body.noPersonConfirmed !== true) throw new ApiException('NO_PERSON_CONFIRMATION_REQUIRED');
    return this.transactions.run((scope) => this.putInScope(scope, run, choices));
  }

  private async putInScope(
    scope: StepEngineTx,
    run: StepRun,
    choices: ReferenceChoice[],
  ): Promise<ThumbnailReferencesResultDto> {
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
    if ((await this.references.runningGenerationCount(scope.tx, run.id)) > 0) {
      throw new ApiException('ALREADY_IN_PROGRESS', {
        message: formatErrorMessage('ALREADY_IN_PROGRESS', { 작업: '썸네일 생성' }),
        details: { job: GENERATION_JOB },
      });
    }

    const assets = await scope.tx.imageAsset.findMany({
      where: { id: { in: choices.map((c) => c.imageAssetId) } },
    });
    const byId = new Map(assets.map((a) => [a.id, a]));
    for (const choice of choices) {
      if (!byId.has(choice.imageAssetId)) {
        throw new ApiException('IMAGE_ASSET_NOT_FOUND', {
          details: { imageAssetId: choice.imageAssetId },
        });
      }
    }
    for (const choice of choices) {
      const reason = referenceBlockReason(byId.get(choice.imageAssetId)!, candidate.itemCode);
      if (reason) {
        throw new ApiException('IMAGE_NOT_ALLOWED', {
          message: formatErrorMessage('IMAGE_NOT_ALLOWED', {
            이유: IMAGE_NOT_ALLOWED_REASONS[reason],
          }),
          details: { imageAssetId: choice.imageAssetId, reason },
        });
      }
    }

    // 최신 선택과 같으면 새 입력 행을 만들지 않는다(PUT 멱등, 규칙 8)
    const latest = await this.references.latestInput(scope.tx, candidate.id);
    let inputNo: number;
    let confirmed: ConfirmedReference[];
    const created = !(latest && sameChoices(latest.rows, choices));
    if (!created && latest) {
      inputNo = latest.inputNo;
      confirmed = latest.rows.map((row) => ({
        imageAssetId: row.imageAssetId,
        sortOrder: row.sortOrder,
        noPersonConfirmedAt: row.noPersonConfirmedAt,
      }));
    } else {
      inputNo = (latest?.inputNo ?? 0) + 1;
      await this.references.insertInput(scope.tx, candidate.id, inputNo, choices, scope.now);
      confirmed = choices.map((c) => ({ ...c, noPersonConfirmedAt: scope.now }));
    }

    const current = await this.references.referencesOf(scope.tx, run.id);
    const sameAsCurrent =
      sameChoices(current, confirmed) &&
      current.every(
        (row) =>
          row.noPersonConfirmedAt.getTime() ===
          confirmed.find((c) => c.imageAssetId === row.imageAssetId)?.noPersonConfirmedAt.getTime(),
      );
    if (!sameAsCurrent) {
      await this.references.replaceReferences(scope.tx, run.id, confirmed, scope.now);
    }
    await this.api.refreshWaitingRunInputs(scope, run.id, [INPUT_KEYS.ownerReferenceSelection]);
    if (created) {
      await this.audit.record(
        {
          eventType: 'OWNER_CONFIRMED',
          candidateId: candidate.id,
          stepRunId: run.id,
          stepCode: 'THUMBNAIL',
          detail: {
            confirmation: 'NO_PERSON_IN_REFERENCES',
            inputNo,
            imageAssetIds: choices.map((c) => c.imageAssetId),
          },
          occurredAt: scope.now,
        },
        scope.tx,
      );
    }

    const rows = await this.references.referencesOf(scope.tx, run.id);
    const references = rows.map((row) => toReferenceItem(row, candidate));
    return {
      stepRunId: run.id,
      inputNo,
      references,
      sameProductColorRequired: references.some((r) => !r.isSameAnchor),
    };
  }
}
