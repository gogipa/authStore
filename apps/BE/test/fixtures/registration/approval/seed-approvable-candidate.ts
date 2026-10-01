import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candidate, Prisma } from '../../../../src/generated/prisma/client.js';
import { checklistSnapshot } from '../../../../src/modules/thumbnails/selection/thumbnail-selection.js';
import type {
  CandidateStatus,
  StepCode,
} from '../../../../src/modules/step-engine/domain/steps.js';
import { GateValidityService } from '../../../../src/modules/step-engine/gates/gate-validity.service.js';
import type { PrismaService } from '../../../../src/prisma/prisma.service.js';
import { TEST_START_MS, truncate, type TestApp } from '../../../helpers/test-app.js';
import { seedFxRates } from '../../pricing/seed-candidate.js';
import {
  PROFILE_TABLES,
  seedProfileCaches,
  validProfileInput,
} from '../../settings/purchase-agency-profile/profile-fixtures.js';
import { createCandidate } from '../../step-engine/candidate.factory.js';
import { insertStepRun } from '../../step-engine/step-run.factory.js';
import { SOURCING_SNAPSHOT_TABLES, STEP_ENGINE_TABLES } from '../../step-engine/truncate.js';
import { placeholderHtml } from '../upload/seed-upload-ready.js';
import {
  APPROVAL_SAMPLE,
  approvalDetailContent,
  approvalNoticeFields,
  disclosureRecordsOf,
} from './approval-fixtures.js';

/**
 * 승인할 수 있는 후보 시드(P4-02 §5 fixtures `seed-approvable-candidate.ts` — P4-03·P5-01도 쓴다). 필수 9단계(②~⑧)를 모두
 * `COMPLETED` 버전으로 두고, G2·G3 통과(지문 = 실제 공급자가 지금 값으로 계산), 모든 산출물과 프로필·메타 캐시를 Prisma INSERT로
 * 넣는다. 닫힌 step_run을 UPDATE하지 않는다(산출물은 닫힌 버전에 INSERT만 — `trg_output_frozen`은 UPDATE·DELETE만 막는다).
 * 값은 `approval-fixtures.ts`의 기본 입력과 같다(화면시안 후보 A — 합성 값). 사전 검증 15개가 모두 통과하도록:
 * - 판정에 쓴 라쿠텐 페이지 수집 시각 = 테스트 시계 시작(2026-09-28 09:00 KST)보다 1시간 앞(유효 6시간)
 * - 옵션 = 250·255·260·265·275mm 각 2개(라쿠텐 수량 3·2·5·3·4, 상한 2) — 고시·사양 블록 사이즈와 같다
 * - 최종 태그 10개, 가짜 커머스 restricted-tags는 e2e가 정한다(키는 e2e가 메모리 키체인에 넣는다)
 * - 업로드 URL은 가짜 shop-phinf 주소(브라우저·테스트가 부르지 않는다), 업로드본은 1000×1000 UPLOAD(원천 = 생성본)
 * 실제 상품·상호·주소가 아니다.
 */

export interface ApprovableSeedOptions {
  /** 후보 상태(기본 AWAITING_APPROVAL — 409 검사는 WORKING) */
  status?: CandidateStatus;
  /** 판정에 쓴 페이지 수집 시각(기본 시계 시작 − 1시간) */
  collectedAt?: Date;
  itemCode?: string;
  /** ⑥-3 상품명(기본 시안 값 — P4-03 e2e는 101자로 PRE_VALIDATION_FAILED를 본다) */
  productName?: string;
}

export interface ApprovableSeed {
  candidate: Candidate;
  stepRunIds: Record<Exclude<StepCode, 'REGISTER'>, number>;
  rakutenItemId: number;
  priceJudgementId: number;
  uploadResultId: number;
  collectedAt: Date;
  /** 업로드본 image_asset id(sort_order 순) */
  uploadImageAssetIds: number[];
  finalTags: string[];
}

const AT = new Date(TEST_START_MS - 30 * 60_000);
const sha = (seed: string) => createHash('sha256').update(seed).digest('hex');

/** 커머스 카테고리 리프(메타 캐시) 한 줄 */
async function seedLeafCategory(prisma: PrismaService): Promise<void> {
  await prisma.commerceCategory.upsert({
    where: { categoryId: APPROVAL_SAMPLE.leafCategoryId },
    create: {
      categoryId: APPROVAL_SAMPLE.leafCategoryId,
      name: '러닝화',
      wholeCategoryName: APPROVAL_SAMPLE.wholeCategoryName,
      exceptionalCategories: [],
      detailSyncedAt: AT,
      syncedAt: AT,
    },
    update: {},
  });
}

/** 구매대행 프로필(주소록·반품 택배사 캐시 + 프로필 행 — P1-09 fixture) */
export async function seedApprovalProfile(prisma: PrismaService): Promise<void> {
  if ((await prisma.commerceAddressbook.count()) === 0) await seedProfileCaches(prisma);
  const values = validProfileInput();
  await prisma.purchaseAgencyProfile.upsert({
    where: { singletonKey: 1 },
    create: values,
    update: values,
  });
}

async function imageAsset(
  prisma: PrismaService,
  data: Omit<Prisma.ImageAssetUncheckedCreateInput, 'filePath' | 'sha256'> & { seed: string },
) {
  const { seed, ...rest } = data;
  const digest = sha(seed);
  return prisma.imageAsset.create({
    data: { ...rest, sha256: digest, filePath: `images/${digest.slice(0, 2)}/${digest}.jpg` },
  });
}

export async function seedApprovableCandidate(
  t: TestApp,
  options: ApprovableSeedOptions = {},
): Promise<ApprovableSeed> {
  const prisma = t.prisma;
  const itemCode = options.itemCode ?? APPROVAL_SAMPLE.itemCode;
  const [shopCode, itemId] = itemCode.split(':') as [string, string];
  const itemUrl = `https://item.rakuten.co.jp/${shopCode}/${itemId}/`;
  const collectedAt = options.collectedAt ?? new Date(TEST_START_MS - 60 * 60_000);
  const { candidate } = await createCandidate(prisma, {
    status: options.status ?? 'AWAITING_APPROVAL',
    creationPath: 'KEYWORD',
    anchor: {
      modelCode: APPROVAL_SAMPLE.anchorModelCode,
      colorCode: APPROVAL_SAMPLE.anchorColorCode,
    },
    itemCode,
    selectedColor: APPROVAL_SAMPLE.selectedColor,
    gender: 'MALE',
    leafCategoryId: APPROVAL_SAMPLE.leafCategoryId,
    statusChangedAt: AT,
  });
  const cid = candidate.id;
  const run = (stepCode: StepCode) =>
    insertStepRun(prisma, { candidateId: cid, stepCode, status: 'COMPLETED', startedAt: AT });

  // ② 소싱 — 비교를 한 버전(고른 행) + 페이지 스냅샷·SKU
  const sourcing = await run('SOURCING');
  const item = await prisma.rakutenItem.create({
    data: {
      itemCode,
      shopCode,
      shopName: '샵 A',
      itemName: 'アシックス ゲルカヤノ14 1201A019-108',
      itemUrl,
      modelCode: '1201A019-108',
      modelCodeNorm: APPROVAL_SAMPLE.anchorModelCode,
      entrySource: 'API',
      fetchReason: 'SOURCING',
      collectedAt,
      genreId: 558885,
      genreSource: 'API',
      backOrderFlag: false,
    },
  });
  const stock: [number, number, boolean][] = [
    [250, 3, false],
    [255, 2, false],
    [260, 5, false],
    [265, 3, false],
    [270, 0, false],
    [275, 4, false],
    [280, 0, true],
    [285, 0, false],
  ];
  const skuIds = new Map<number, number>();
  for (const [i, [sizeMm, quantity, backOrder]] of stock.entries()) {
    const sku = await prisma.rakutenSku.create({
      data: {
        rakutenItemId: item.id,
        variantId: `v${i + 1}`,
        colorLabel: 'クリーム/ブラック',
        colorCode: APPROVAL_SAMPLE.anchorColorCode,
        sizeLabel: `${(sizeMm / 10).toFixed(1)}cm`,
        sizeMm,
        taxIncludedPriceYen: 12000,
        quantity,
        backOrder,
        selectorValues: { color: 'クリーム/ブラック', size: `${sizeMm / 10}` },
      },
    });
    skuIds.set(sizeMm, sku.id);
  }
  const head = await prisma.sourcingComparison.create({
    data: {
      stepRunId: sourcing.id,
      action: 'SEARCH_COMPARE',
      searchKeyword: 'アシックス ゲルカヤノ14',
      anchorInputMethod: 'SEARCH_PICK',
      anchorItemCode: itemCode,
      anchorModelCode: '1201A019-108',
      anchorModelCodeNorm: APPROVAL_SAMPLE.anchorModelCode,
      anchorColorCode: APPROVAL_SAMPLE.anchorColorCode,
      anchorColorLabel: 'クリーム/ブラック',
      comparisonPerformed: true,
      genreScope: 'IN_SCOPE',
      params: {},
    },
  });
  await prisma.sourcingComparisonRow.create({
    data: {
      sourcingComparisonId: head.id,
      rowSource: 'API',
      searchRank: 1,
      itemCode,
      shopCode,
      shopName: '샵 A',
      itemName: 'アシックス ゲルカヤノ14 1201A019-108',
      itemUrl,
      anchorMatch: 'MATCH',
      isVerified: true,
      rakutenItemId: item.id,
      inStockSizeCount: 5,
      stockPass: true,
      representativeRakutenSkuId: skuIds.get(250) ?? null,
      representativePriceYen: 12000,
      shippingYen: 0,
      shippingSource: 'FREE',
      couponYen: 0,
      pointsTotalPt: 1090,
      isSelected: true,
    },
  });

  // ③ 판정 — 판매 사이즈 5개(PRD §8.3 예시 값)
  const pricing = await run('PRICING');
  const fxCount = await prisma.fxRate.count();
  const [costFx, customsJpy, customsUsd] =
    fxCount >= 3
      ? (await prisma.fxRate.findMany({ orderBy: { id: 'asc' }, take: 3 })).map((r) => r.id)
      : await seedFxRates(prisma);
  const domestic = await prisma.domesticPrice.create({
    data: { candidateId: cid, pRefKrw: 169000, sourceKind: 'MANUAL' },
  });
  const judgement = await prisma.priceJudgement.create({
    data: {
      stepRunId: pricing.id,
      skuPriceSource: 'STEP2',
      rakutenItemId: item.id,
      rakutenPageCollectedAt: collectedAt,
      domesticPriceId: domestic.id,
      couponYen: 0,
      shippingYen: 0,
      shippingEstimated: false,
      costFxRateId: costFx!,
      customsJpyFxRateId: customsJpy!,
      customsUsdFxRateId: customsUsd!,
      cShipIntlKrw: 15000,
      cFwdKrw: 15000,
      fwdAssumed: true,
      vatMode: 'A',
      pricingRule: 'REF_MINUS_1PCT',
      targetMarginRate: '0.1',
      minProfitKrw: 5000,
      params: {},
      isSaleCandidate: true,
      sellableSizeCount: APPROVAL_SAMPLE.saleSizesMm.length,
      salePriceKrw: APPROVAL_SAMPLE.salePriceKrw,
      judgedAt: new Date(collectedAt.getTime() + 8 * 60_000),
      sizes: {
        create: APPROVAL_SAMPLE.saleSizesMm.map((sizeMm) => ({
          sizeMm,
          rakutenSkuId: skuIds.get(sizeMm) ?? null,
          skuPriceYen: 12000,
          cGoodsKrw: 107748,
          vUsd: '77.37',
          isDutyFree: true,
          twoPairTaxable: true,
          isBoundary: false,
          cTaxKrw: 0,
          pMinKrw: 153100,
          optionPriceKrw: 0,
          sizeSalePriceKrw: APPROVAL_SAMPLE.salePriceKrw,
          cMktKrw: 11092,
          vatAKrw: 3042,
          vatBKrw: 14201,
          profitAKrw: 27418,
          profitBKrw: 16259,
          marginRateA: '0.1639',
          isSellable: true,
        })),
      },
    },
  });
  await passGate(t, cid, 'G2', pricing.id);

  // ④ 카테고리 — 성별 경로 리프(PASS)
  const category = await run('CATEGORY');
  await seedLeafCategory(prisma);
  await prisma.categoryDecision.create({
    data: {
      stepRunId: category.id,
      gender: 'MALE',
      candidateSource: 'MAPPING',
      categoryOptions: [
        {
          leafCategoryId: APPROVAL_SAMPLE.leafCategoryId,
          wholeCategoryName: APPROVAL_SAMPLE.wholeCategoryName,
        },
      ],
      leafCategoryId: APPROVAL_SAMPLE.leafCategoryId,
      wholeCategoryName: APPROVAL_SAMPLE.wholeCategoryName,
      genderPathMatch: true,
      exceptionalCategories: [],
      exceptionDecision: 'PASS',
      decidedAt: AT,
    },
  });

  // ⑤ 썸네일 — 같은 앵커 레퍼런스 1장 + 생성본 2장(대표·추가) + 체크리스트 7개 true
  const thumbnail = await run('THUMBNAIL');
  const reference = await imageAsset(prisma, {
    seed: `approval-ref-${cid}`,
    kind: 'ORIGINAL',
    byteSize: 1000,
    mimeType: 'image/jpeg',
    width: 800,
    height: 800,
    sourceSection: 'PRODUCT_IMAGE',
    sourceUrl: `https://tshop.r10s.jp/${shopCode}/cabinet/${itemId}-1.jpg`,
    sourceItemCode: itemCode,
    sourceShopCode: shopCode,
    sourceModelCodeNorm: APPROVAL_SAMPLE.anchorModelCode,
    sourceColorCode: APPROVAL_SAMPLE.anchorColorCode,
    collectedAt,
    usageRight: 'REFERENCE_ONLY',
  });
  await prisma.thumbnailReference.create({
    data: {
      stepRunId: thumbnail.id,
      imageAssetId: reference.id,
      sortOrder: 1,
      noPersonConfirmedAt: AT,
    },
  });
  const generated = [];
  for (let i = 0; i < 2; i += 1) {
    generated.push(
      await imageAsset(prisma, {
        seed: `approval-gen-${cid}-${i}`,
        kind: 'GENERATED',
        byteSize: 2000,
        mimeType: 'image/png',
        width: 2048,
        height: 2048,
        usageRight: 'PERMITTED',
        candidateId: cid,
      }),
    );
  }
  await prisma.thumbnailSelection.create({
    data: {
      stepRunId: thumbnail.id,
      checklist: checklistSnapshot(),
      selectedAt: AT,
      images: {
        create: generated.map((image, index) => ({
          imageAssetId: image.id,
          role: index === 0 ? 'REPRESENTATIVE' : 'ADDITIONAL',
          sortOrder: index,
        })),
      },
    },
  });
  await passGate(t, cid, 'G3', thumbnail.id);

  // ⑥-1 카피
  const copy = await run('COPY');
  const copyDoc = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', '..', 'content', 'assembly', 'copy.json'), 'utf8'),
  ) as Record<string, unknown>;
  delete copyDoc._note;
  await prisma.contentDraftCopy.create({
    data: {
      stepRunId: copy.id,
      generatedCopy: copyDoc as Prisma.InputJsonObject,
      copy: copyDoc as Prisma.InputJsonObject,
    },
  });

  // ⑥-2 사실 — 원산지 베트남(지금 상품 페이지 근거)·소재(합성가죽 → 가죽 고지)
  const noticeRaw = await run('NOTICE_RAW');
  await prisma.contentDraftFact.create({
    data: {
      stepRunId: noticeRaw.id,
      sourceItemCode: itemCode,
      sourcePageUrl: itemUrl,
      selectedColorRaw: 'クリーム/ブラック',
    },
  });
  const fact = (
    fieldKey: string,
    value: Prisma.InputJsonValue | null,
    method: string,
    quote: string | null,
  ) => ({
    stepRunId: noticeRaw.id,
    fieldKey,
    value: value ?? undefined,
    generatedValue: value ?? undefined,
    valueSource: 'GENERATED',
    extractionMethod: method,
    evidenceQuote: quote,
    evidenceUrl: value === null ? null : itemUrl,
    basisItemCode: itemCode,
  });
  await prisma.contentDraftField.createMany({
    data: [
      fact('fact.origin', ['베트남'], 'SKU_ATTRIBUTE', '原産国：ベトナム'),
      fact(
        'fact.material_upper',
        '합성섬유·합성가죽',
        'SKU_ATTRIBUTE',
        'アッパー：合成繊維・合成皮革',
      ),
      fact('fact.material_lining', null, 'NONE', null),
      fact('fact.material_sole', '고무', 'SKU_ATTRIBUTE', 'ソール：ゴム'),
      fact(
        'fact.heel_height',
        { value: 3.5, unit: 'cm' },
        'DESCRIPTION_PATTERN',
        'ソール高：3.5cm',
      ),
      fact('fact.color_ko', '크림', 'DICTIONARY', 'クリーム/ブラック'),
      fact(
        'fact.caution',
        '직사광선과 높은 온도를 피해 서늘한 곳에 보관해 주세요.',
        'TEMPLATE',
        null,
      ),
    ],
  });

  // ⑥-3 조립 — P3-04 스냅샷 HTML(자리표시자) + 고지 블록 해시 기록
  const noticeHtml = await run('NOTICE_HTML');
  const html = placeholderHtml();
  const spec = /<div data-autostore-section="SPEC">[\s\S]*?<\/ul><\/div>/.exec(html)?.[0] ?? '';
  const records = disclosureRecordsOf(html);
  await prisma.contentDraftAssembly.create({
    data: {
      stepRunId: noticeHtml.id,
      productName: options.productName ?? APPROVAL_SAMPLE.productName,
      noticeFields: approvalNoticeFields(),
      noticeSizesMm: [...APPROVAL_SAMPLE.saleSizesMm],
      originAreaCode: '0200037',
      originAreaPlural: false,
      originAreaContent: null,
      importer: '[수입자]',
      specBlockHtml: spec,
      specOriginLabel: '베트남',
      disclosureTemplateVersion: 'M1-2026-09-24',
      disclosureTemplateDate: new Date('2026-09-24T00:00:00Z'),
      disclosureBlockIds: records.map((r) => r.blockId),
      disclosureBlocks: records.map((r) => ({
        block_id: r.blockId,
        sha256: r.sha256,
        conditional: r.conditional,
      })),
      html,
      htmlSha256: sha(html),
    },
  });

  // ⑦ 최종 태그 10개
  const tagsRun = await run('TAGS');
  const tagSet = await prisma.tagSet.create({
    data: {
      stepRunId: tagsRun.id,
      recommendKeywords: ['아식스 젤카야노14'],
      leafCategoryId: APPROVAL_SAMPLE.leafCategoryId,
      restrictedCheckedAt: AT,
    },
  });
  await prisma.tagCandidate.createMany({
    data: APPROVAL_SAMPLE.tags.map((tag, i) => ({
      tagSetId: tagSet.id,
      text: tag.text,
      textKey: tag.text.toLowerCase(),
      code: tag.code,
      inRecommend: tag.code !== null,
      inCompetitor: tag.code === null,
      outcome: 'SELECTED',
      restricted: false,
      finalOrder: i + 1,
    })),
  });

  // ⑧ 업로드 — 1000×1000 업로드본(원천 = 생성본)·가짜 shop-phinf URL·최종 detailContent
  const upload = await run('UPLOAD');
  const uploadImageAssetIds: number[] = [];
  const uploadedIds: number[] = [];
  for (const [i, source] of generated.entries()) {
    const normalized = await imageAsset(prisma, {
      seed: `approval-upload-${cid}-${i}`,
      kind: 'UPLOAD',
      byteSize: 120_000,
      mimeType: 'image/jpeg',
      width: 1000,
      height: 1000,
      usageRight: 'PERMITTED',
      candidateId: cid,
      derivedFromImageAssetId: source.id,
    });
    uploadImageAssetIds.push(normalized.id);
    const uploaded = await prisma.uploadedImage.create({
      data: {
        sourceSha256: source.sha256,
        imageAssetId: normalized.id,
        url: APPROVAL_SAMPLE.uploadUrls[i]!.replace('fixture-approval', `fixture-approval-${cid}`),
        traceId: 'fixture-trace-upload',
        uploadedAt: AT,
      },
    });
    uploadedIds.push(uploaded.id);
  }
  const urls = await prisma.uploadedImage.findMany({
    where: { id: { in: uploadedIds } },
    orderBy: { id: 'asc' },
    select: { url: true },
  });
  const detailContent = approvalDetailContent().replace(
    /fixture-approval-(\d)\.jpg/g,
    `fixture-approval-${cid}-$1.jpg`,
  );
  if (!urls.every((u) => detailContent.includes(u.url)))
    throw new Error('업로드 URL 시드가 본문과 다릅니다');
  const result = await prisma.uploadResult.create({
    data: {
      stepRunId: upload.id,
      detailContent,
      detailContentSha256: sha(detailContent),
      images: {
        create: uploadedIds.map((uploadedImageId, index) => ({
          uploadedImageId,
          role: index === 0 ? 'REPRESENTATIVE' : 'ADDITIONAL',
          sortOrder: index,
        })),
      },
    },
  });

  await seedApprovalProfile(prisma);

  return {
    candidate: await prisma.candidate.findUniqueOrThrow({ where: { id: cid } }),
    stepRunIds: {
      SOURCING: sourcing.id,
      PRICING: pricing.id,
      CATEGORY: category.id,
      THUMBNAIL: thumbnail.id,
      COPY: copy.id,
      NOTICE_RAW: noticeRaw.id,
      NOTICE_HTML: noticeHtml.id,
      TAGS: tagsRun.id,
      UPLOAD: upload.id,
    },
    rakutenItemId: item.id,
    priceJudgementId: judgement.id,
    uploadResultId: result.id,
    collectedAt,
    uploadImageAssetIds,
    finalTags: APPROVAL_SAMPLE.tags.map((tag) => tag.text),
  };
}

/** 게이트 통과 기록(지문 = 실제 공급자가 지금 값으로 계산) */
export async function passGate(
  t: TestApp,
  candidateId: number,
  gate: 'G2' | 'G3',
  basisStepRunId: number,
): Promise<number> {
  const computed = await t.app
    .get(GateValidityService)
    .basisOf(t.prisma, candidateId, gate, basisStepRunId);
  if (!computed) throw new Error(`${gate} 공급자가 없습니다`);
  const row = await t.prisma.gatePass.create({
    data: {
      candidateId,
      gate,
      fingerprint: computed.fingerprint,
      fingerprintBasis: computed.basis as Prisma.InputJsonObject,
      basisStepRunId,
      basisStepCode: gate === 'G2' ? 'PRICING' : 'THUMBNAIL',
      passedAt: AT,
    },
  });
  return row.id;
}

/** e2e가 비우는 표(산출물 동결·추가만·삭제 금지 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const APPROVAL_TABLES = [
  ...STEP_ENGINE_TABLES,
  ...SOURCING_SNAPSHOT_TABLES,
  'sourcing_comparison_row',
  'domestic_price',
  'price_judgement',
  'price_judgement_size',
  'fx_rate',
  'category_decision',
  'commerce_category',
  'image_asset',
  'generation_run',
  'thumbnail_reference',
  'thumbnail_selection',
  'thumbnail_selection_image',
  'content_draft_copy',
  'content_draft_fact',
  'content_draft_field',
  'content_draft_assembly',
  'tag_set',
  'tag_candidate',
  'uploaded_image',
  'upload_result',
  'upload_result_image',
  'registration',
  'registration_switch',
  'call_log',
  ...PROFILE_TABLES,
];

export async function truncateApproval(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...APPROVAL_TABLES]);
}
