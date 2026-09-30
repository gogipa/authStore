import { Injectable } from '@nestjs/common';
import type { Candidate } from '../../../generated/prisma/client.js';
import type { StepEngineTx } from '../../step-engine/candidates/step-engine-tx.js';
import {
  g3Basis,
  GateBasisFor,
  type GateBasis,
  type GateBasisProvider,
  type GateBlocker,
  type GatePassEffect,
} from '../../step-engine/contracts/gate-basis.js';
import type { StepOutcome, Tx } from '../../step-engine/contracts/step-runner.js';
import { StepEngineApi } from '../../step-engine/step-engine.api.js';
import { ThumbnailReferenceRepository } from '../references/thumbnail-reference.repository.js';
import { sameProductColorRequired } from '../references/thumbnail-references.service.js';
import {
  checklistSnapshot,
  selectionImagesOf,
  selectionSetSha256,
  type ThumbnailSelectionOutput,
} from '../selection/thumbnail-selection.js';
import { ThumbnailSelectionRepository } from '../selection/thumbnail-selection.repository.js';
import {
  assertChecklistShape,
  checkG3Selection,
  g3BodyOf,
  generationInProgressBlocker,
  type G3ImageFact,
  type G3PassBody,
} from './g3-rules.js';

/**
 * G3 썸네일 선택 공급자(P3-02 §5.1 `g3-gate.handler.ts`, F-TH-14~17, P1-06 게이트 규약). step-engine `GateService`가
 * `gateCode=G3`일 때 부른다(`@GateBasisFor('G3')` — DiscoveryService로 모은다. 호출 방향은 step-engine → thumbnails만).
 * - 지문 구성값(`g3Basis`, PRD §5.1): 레퍼런스 파일 SHA-256(⑤ 버전의 `thumbnail_reference`) + 선택본 해시
 *   (`selectionSetSha256` — 대표 + 추가 전체·순서, P3-02 Proposed) + 후보 앵커 키. `basis`(저장된 선택)와 `passBasis`(요청 선택)가
 *   같은 함수를 쓴다
 * - 막힌 이유(`checkG3Selection`): 체크리스트 → 추가 9장 → 없는 이미지 → 원본·다른 실행 생성본 → '같은 상품·색상' → 생성 중
 * - 통과(`onPass`, 같은 트랜잭션): ⑤ 입력 대기면 그 버전을 G3 선택 결과로 끝낸다(`resumeWaiting({ outcome, scope })` — 실행기
 *   `persist`가 닫기 전에 `thumbnail_selection`(+image)을 쓴다). ⑤가 완료면 OWNER_EDIT 새 버전을 열어(`recordOwnerEditRun`)
 *   레퍼런스를 복사하고 새 선택으로 닫는다(05-2 x-decision §7.4-31). 새 버전 완료는 ⑤를 직접 읽는 ⑧만 재실행 필요로 만든다
 */
@GateBasisFor('G3')
@Injectable()
export class ThumbnailG3GateBasis implements GateBasisProvider {
  readonly gate = 'G3' as const;

  constructor(
    private readonly api: StepEngineApi,
    private readonly references: ThumbnailReferenceRepository,
    private readonly selections: ThumbnailSelectionRepository,
  ) {}

  private candidateOf(tx: Tx, candidateId: number): Promise<Candidate> {
    return tx.candidate.findUniqueOrThrow({ where: { id: candidateId } });
  }

  private anchorKeyOf(candidate: Candidate) {
    return {
      modelCode: candidate.anchorModelCode,
      itemCode: candidate.anchorItemCode,
      colorCode: candidate.anchorColorCode,
    };
  }

  private async referenceHashes(tx: Tx, stepRunId: number): Promise<string[]> {
    const rows = await this.references.referencesOf(tx, stepRunId);
    return rows.map((row) => row.imageAsset.sha256);
  }

  async basis(tx: Tx, candidateId: number, basisStepRunId: number): Promise<GateBasis> {
    const candidate = await this.candidateOf(tx, candidateId);
    const selection = await this.selections.selectionOf(tx, basisStepRunId);
    return g3Basis({
      referenceHashes: await this.referenceHashes(tx, basisStepRunId),
      selectedHash: selection
        ? selectionSetSha256(
            selection.images.map((image) => ({
              sortOrder: image.sortOrder,
              sha256: image.imageAsset.sha256,
            })),
          )
        : null,
      anchorKey: this.anchorKeyOf(candidate),
    });
  }

  async passBasis(
    tx: Tx,
    candidateId: number,
    basisStepRunId: number,
    body: unknown,
  ): Promise<GateBasis> {
    const candidate = await this.candidateOf(tx, candidateId);
    const g3 = g3BodyOf(body);
    const images = selectionImagesOf(g3.representativeImageAssetId, g3.additionalImageAssetIds);
    const assets = await tx.imageAsset.findMany({
      where: { id: { in: images.map((image) => image.imageAssetId) } },
      select: { id: true, sha256: true },
    });
    const shaOf = new Map(assets.map((asset) => [asset.id, asset.sha256]));
    return g3Basis({
      referenceHashes: await this.referenceHashes(tx, basisStepRunId),
      selectedHash: selectionSetSha256(
        images.map((image) => ({
          sortOrder: image.sortOrder,
          sha256: shaOf.get(image.imageAssetId) ?? '',
        })),
      ),
      anchorKey: this.anchorKeyOf(candidate),
    });
  }

  async blockers(
    tx: Tx,
    candidateId: number,
    basisStepRunId: number,
    body: unknown,
  ): Promise<GateBlocker[]> {
    const sourceRunId = await this.selections.generationSourceRunId(tx, basisStepRunId);
    const running = (await this.selections.runningOf(tx, sourceRunId)).length;
    if (body === null || body === undefined) {
      return running > 0 ? [generationInProgressBlocker(running)] : [];
    }
    const g3 = g3BodyOf(body);
    assertChecklistShape(g3.checklist);
    const candidate = await this.candidateOf(tx, candidateId);
    const refs = await this.references.referencesOf(tx, basisStepRunId);
    return checkG3Selection({
      body: g3,
      images: await this.imageFacts(tx, sourceRunId, g3),
      sameProductColorRequired: sameProductColorRequired(refs, candidate),
      runningGenerations: running,
    });
  }

  /** 고른 이미지마다: 있는지·종류·이 ⑤ 버전(생성 시도를 가진 버전)의 SUCCEEDED 결과인지 */
  private async imageFacts(tx: Tx, sourceRunId: number, g3: G3PassBody): Promise<G3ImageFact[]> {
    const ids = [g3.representativeImageAssetId, ...g3.additionalImageAssetIds];
    const [assets, results] = await Promise.all([
      tx.imageAsset.findMany({ where: { id: { in: ids } }, select: { id: true, kind: true } }),
      tx.generationRun.findMany({
        where: { stepRunId: sourceRunId, status: 'SUCCEEDED', resultImageAssetId: { in: ids } },
        select: { resultImageAssetId: true },
      }),
    ]);
    const kindOf = new Map(assets.map((asset) => [asset.id, asset.kind]));
    const ours = new Set(results.map((row) => row.resultImageAssetId));
    return ids.map((imageAssetId) => ({
      imageAssetId,
      kind: kindOf.get(imageAssetId) ?? null,
      fromThisRun: ours.has(imageAssetId),
    }));
  }

  async onPass(
    scope: StepEngineTx,
    candidateId: number,
    _gatePassId: number,
    body: unknown,
  ): Promise<GatePassEffect> {
    const g3 = g3BodyOf(body);
    const base = await scope.tx.stepRun.findUniqueOrThrow({ where: { id: g3.basisStepRunId } });
    const output: ThumbnailSelectionOutput = {
      kind: 'THUMBNAIL_SELECTION',
      checklist: checklistSnapshot(),
      sameProductColorConfirmedAt: g3.sameProductColorConfirmed ? scope.now : null,
      selectedAt: scope.now,
      images: selectionImagesOf(g3.representativeImageAssetId, g3.additionalImageAssetIds),
    };
    const outcome: StepOutcome = { kind: 'COMPLETED', output };
    let thumbnailStepRunId: number;
    if (base.status === 'WAITING_INPUT') {
      await this.api.resumeWaiting(base.id, { outcome, scope });
      thumbnailStepRunId = base.id;
    } else {
      const run = await this.api.recordOwnerEditRun(
        scope,
        candidateId,
        'THUMBNAIL',
        base.id,
        async (created) => {
          await this.references.copyReferences(scope.tx, base.id, created.id);
          return outcome;
        },
      );
      thumbnailStepRunId = run.id;
    }
    const selection = await this.selections.selectionOf(scope.tx, thumbnailStepRunId);
    return { thumbnailSelectionId: selection?.id ?? null, thumbnailStepRunId };
  }
}
