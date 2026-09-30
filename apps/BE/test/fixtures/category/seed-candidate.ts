import type { Candidate } from '../../../src/generated/prisma/client.js';
import { DEFAULT_SETTINGS } from '../../../src/modules/settings/defaults/default-settings.js';
import type { AppSettings } from '../../../src/modules/settings/schema/settings.types.js';
import type { StepCode, StepStatus } from '../../../src/modules/step-engine/domain/steps.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { truncate } from '../../helpers/test-app.js';
import { createCandidate, SAMPLE } from '../step-engine/candidate.factory.js';
import { SOURCING_SNAPSHOT_TABLES, STEP_ENGINE_TABLES } from '../step-engine/truncate.js';
import {
  CATEGORY_FIXTURE,
  CATEGORY_MAPPING,
  LEAF,
  RUNNING_GENRE_ID,
  SYNCED_AT,
} from './fixture-data.js';

export * from './fixture-data.js';

/**
 * ④ 카테고리 e2e fixture(P2-06 §5): 메타 캐시 행·② 완료 버전을 DB에 직접 만든다(합성 값, 값은 fixture-data.ts).
 * 커머스API·라쿠텐을 부르지 않는다.
 */

/** 메타 캐시(commerce_category)에 fixture 리프를 넣는다 + KC 리프의 카테고리 상세 문서(예외 유형 원문) */
export async function seedCommerceCategories(prisma: PrismaService): Promise<void> {
  await prisma.commerceCategory.createMany({
    data: CATEGORY_FIXTURE.map((row) => ({
      categoryId: row.categoryId,
      name: row.name,
      wholeCategoryName: row.wholeCategoryName,
      exceptionalCategories: row.exceptionalCategories,
      detailSyncedAt: SYNCED_AT,
      syncedAt: SYNCED_AT,
      removedAt: row.removed ? SYNCED_AT : null,
    })),
  });
  await prisma.commerceMetaDocument.create({
    data: {
      kind: 'CATEGORY_DETAIL',
      scopeKey: LEAF.MALE_WALKING_KC,
      payload: {
        id: LEAF.MALE_WALKING_KC,
        name: '워킹화',
        wholeCategoryName: '패션잡화>남성신발>운동화>워킹화',
        last: true,
        exceptionalCategories: ['KC_CERTIFICATION'],
      },
      payloadSha256: 'c'.repeat(64),
      syncedAt: SYNCED_AT,
    },
  });
}

/** 기본 템플릿 + 매핑표(설정 파일 글) */
export function settingsWithMapping(): string {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  settings.category.leafMapping = [...CATEGORY_MAPPING];
  return `${JSON.stringify(settings, null, 2)}\n`;
}

export interface CategorySeedInput {
  gender?: 'MALE' | 'FEMALE' | null;
  genderSource?: 'STEP2' | 'OWNER';
  /** ② 상품 장르(없으면 장르 없는 URL 후보). 기본 러닝화 장르 */
  genre?: { genreId: number; genrePath: string } | null;
  /** ②(완료) 밖의 단계 상태 — 예: ⑦을 먼저 완료한 후보 `{ TAGS: 'COMPLETED' }` */
  steps?: Partial<Record<StepCode, StepStatus>>;
}

export interface CategorySeed {
  candidate: Candidate;
  sourcingStepRunId: number;
  stepRunIds: Partial<Record<StepCode, number>>;
}

let seq = 0;

/** 러닝화 장르 경로 사본(② `rakuten_item.genre_path` 모양) */
export const RUNNING_GENRE = {
  genreId: RUNNING_GENRE_ID,
  genrePath: `558885:靴 > 110983:メンズ靴 > ${RUNNING_GENRE_ID}:ランニングシューズ`,
};

/**
 * 후보 + ② 완료 버전('URL로 만들기' 모양 — 고른 상품 `rakuten_item`의 장르). 장르를 주지 않으면(null) 장르 없는 URL 후보.
 * `steps`로 ⑦ 등을 완료로 만든다(현재 버전 step_run, 입력 행 없음).
 */
export async function seedCategoryCandidate(
  prisma: PrismaService,
  input: CategorySeedInput = {},
): Promise<CategorySeed> {
  seq += 1;
  const itemCode = `shop-c:${20000000 + seq}`;
  const [shopCode, itemId] = itemCode.split(':') as [string, string];
  const itemUrl = `https://item.rakuten.co.jp/${shopCode}/${itemId}/`;
  const genre = input.genre === undefined ? RUNNING_GENRE : input.genre;
  const gender = input.gender === undefined ? 'MALE' : input.gender;
  const { candidate, stepRunIds } = await createCandidate(prisma, {
    creationPath: 'RAKUTEN_URL',
    sourceUrl: itemUrl,
    anchor: { itemCode, colorCode: '108' },
    itemCode,
    selectedColor: SAMPLE.selectedColor,
    gender,
    genderSource: input.genderSource ?? 'STEP2',
    steps: { SOURCING: 'COMPLETED', ...input.steps },
  });
  const sourcingStepRunId = stepRunIds.SOURCING!;
  const item = await prisma.rakutenItem.create({
    data: {
      itemCode,
      shopCode,
      shopName: '샵 C',
      itemName: 'アシックス ゲルカヤノ14 メンズ ランニング',
      itemUrl,
      entrySource: 'MANUAL',
      fetchReason: 'URL_ENTRY',
      collectedAt: SYNCED_AT,
      genreId: genre?.genreId ?? null,
      genreSource: genre ? 'PAGE_JSON' : 'NOT_FOUND',
      genrePath: genre?.genrePath ?? null,
      backOrderFlag: false,
    },
  });
  await prisma.sourcingComparison.create({
    data: {
      stepRunId: sourcingStepRunId,
      action: 'URL_CREATE',
      sourceUrl: itemUrl,
      anchorInputMethod: 'URL_ITEM',
      anchorItemCode: itemCode,
      anchorColorCode: '108',
      anchorColorLabel: 'クリーム/ブラック',
      comparisonPerformed: false,
      selectedRakutenItemId: item.id,
      shippingYen: 0,
      shippingSource: 'FREE',
      genreScope: genre ? 'IN_SCOPE' : 'NOT_FOUND',
      params: {},
    },
  });
  const fresh = await prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
  return { candidate: fresh, sourcingStepRunId, stepRunIds };
}

/** ④ e2e가 쓰는 표(삭제 금지·추가만·산출물 동결 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const CATEGORY_TABLES = [
  'category_decision',
  'commerce_category',
  'commerce_meta_document',
] as const;

export async function truncateCategory(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...STEP_ENGINE_TABLES, ...SOURCING_SNAPSHOT_TABLES, ...CATEGORY_TABLES]);
}
