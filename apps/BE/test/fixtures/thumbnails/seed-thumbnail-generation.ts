import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { ImageAssetsService } from '../../../src/common/files/image-assets.service.js';
import type { ImageAsset } from '../../../src/generated/prisma/client.js';
import type { FakeImageGenScenario } from '../../../src/modules/integrations/image-gen/fake-image-gen.provider.js';
import type { TestApp } from '../../helpers/test-app.js';
import {
  THUMBNAIL_FIXTURE_DIR,
  thumbnailImageBytes,
  type ThumbnailWaitingSeed,
} from './seed-thumbnail-waiting.js';

/**
 * ⑤ 썸네일 생성·G3 e2e fixture(P3-02 §5.3). P3-01 `seed-thumbnail-waiting.ts`를 다시 쓰고 다음을 더한다:
 * - 가짜 공급자 대본(`fake-provider-scenarios.json` → `FakeImageGenScenario`, 이미지는 `generated/`의 작은 실제 PNG)
 * - 같은 itemCode의 다른 앵커 키 원본(型番이 다른 `source_model_code_norm`)과 색상 코드 없는 원본(G3 '같은 상품·색상' 확인)
 * 실제 이미지 모델·이미지 CDN을 부르지 않는다.
 */

interface ScenarioFile {
  scenarios: Record<
    string,
    { kind: string; image?: string; fileName?: string; reason?: string; message?: string }
  >;
}

export type FakeScenarioName =
  'success' | 'success-png-named-jpg' | 'refused' | 'failed' | 'timeout';

/** 대본 이름 → 가짜 공급자 대본(이미지 파일은 바이트로 읽는다) */
export function fakeScenario(name: FakeScenarioName): FakeImageGenScenario {
  const file = JSON.parse(
    readFileSync(join(THUMBNAIL_FIXTURE_DIR, 'fake-provider-scenarios.json'), 'utf8'),
  ) as ScenarioFile;
  const raw = file.scenarios[name];
  if (!raw) throw new Error(`대본이 없습니다: ${name}`);
  switch (raw.kind) {
    case 'success':
      return {
        kind: 'success',
        bytes: raw.image ? readFileSync(join(THUMBNAIL_FIXTURE_DIR, raw.image)) : undefined,
        fileName: raw.fileName ?? null,
      };
    case 'refused':
      return { kind: 'refused', reason: raw.reason };
    case 'failed':
      return { kind: 'failed', message: raw.message };
    default:
      return { kind: 'timeout' };
  }
}

/** 다른 앵커 키 원본의 型番(후보 앵커 1201A019108과 다르다) */
export const OTHER_MODEL_CODE = '1201A999001';

/**
 * 같은 itemCode의 원본 두 장을 더한다(실제 파일 — 원본 저장 규칙 그대로): 型番이 다른 원본(`other`, 색상 108)과 색상 코드 없는
 * 원본(`noColor`, 型番은 후보와 같다). 둘 다 레퍼런스로 고를 수 있고, 고르면 G3에서 '같은 상품·색상' 확인이 필요하다.
 */
export async function addExtraOriginals(
  t: TestApp,
  seed: ThumbnailWaitingSeed,
): Promise<{ other: ImageAsset; noColor: ImageAsset }> {
  const images = t.app.get(ImageAssetsService);
  const base = {
    kind: 'ORIGINAL' as const,
    sourceSection: 'PRODUCT_IMAGE' as const,
    sourceItemCode: seed.itemCode,
    sourceShopCode: seed.itemCode.split(':')[0]!,
    collectedAt: new Date('2026-09-28T05:02:00Z'),
  };
  const other = await images.saveImage(thumbnailImageBytes('other-model.jpg'), {
    ...base,
    sourceUrl: 'https://tshop.r10s.jp/shop-a/cabinet/item/other-model.jpg',
    sourceModelCodeNorm: OTHER_MODEL_CODE,
    sourceColorCode: '108',
  });
  const noColor = await images.saveImage(thumbnailImageBytes('no-color.jpg'), {
    ...base,
    sourceUrl: 'https://tshop.r10s.jp/shop-a/cabinet/item/no-color.jpg',
    sourceModelCodeNorm: '1201A019108',
    sourceColorCode: null,
  });
  return { other, noColor };
}

/** 레퍼런스 저장('사람·얼굴 없음' 확인 — P3-01 API). 200이 아니면 던진다 */
export async function confirmReferences(
  t: TestApp,
  stepRunId: number,
  imageAssetIds: readonly number[],
): Promise<void> {
  const res = await request(t.app.getHttpServer())
    .put(`/api/v1/step-runs/${stepRunId}/thumbnail-references`)
    .set('X-AutoStore-Client', '1')
    .send({
      references: imageAssetIds.map((imageAssetId, i) => ({ imageAssetId, sortOrder: i + 1 })),
      noPersonConfirmed: true,
    });
  if (res.status !== 200) {
    throw new Error(`레퍼런스 저장이 200이 아닙니다: ${res.status} ${JSON.stringify(res.body)}`);
  }
}

/** G3 체크리스트 7개 모두 true */
export function fullChecklist(): Record<string, boolean> {
  return {
    shoeRatioOver70: true,
    detailMatch: true,
    colorMatchesSelectedColor: true,
    referenceNoPerson: true,
    noRealPersonResemblance: true,
    noTextOrPrice: true,
    singleProductSingleModel: true,
  };
}

/** 생성 결과 이미지 파일 바이트(`generated/`) */
export function generatedImageBytes(name: 'slot-1.png' | 'slot-2.jpg'): Buffer {
  return readFileSync(join(THUMBNAIL_FIXTURE_DIR, 'generated', name));
}
