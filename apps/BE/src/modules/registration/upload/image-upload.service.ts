import { Inject, Injectable } from '@nestjs/common';
import { ImageAssetsService } from '../../../common/files/image-assets.service.js';
import type { ImageAsset, UploadedImage } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import {
  COMMERCE_IMAGES_PORT,
  type CommerceImagesPort,
  type CommerceUploadFile,
} from '../../integrations/naver-commerce/commerce-images.port.js';
import { normalizeForUpload } from './image-normalizer.js';
import { DEFAULT_BATCH_LIMITS, splitUploadBatches, type BatchLimits } from './upload-batcher.js';
import { UploadQueue } from './upload-queue.js';

/** 올릴 G3 선택본 한 장(원천 = AI 생성본) */
export interface UploadSource {
  imageAssetId: number;
  sortOrder: number;
  role: 'REPRESENTATIVE' | 'ADDITIONAL';
}

/** 선택본 한 장의 업로드 결과 */
export interface UploadedSelectionImage {
  sortOrder: number;
  role: 'REPRESENTATIVE' | 'ADDITIONAL';
  uploadedImageId: number;
  url: string;
  /** 원천 파일 SHA-256(재사용 키) */
  sourceSha256: string;
  /** 올린 1000×1000 JPEG 정규화본(image_asset kind=UPLOAD) */
  uploadImageAssetId: number;
  traceId: string | null;
  uploadedAt: Date;
  /** 이 호출 전에 이미 올린 URL을 다시 썼는가 */
  reused: boolean;
}

export interface UploadCallContext {
  candidateId: number;
  stepRunId: number;
}

/** 참조 전용(원본·레퍼런스) 파일이나 그런 파일에서 만든 파일을 올리려 함 — 외부 호출 전에 거부한다(F-BS-45) */
export class ImageNotAllowedError extends Error {
  readonly reason = 'REFERENCE_ONLY' as const;

  constructor(readonly imageAssetIds: number[]) {
    super(`참조 전용 이미지는 올리지 않습니다(image_asset ${imageAssetIds.join(', ')})`);
    this.name = 'ImageNotAllowedError';
  }
}

/** 선택본에 없는 이미지(행 없음) */
export class UploadSourceMissingError extends Error {
  constructor(readonly imageAssetIds: number[]) {
    super(`업로드할 이미지 행이 없습니다(image_asset ${imageAssetIds.join(', ')})`);
    this.name = 'UploadSourceMissingError';
  }
}

/** 파생 사슬을 거슬러 올라갈 최대 단계(UPLOAD → GENERATED 한 단계면 충분하다 — 잘못된 사슬의 끝없는 반복 방지) */
const LINEAGE_MAX_DEPTH = 8;
/** uploaded_image.trace_id varchar(100) */
const TRACE_ID_MAX = 100;

/** 정규화본 하나(같은 원천 해시는 한 번만) */
interface PendingUpload {
  sourceSha256: string;
  asset: ImageAsset;
  byteSize: number;
  bytes: Buffer;
}

/**
 * ⑧ 이미지 업로드(P4-01 §5 `image-upload.service.ts`, F-AP-01~05·F-BS-45, 규칙 4~8·14). 순서:
 * 1. **참조 전용 거부(첫 줄)**: 원천과 그 파생 사슬에 `usage_right='REFERENCE_ONLY'`(원본·레퍼런스)가 하나라도 있으면 외부 호출 전에
 *    `ImageNotAllowedError`. 끄는 설정은 없다.
 * 2. 해시 재사용: 원천 `sha256`로 `uploaded_image.source_sha256`을 찾아 있으면 그 URL을 쓴다(후보·버전이 달라도).
 * 3. 정규화: 없는 해시만 1000×1000 JPEG로 바꿔 `image_asset`(UPLOAD·PERMITTED·derived_from = 원천·candidate_id)으로 저장한다
 *    (앞 실행이 만들고 올리지 못한 정규화본이 있으면 다시 쓴다).
 * 4. 묶음 업로드: 앱 전체 직렬 큐(`UploadQueue`) 안에서 해시를 다시 확인하고(다른 후보의 ⑧이 막 올렸을 수 있다), 10장·10MB
 *    미만으로 나눠 차례로 보낸다.
 * 5. `uploaded_image` 저장: **묶음마다 곧바로** 커밋한다(Proposed — 뒤 묶음이 실패해도 앞 묶음 URL은 남겨, 다시 실행하면 그 파일은
 *    다시 올리지 않는다. `uploaded_image`는 산출물이 아니라 해시 캐시라 산출물 불변 규칙과 부딪히지 않는다).
 * 업로드 실패(포트 예외 — 502 EXTERNAL_API_ERROR·COMMERCE_AUTH_FAILED·409 SECRET_NOT_CONFIGURED 등)는 그대로 던진다(실행기가
 * ⑧ FAILED로 바꾼다).
 */
@Injectable()
export class ImageUploadService {
  /** 묶음 상한(테스트가 바꿀 수 있다 — 운영은 10장·10MB 미만) */
  batchLimits: BatchLimits = DEFAULT_BATCH_LIMITS;

  constructor(
    private readonly prisma: PrismaService,
    private readonly images: ImageAssetsService,
    private readonly queue: UploadQueue,
    @Inject(COMMERCE_IMAGES_PORT) private readonly port: CommerceImagesPort,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async uploadSelection(
    sources: readonly UploadSource[],
    ctx: UploadCallContext,
  ): Promise<UploadedSelectionImage[]> {
    const assets = await this.assertNotReferenceOnly(sources);
    const shaOf = (source: UploadSource) => assets.get(source.imageAssetId)!.sha256;
    const shas = [...new Set(sources.map(shaOf))];
    const reusedShas = new Set((await this.cachedBySha(shas)).keys());

    // 정규화(큐 밖 — 로컬 일만 한다). 같은 원천 해시는 첫 장 하나만
    const pending: PendingUpload[] = [];
    for (const sha of shas.filter((s) => !reusedShas.has(s))) {
      const source = sources.find((s) => shaOf(s) === sha)!;
      pending.push(await this.normalized(assets.get(source.imageAssetId)!, ctx.candidateId));
    }

    if (pending.length > 0) {
      await this.queue.run(async () => {
        // 줄을 기다리는 동안 다른 ⑧이 같은 해시를 올렸을 수 있다 — 다시 보고 빼낸다
        const already = await this.cachedBySha(pending.map((p) => p.sourceSha256));
        const toSend = pending.filter((p) => !already.has(p.sourceSha256));
        for (const batch of splitUploadBatches(toSend, this.batchLimits)) {
          const files: CommerceUploadFile[] = batch.map((p, i) => ({
            fileName: `upload-${i + 1}.jpg`,
            mimeType: 'image/jpeg',
            bytes: p.bytes,
          }));
          const result = await this.port.uploadProductImages(files, ctx);
          const uploadedAt = this.clock.now();
          const traceId = result.traceId ? result.traceId.slice(0, TRACE_ID_MAX) : null;
          await this.prisma.$transaction(async (tx) => {
            for (const [i, p] of batch.entries()) {
              await tx.uploadedImage.create({
                data: {
                  sourceSha256: p.sourceSha256,
                  imageAssetId: p.asset.id,
                  url: result.urls[i]!,
                  traceId,
                  uploadedAt,
                },
              });
            }
          });
        }
      });
    }

    const rows = await this.cachedBySha(shas);
    return sources.map((source) => {
      const sha = shaOf(source);
      const row = rows.get(sha);
      if (!row) throw new Error(`업로드 기록이 없습니다(${sha})`);
      return {
        sortOrder: source.sortOrder,
        role: source.role,
        uploadedImageId: row.id,
        url: row.url,
        sourceSha256: sha,
        uploadImageAssetId: row.imageAssetId,
        traceId: row.traceId,
        uploadedAt: row.uploadedAt,
        reused: reusedShas.has(sha),
      };
    });
  }

  /**
   * 참조 전용 거부(F-BS-45, 규칙 5): 원천 행과 그 파생 사슬(`derived_from_image_asset_id`)에 참조 전용이 있으면 던진다. 원천 행을
   * id → 행으로 돌려준다. 없는 행이면 `UploadSourceMissingError`
   */
  private async assertNotReferenceOnly(
    sources: readonly UploadSource[],
  ): Promise<Map<number, ImageAsset>> {
    const ids = [...new Set(sources.map((s) => s.imageAssetId))];
    const rows = await this.prisma.imageAsset.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new UploadSourceMissingError(missing);

    const known = new Map(byId);
    let frontier = rows;
    for (let depth = 0; depth < LINEAGE_MAX_DEPTH && frontier.length > 0; depth += 1) {
      const parentIds = frontier
        .map((row) => row.derivedFromImageAssetId)
        .filter((id): id is number => id !== null && !known.has(id));
      if (parentIds.length === 0) break;
      frontier = await this.prisma.imageAsset.findMany({ where: { id: { in: parentIds } } });
      for (const row of frontier) known.set(row.id, row);
    }
    const blocked = ids.filter((id) => this.lineageReferenceOnly(id, known));
    if (blocked.length > 0) throw new ImageNotAllowedError(blocked);
    return byId;
  }

  private lineageReferenceOnly(id: number, known: Map<number, ImageAsset>): boolean {
    let row = known.get(id);
    for (let depth = 0; row && depth <= LINEAGE_MAX_DEPTH; depth += 1) {
      if (
        row.usageRight === 'REFERENCE_ONLY' ||
        row.kind === 'ORIGINAL' ||
        row.kind === 'REFERENCE'
      ) {
        return true;
      }
      row =
        row.derivedFromImageAssetId === null ? undefined : known.get(row.derivedFromImageAssetId);
    }
    return false;
  }

  private async cachedBySha(shas: readonly string[]): Promise<Map<string, UploadedImage>> {
    if (shas.length === 0) return new Map();
    const rows = await this.prisma.uploadedImage.findMany({
      where: { sourceSha256: { in: [...shas] } },
    });
    return new Map(rows.map((row) => [row.sourceSha256, row]));
  }

  /** 원천 → 정규화본(앞 실행이 만들고 아직 올리지 못한 정규화본이 있으면 그 행을 다시 쓴다) */
  private async normalized(source: ImageAsset, candidateId: number): Promise<PendingUpload> {
    const previous = await this.prisma.imageAsset.findFirst({
      where: { kind: 'UPLOAD', derivedFromImageAssetId: source.id, uploadedImage: null },
      orderBy: { id: 'desc' },
    });
    if (previous) {
      const { buffer } = await this.images.readFile(previous.id);
      return {
        sourceSha256: source.sha256,
        asset: previous,
        byteSize: buffer.length,
        bytes: buffer,
      };
    }
    const { buffer } = await this.images.readFile(source.id);
    const image = await normalizeForUpload(buffer);
    const asset = await this.images.saveImage(image.buffer, {
      kind: 'UPLOAD',
      usageRight: 'PERMITTED',
      candidateId,
      derivedFromImageAssetId: source.id,
    });
    return {
      sourceSha256: source.sha256,
      asset,
      byteSize: image.byteSize,
      bytes: image.buffer,
    };
  }
}
