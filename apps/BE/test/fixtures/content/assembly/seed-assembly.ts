import { createHash } from 'node:crypto';
import { readDefaultSettingsText } from '../../../../src/modules/settings/defaults/default-settings.js';
import type { PrismaService } from '../../../../src/prisma/prisma.service.js';
import { truncate } from '../../../helpers/test-app.js';
import { seedFxRates } from '../../pricing/seed-candidate.js';
import { insertStepRun } from '../../step-engine/step-run.factory.js';
import { CONTENT_TABLES } from '../seed-content.js';
import { SOURCING_SNAPSHOT_TABLES, STEP_ENGINE_TABLES } from '../../step-engine/truncate.js';
import {
  disclosureTemplateFixture,
  originAreasFixture,
  profileFixture,
  type ProfileFixtureName,
} from './assembly-fixtures.js';

/**
 * ⑥-3 e2e 시드(P3-04 §5.3·§6). ②는 P3-03 `seedContentSourcing`, ⑥-1·⑥-2는 실제 실행기(가짜 AI)로 만들고, ③ 판정·⑤ G3 선택본·
 * 프로필·원산지 캐시는 DB에 직접 넣는다 — 커머스API·라쿠텐·이미지 모델을 부르지 않는다. 원산지 코드는 테스트용 값이다
 * (`origin-areas.json` — 실제는 P1-08 동기화 결과).
 */

/** 기본 템플릿 + notice(배송기간 10~20 채움) — ⑥-3 시작 전 빈칸 검사를 통과하는 설정 파일 */
export function assemblySettingsText(): string {
  const settings = JSON.parse(readDefaultSettingsText()) as Record<string, unknown>;
  settings.notice = disclosureTemplateFixture();
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** 원산지 캐시(commerce_origin_area) — 테스트용 코드 */
export async function seedOriginAreas(prisma: PrismaService): Promise<void> {
  const syncedAt = new Date('2026-09-28T00:00:00Z');
  await prisma.commerceOriginArea.createMany({
    data: originAreasFixture().map((row) => ({ ...row, syncedAt })),
    skipDuplicates: true,
  });
}

/** 구매대행 프로필(설치본당 1행) */
export async function seedProfile(prisma: PrismaService, name: ProfileFixtureName): Promise<void> {
  const p = profileFixture(name);
  const data = {
    overseasShippingCommerceAddressbookId: null,
    returnCommerceAddressbookId: null,
    dispatchDeliveryCompanyCode: null,
    commerceReturnDeliveryCompanyId: null,
    returnFeeKrw: p.returnFeeKrw,
    exchangeFeeKrw: p.exchangeFeeKrw,
    businessName: p.businessName,
    afterServicePhone: p.afterServicePhone,
    afterServiceGuide: p.afterServiceGuide,
    importer: p.importer,
    noticeFixedTexts: p.noticeFixedTexts,
    maxPurchaseQuantityPerOrder: p.maxPurchaseQuantityPerOrder,
  };
  await prisma.purchaseAgencyProfile.upsert({
    where: { singletonKey: 1 },
    create: data,
    update: data,
  });
}

/**
 * ③ 완료 버전 + 판정 스냅샷(판매 사이즈만 의미 있는 값). ②의 고른 스냅샷(rakuten_item)과 수집 시각을 그대로 잇는다.
 * `makeCurrent`(기본 true)면 ③ 현재 버전으로 둔다
 */
export async function seedPricingJudgement(
  prisma: PrismaService,
  input: {
    candidateId: number;
    rakutenItemId: number;
    sizes: readonly number[];
    makeCurrent?: boolean;
  },
): Promise<number> {
  const item = await prisma.rakutenItem.findUniqueOrThrow({
    where: { id: input.rakutenItemId },
    select: { collectedAt: true },
  });
  const [costFxRateId, customsJpyFxRateId, customsUsdFxRateId] = await fxRateIds(prisma);
  const domestic = await prisma.domesticPrice.create({
    data: { candidateId: input.candidateId, pRefKrw: 169000, sourceKind: 'MANUAL' },
  });
  const run = await insertStepRun(prisma, {
    candidateId: input.candidateId,
    stepCode: 'PRICING',
    status: 'COMPLETED',
    makeCurrent: input.makeCurrent ?? true,
  });
  await prisma.priceJudgement.create({
    data: {
      stepRunId: run.id,
      skuPriceSource: 'STEP2',
      rakutenItemId: input.rakutenItemId,
      rakutenPageCollectedAt: item.collectedAt,
      domesticPriceId: domestic.id,
      couponYen: 0,
      shippingYen: 0,
      shippingEstimated: false,
      costFxRateId: costFxRateId!,
      customsJpyFxRateId: customsJpyFxRateId!,
      customsUsdFxRateId: customsUsdFxRateId!,
      cFwdKrw: 15000,
      fwdAssumed: true,
      vatMode: 'A',
      pricingRule: 'REF_MINUS_1PCT',
      targetMarginRate: '0.1',
      minProfitKrw: 5000,
      params: {},
      isSaleCandidate: true,
      sellableSizeCount: input.sizes.length,
      salePriceKrw: 167300,
      sizes: {
        create: input.sizes.map((sizeMm) => ({
          sizeMm,
          skuPriceYen: 12000,
          cGoodsKrw: 105120,
          vUsd: '77.37',
          isDutyFree: true,
          twoPairTaxable: true,
          isBoundary: false,
          sizeSalePriceKrw: 167300,
          isSellable: true,
        })),
      },
    },
  });
  return run.id;
}

/** 환율 3종(이미 넣었으면 그 행 — 같은 기준 시각은 한 번만 넣을 수 있다, uq_fx_rate_auto) */
async function fxRateIds(prisma: PrismaService): Promise<number[]> {
  const rows = await prisma.fxRate.findMany({ orderBy: { id: 'asc' }, take: 3 });
  return rows.length === 3 ? rows.map((row) => row.id) : seedFxRates(prisma);
}

function fakeSha(seed: string): string {
  return createHash('sha256').update(seed).digest('hex');
}

/** 가짜 생성 이미지 행(GENERATED — 파일은 없다. 미리보기는 주소만 쓴다) */
export async function seedGeneratedImages(
  prisma: PrismaService,
  candidateId: number,
  count: number,
  seed = 'g',
): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const sha = fakeSha(`${seed}-${candidateId}-${i}`);
    const row = await prisma.imageAsset.create({
      data: {
        kind: 'GENERATED',
        filePath: `images/${sha.slice(0, 2)}/${sha}.png`,
        sha256: sha,
        byteSize: 100,
        mimeType: 'image/png',
        width: 64,
        height: 64,
        usageRight: 'PERMITTED',
        candidateId,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

/** ⑤ 완료 버전 + G3 선택본(대표 = 첫 id, 나머지 추가) — 이 버전을 ⑤ 현재 버전으로 둔다 */
export async function seedThumbnailSelection(
  prisma: PrismaService,
  candidateId: number,
  imageAssetIds: readonly number[],
): Promise<number> {
  const run = await insertStepRun(prisma, {
    candidateId,
    stepCode: 'THUMBNAIL',
    status: 'COMPLETED',
  });
  await prisma.thumbnailSelection.create({
    data: {
      stepRunId: run.id,
      checklist: { version: 'M1-1' },
      selectedAt: new Date('2026-09-28T05:10:00Z'),
      images: {
        create: imageAssetIds.map((imageAssetId, index) => ({
          imageAssetId,
          role: index === 0 ? 'REPRESENTATIVE' : 'ADDITIONAL',
          sortOrder: index,
        })),
      },
    },
  });
  return run.id;
}

/** ⑥-3 e2e가 비우는 표(산출물 동결·추가만 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const ASSEMBLY_TABLES = [
  'content_draft_assembly',
  'purchase_agency_profile',
  'commerce_origin_area',
  'price_judgement',
  'price_judgement_size',
  'domestic_price',
  'fx_rate',
  'thumbnail_selection',
  'thumbnail_selection_image',
] as const;

export async function truncateAssembly(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [
    ...STEP_ENGINE_TABLES,
    ...SOURCING_SNAPSHOT_TABLES,
    ...CONTENT_TABLES,
    ...ASSEMBLY_TABLES,
  ]);
}
