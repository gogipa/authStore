import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import type { Candidate, ImageAsset } from '../../../src/generated/prisma/client.js';
import { DEFAULT_SETTINGS } from '../../../src/modules/settings/defaults/default-settings.js';
import type { AppSettings } from '../../../src/modules/settings/schema/settings.types.js';
import { StepExecutor } from '../../../src/modules/step-engine/execution/step-executor.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { truncate, type TestApp } from '../../helpers/test-app.js';
import { createCandidate } from '../step-engine/candidate.factory.js';
import { SOURCING_SNAPSHOT_TABLES, STEP_ENGINE_TABLES } from '../step-engine/truncate.js';

/**
 * ⑤ 썸네일 e2e fixture(P3-01 §5.3 — P3-02가 다시 쓴다). 합성 값(실제 상품 아님): 화면시안_명세 §4 후보 A의 ② 산출물
 * (`rakuten-item-asics-1201A019.json`)과 작은 실제 이미지(`images/`). 라쿠텐·이미지 CDN을 부르지 않는다 — 이미지는 가짜
 * fetch(`thumbnailFetchHandler`)가 파일로 답해 실제 어댑터·외부 호출 관문(허용 목록·call_log RAKUTEN_IMAGE)을 지난다.
 */

export const THUMBNAIL_FIXTURE_DIR = import.meta.dirname;

export interface ThumbnailItemFixture {
  rakutenItem: {
    itemCode: string;
    shopCode: string;
    shopName: string;
    itemName: string;
    itemUrl: string;
    modelCode: string;
    modelCodeNorm: string;
    collectedAt: string;
    genreId: number;
    genrePath: string;
    imageUrls: string[];
  };
  skus: {
    variantId: string;
    colorLabel: string;
    colorCode: string;
    sizeLabel: string;
    sizeMm: number;
  }[];
  anchor: { modelCode: string; colorCode: string; colorLabel: string };
  /** 이미지 URL → images/ 파일 이름 */
  imageFiles: Record<string, string>;
  apiSearchItem: Record<string, unknown> & { itemCode: string; mediumImageUrls: string[] };
}

export interface ThumbnailSettingsFixture {
  thumbnail: AppSettings['thumbnail'];
  personBlockWordsExtra: string[];
}

export function thumbnailItemFixture(): ThumbnailItemFixture {
  return JSON.parse(
    readFileSync(join(THUMBNAIL_FIXTURE_DIR, 'rakuten-item-asics-1201A019.json'), 'utf8'),
  ) as ThumbnailItemFixture;
}

export function thumbnailSettingsFixture(): ThumbnailSettingsFixture {
  return JSON.parse(
    readFileSync(join(THUMBNAIL_FIXTURE_DIR, 'settings-thumbnail.json'), 'utf8'),
  ) as ThumbnailSettingsFixture;
}

/** images/<이름>의 바이트 */
export function thumbnailImageBytes(name: string): Buffer {
  return readFileSync(join(THUMBNAIL_FIXTURE_DIR, 'images', name));
}

/**
 * 기본 템플릿 + ⑤ 설정 조각(골격) + 테스트용 차단어 추가분(설정 파일 글). `thumbnail`로 조각의 키를 바꾼다(P3-02 — 예: 생성
 * 타임아웃을 짧게)
 */
export function settingsWithThumbnail(thumbnail: Partial<AppSettings['thumbnail']> = {}): string {
  const fixture = thumbnailSettingsFixture();
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  settings.thumbnail = { ...fixture.thumbnail, ...thumbnail };
  settings.safety.personBlockWords = [
    ...settings.safety.personBlockWords,
    ...fixture.personBlockWordsExtra,
  ];
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/**
 * 가짜 fetch 처리 함수: 이미지 URL(fixture `imageFiles` + `extra`)이면 그 파일(200, Content-Type은 일부러 image/jpeg 고정 —
 * 형식은 내용으로 판별한다), 모르는 주소는 404. `status`로 특정 URL의 상태 코드를 바꾼다.
 */
export function thumbnailFetchHandler(
  options: { extra?: Record<string, string>; status?: Record<string, number> } = {},
): (url: string) => Response {
  const files = { ...thumbnailItemFixture().imageFiles, ...options.extra };
  return (url: string) => {
    const status = options.status?.[url];
    if (status !== undefined && status !== 200) {
      return new Response('error', { status, headers: { 'Content-Type': 'text/plain' } });
    }
    const name = files[url];
    if (!name) return new Response('Not Found', { status: 404 });
    return new Response(new Uint8Array(thumbnailImageBytes(name)), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg' },
    });
  };
}

export interface ThumbnailSourcingSeedInput {
  /** 소싱 선택 itemCode(기본 fixture shop-a:10000123) */
  itemCode?: string;
  /** 선택 상품의 media.images[](기본 fixture 6개). []이면 `_ex` 대체 경로 */
  imageUrls?: string[];
  /** 선택 색상(후보 selected_color — 같은 itemCode 후보를 둘 만들 때 바꾼다) */
  selectedColor?: string;
  /** 후보 상태(기본 WORKING) */
  status?: 'WORKING' | 'EXCLUDED';
}

export interface ThumbnailSourcingSeed {
  candidate: Candidate;
  sourcingStepRunId: number;
  rakutenItemId: number;
  itemCode: string;
}

let seq = 0;

/**
 * 후보 + ② 완료 버전('URL로 만들기' 모양 — 고른 상품 `rakuten_item`·SKU·비교표 머리 행)을 DB에 직접 만든다. 앵커 키 =
 * 型番 1201A019108 + 색상 108(fixture). ⑤는 아직 실행하지 않는다.
 */
export async function seedThumbnailSourcing(
  prisma: PrismaService,
  input: ThumbnailSourcingSeedInput = {},
): Promise<ThumbnailSourcingSeed> {
  seq += 1;
  const fixture = thumbnailItemFixture();
  const item = fixture.rakutenItem;
  const itemCode = input.itemCode ?? item.itemCode;
  const [shopCode, itemId] = itemCode.split(':') as [string, string];
  const itemUrl = `https://item.rakuten.co.jp/${shopCode}/${itemId}/`;
  const { candidate, stepRunIds } = await createCandidate(prisma, {
    status: input.status ?? 'WORKING',
    creationPath: 'RAKUTEN_URL',
    sourceUrl: itemUrl,
    anchor: { modelCode: fixture.anchor.modelCode, colorCode: fixture.anchor.colorCode },
    itemCode,
    selectedColor: input.selectedColor ?? `크림/블랙${seq > 1 ? ` ${seq}` : ''}`,
    gender: 'MALE',
    steps: { SOURCING: 'COMPLETED' },
  });
  const sourcingStepRunId = stepRunIds.SOURCING!;
  const rakutenItem = await prisma.rakutenItem.create({
    data: {
      itemCode,
      shopCode,
      shopName: item.shopName,
      itemName: item.itemName,
      itemUrl,
      modelCode: item.modelCode,
      modelCodeNorm: item.modelCodeNorm,
      entrySource: 'MANUAL',
      fetchReason: 'URL_ENTRY',
      collectedAt: new Date(item.collectedAt),
      genreId: item.genreId,
      genreSource: 'PAGE_JSON',
      genrePath: item.genrePath,
      backOrderFlag: false,
      imageUrls: input.imageUrls ?? item.imageUrls,
    },
  });
  await prisma.rakutenSku.createMany({
    data: fixture.skus.map((sku) => ({
      rakutenItemId: rakutenItem.id,
      variantId: sku.variantId,
      colorLabel: sku.colorLabel,
      colorCode: sku.colorCode,
      sizeLabel: sku.sizeLabel,
      sizeMm: sku.sizeMm,
      taxIncludedPriceYen: 12000,
      quantity: 3,
      selectorValues: {},
    })),
  });
  await prisma.sourcingComparison.create({
    data: {
      stepRunId: sourcingStepRunId,
      action: 'URL_CREATE',
      sourceUrl: itemUrl,
      anchorInputMethod: 'URL_ITEM',
      anchorItemCode: itemCode,
      anchorColorCode: fixture.anchor.colorCode,
      anchorColorLabel: fixture.anchor.colorLabel,
      comparisonPerformed: false,
      selectedRakutenItemId: rakutenItem.id,
      shippingYen: 0,
      shippingSource: 'FREE',
      genreScope: 'IN_SCOPE',
      params: {},
    },
  });
  const fresh = await prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
  return { candidate: fresh, sourcingStepRunId, rakutenItemId: rakutenItem.id, itemCode };
}

export interface ThumbnailWaitingSeed extends ThumbnailSourcingSeed {
  thumbnailStepRunId: number;
  /** 받은 원본(image_asset, 페이지 순서) */
  originals: ImageAsset[];
}

/**
 * 후보 + ② 완료 + ⑤ 입력 대기(`WAITING_INPUT`)를 만든다: ② 시드 → 가짜 fetch를 이미지 fixture로 → `POST …/steps/THUMBNAIL/runs`
 * → 실행기가 원본을 받고 입력 대기가 될 때까지 기다린다(실제 THUMBNAIL 실행기, 외부 호출 없음).
 */
export async function seedThumbnailWaiting(
  t: TestApp,
  input: ThumbnailSourcingSeedInput = {},
): Promise<ThumbnailWaitingSeed> {
  const seed = await seedThumbnailSourcing(t.prisma, input);
  t.fetch.handler = thumbnailFetchHandler();
  const res = await request(t.app.getHttpServer())
    .post(`/api/v1/candidates/${seed.candidate.id}/steps/THUMBNAIL/runs`)
    .set('X-AutoStore-Client', '1')
    .send({});
  if (res.status !== 202) {
    throw new Error(`⑤ 실행이 202가 아닙니다: ${res.status} ${JSON.stringify(res.body)}`);
  }
  await t.app.get(StepExecutor).whenIdle();
  const thumbnailStepRunId = (res.body as { stepRunId: number }).stepRunId;
  const run = await t.prisma.stepRun.findUniqueOrThrow({ where: { id: thumbnailStepRunId } });
  if (run.status !== 'WAITING_INPUT') {
    throw new Error(`⑤가 입력 대기가 아닙니다: ${run.status} ${run.errorCode ?? ''}`);
  }
  const originals = await t.prisma.imageAsset.findMany({
    where: { kind: 'ORIGINAL', sourceItemCode: seed.itemCode },
    orderBy: { id: 'asc' },
  });
  return { ...seed, thumbnailStepRunId, originals };
}

/** ⑤ e2e가 쓰는 표(추가만·산출물 동결·삭제 금지 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const THUMBNAIL_TABLES = [
  'image_asset',
  'thumbnail_reference',
  'thumbnail_reference_input',
  'generation_run',
  'thumbnail_selection',
  'thumbnail_selection_image',
  'call_log',
] as const;

export async function truncateThumbnails(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...STEP_ENGINE_TABLES, ...SOURCING_SNAPSHOT_TABLES, ...THUMBNAIL_TABLES]);
}
