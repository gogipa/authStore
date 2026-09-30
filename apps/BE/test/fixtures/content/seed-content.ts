import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { Candidate } from '../../../src/generated/prisma/client.js';
import type { AiJsonSchema } from '../../../src/modules/integrations/ai-engine/ai-engine.port.js';
import { htmlToText } from '../../../src/modules/sourcing/page-json.parser.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { truncate } from '../../helpers/test-app.js';
import type { FakeAiEngines, FakeAiRunCall } from '../../support/fake-ai-engines.js';
import { createCandidate } from '../step-engine/candidate.factory.js';
import { insertStepRun } from '../step-engine/step-run.factory.js';
import { SOURCING_SNAPSHOT_TABLES, STEP_ENGINE_TABLES } from '../step-engine/truncate.js';

/**
 * ⑥ 콘텐츠 e2e fixture(P3-03 §5.3). 합성 값(실제 상품 아님, 화면시안_명세 §4 후보 A). ② 산출물(상품명·설명 HTML·속성·SKU)을 DB에
 * 직접 만들고, AI는 가짜 어댑터(녹화한 구조화 출력 `ai/*.json`), 설명 속 스펙표 이미지는 가짜 fetch(`spec-images/`)로 답한다 —
 * 라쿠텐·이미지 CDN·AI CLI를 부르지 않는다.
 */

export const CONTENT_FIXTURE_DIR = import.meta.dirname;

export type ContentFixtureName = 'sku-attrs' | 'description-only' | 'no-origin';

export interface ContentItemFixture {
  rakutenItem: {
    itemCode: string;
    shopCode: string;
    shopName: string;
    itemName: string;
    itemUrl: string;
    modelCode: string;
    modelCodeNorm: string;
    collectedAt: string;
    descriptionHtml: string;
    attributes: unknown[];
  };
  skus: {
    variantId: string;
    colorLabel: string;
    colorCode: string;
    sizeLabel: string;
    sizeMm: number;
    attributes: unknown[];
  }[];
  anchor: { modelCode: string; colorCode: string; colorLabel: string };
  /** 스펙 이미지 URL → spec-images/ 파일 이름 */
  specImages?: Record<string, string>;
}

export function contentItemFixture(name: ContentFixtureName): ContentItemFixture {
  return JSON.parse(
    readFileSync(join(CONTENT_FIXTURE_DIR, `rakuten-item-${name}.json`), 'utf8'),
  ) as ContentItemFixture;
}

/** ai/<이름>.json 녹화 출력 */
export function contentAiFixture<T = Record<string, unknown>>(name: string): T {
  return JSON.parse(readFileSync(join(CONTENT_FIXTURE_DIR, 'ai', `${name}.json`), 'utf8')) as T;
}

export function specImageBytes(name: string): Buffer {
  return readFileSync(join(CONTENT_FIXTURE_DIR, 'spec-images', name));
}

/** 가짜 fetch 처리: fixture 스펙 이미지 URL이면 그 파일(200), 모르는 주소는 404 */
export function contentFetchHandler(
  names: readonly ContentFixtureName[] = ['sku-attrs', 'description-only', 'no-origin'],
): (url: string) => Response {
  const files: Record<string, string> = {};
  for (const name of names) Object.assign(files, contentItemFixture(name).specImages ?? {});
  return (url: string) => {
    const file = files[url];
    if (!file) return new Response('Not Found', { status: 404 });
    return new Response(new Uint8Array(specImageBytes(file)), {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    });
  };
}

export interface ContentSourcingSeed {
  candidate: Candidate;
  sourcingStepRunId: number;
  rakutenItemId: number;
  itemCode: string;
}

async function insertItem(
  prisma: PrismaService,
  fixture: ContentItemFixture,
  itemCode: string,
): Promise<{ rakutenItemId: number; itemUrl: string }> {
  const item = fixture.rakutenItem;
  const [shopCode, itemId] = itemCode.split(':') as [string, string];
  const itemUrl = `https://item.rakuten.co.jp/${shopCode}/${itemId}/`;
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
      genreId: 208025,
      genreSource: 'PAGE_JSON',
      genrePath: '558885:靴 > 208025:スニーカー',
      backOrderFlag: false,
      descriptionHtml: item.descriptionHtml,
      // ②(P2-02)와 같은 정리: HTML → 글(NFKC·공백 정리)
      descriptionText: htmlToText(item.descriptionHtml),
      attributes: item.attributes as object[],
      imageUrls: [],
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
      attributes: sku.attributes as object[],
    })),
  });
  return { rakutenItemId: rakutenItem.id, itemUrl };
}

async function insertComparison(
  prisma: PrismaService,
  sourcingStepRunId: number,
  fixture: ContentItemFixture,
  itemCode: string,
  rakutenItemId: number,
  itemUrl: string,
): Promise<void> {
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
      selectedRakutenItemId: rakutenItemId,
      shippingYen: 0,
      shippingSource: 'FREE',
      genreScope: 'IN_SCOPE',
      params: {},
    },
  });
}

let seq = 0;

/**
 * 후보 + ② 완료 버전('URL로 만들기' 모양 — 고른 상품 `rakuten_item`(설명 HTML·글·속성)·SKU(속성)·비교표 머리 행)을 DB에 직접
 * 만든다. 앵커 키 = 型番 1201A019108 + 색상 108. ⑥은 아직 실행하지 않는다.
 */
export async function seedContentSourcing(
  prisma: PrismaService,
  name: ContentFixtureName,
  input: { itemCode?: string } = {},
): Promise<ContentSourcingSeed> {
  seq += 1;
  const fixture = contentItemFixture(name);
  const itemCode = input.itemCode ?? fixture.rakutenItem.itemCode;
  const [shopCode, itemId] = itemCode.split(':') as [string, string];
  const { candidate, stepRunIds } = await createCandidate(prisma, {
    status: 'WORKING',
    creationPath: 'RAKUTEN_URL',
    sourceUrl: `https://item.rakuten.co.jp/${shopCode}/${itemId}/`,
    anchor: { modelCode: fixture.anchor.modelCode, colorCode: fixture.anchor.colorCode },
    itemCode,
    selectedColor: `크림/블랙 ${seq}`,
    gender: 'MALE',
    steps: { SOURCING: 'COMPLETED' },
  });
  const sourcingStepRunId = stepRunIds.SOURCING!;
  const { rakutenItemId, itemUrl } = await insertItem(prisma, fixture, itemCode);
  await insertComparison(prisma, sourcingStepRunId, fixture, itemCode, rakutenItemId, itemUrl);
  const fresh = await prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
  return { candidate: fresh, sourcingStepRunId, rakutenItemId, itemCode };
}

/**
 * 같은 앵커 키에서 itemCode만 바뀐 ② 새 버전(완료)을 만든다(P3-03 §6 e2e — '재확인 필요'). 후보 itemCode·② 포인터를 옮긴다.
 * ⑥은 건드리지 않는다(테스트가 다시 실행한다)
 */
export async function addSourcingVersion(
  prisma: PrismaService,
  candidateId: number,
  name: ContentFixtureName,
  itemCode: string,
): Promise<{ sourcingStepRunId: number; rakutenItemId: number }> {
  const fixture = contentItemFixture(name);
  const run = await insertStepRun(prisma, {
    candidateId,
    stepCode: 'SOURCING',
    status: 'COMPLETED',
  });
  const { rakutenItemId, itemUrl } = await insertItem(prisma, fixture, itemCode);
  await insertComparison(prisma, run.id, fixture, itemCode, rakutenItemId, itemUrl);
  await prisma.candidate.update({ where: { id: candidateId }, data: { itemCode } });
  return { sourcingStepRunId: run.id, rakutenItemId };
}

/** 결과 스키마의 속성만 남긴다(⑥-2 AI 스키마는 못 찾은 필드만 담는다) */
export function pickForSchema(output: Record<string, unknown>, schema: AiJsonSchema) {
  const keys = Object.keys((schema.properties as Record<string, unknown> | undefined) ?? {});
  return Object.fromEntries(keys.filter((k) => k in output).map((k) => [k, output[k]]));
}

/** 비전 호출이면 넘긴 이미지 이름(`image-1.png` — P1-10 작업 폴더 규칙)을 `images_seen`으로 더한다 */
export function withSeenImages(output: Record<string, unknown>, call: FakeAiRunCall) {
  if (call.imagePaths.length === 0) return output;
  return {
    ...output,
    images_seen: call.imagePaths.map((p, i) => `image-${i + 1}${extname(p).toLowerCase()}`),
  };
}

export interface FakeContentAiScript {
  /** ⑥-1 카피 결과(녹화 이름 또는 값). 기본 copy-ok */
  copy?: string | Record<string, unknown>;
  /** ⑥-2 AI 결과(녹화 이름 또는 값). 기본 fact-ocr */
  fact?: string | Record<string, unknown>;
  /** ⑥-2 비전 결과에서 `images_seen`을 빼 본다 */
  factDropsImagesSeen?: boolean;
}

/**
 * createTestApp의 가짜 엔진 3개에 ⑥ 녹화 출력을 건다: 작업 CT-01(카피)·CT-02(사양 추출). 사양 추출은 부른 스키마의 필드만 남기고
 * 비전이면 `images_seen`을 더한다. 그 밖 작업은 원래 결과
 */
export function useFakeContentAi(engines: FakeAiEngines, script: FakeContentAiScript = {}): void {
  const resolve = (v: string | Record<string, unknown> | undefined, fallback: string) =>
    typeof v === 'object' ? v : contentAiFixture(v ?? fallback);
  for (const adapter of [engines.claude, engines.agy, engines.codex]) {
    const fallback = adapter.runImpl;
    adapter.runImpl = (call: FakeAiRunCall) => {
      if (call.task === 'CT-01') return resolve(script.copy, 'copy-ok');
      if (call.task === 'CT-02') {
        const picked = pickForSchema(resolve(script.fact, 'fact-ocr'), call.schema);
        return script.factDropsImagesSeen ? picked : withSeenImages(picked, call);
      }
      return fallback(call);
    };
  }
}

/** ⑥ e2e가 쓰는 표(산출물 동결·추가만 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const CONTENT_TABLES = [
  'content_draft_copy',
  'content_draft_fact',
  'content_draft_field',
  'image_asset',
  'call_log',
] as const;

export async function truncateContent(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...STEP_ENGINE_TABLES, ...SOURCING_SNAPSHOT_TABLES, ...CONTENT_TABLES]);
}
