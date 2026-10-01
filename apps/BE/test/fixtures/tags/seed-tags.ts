import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Candidate } from '../../../src/generated/prisma/client.js';
import { DEFAULT_SETTINGS } from '../../../src/modules/settings/defaults/default-settings.js';
import type { AppSettings } from '../../../src/modules/settings/schema/settings.types.js';
import type { StepCode, StepStatus } from '../../../src/modules/step-engine/domain/steps.js';
import type { PrismaService } from '../../../src/prisma/prisma.service.js';
import { truncate } from '../../helpers/test-app.js';
import { CATEGORY_MAPPING, RUNNING_GENRE_ID } from '../category/fixture-data.js';
import { createCandidate } from '../step-engine/candidate.factory.js';
import { createKeyword } from '../step-engine/keyword.factory.js';
import { SOURCING_SNAPSHOT_TABLES, STEP_ENGINE_TABLES } from '../step-engine/truncate.js';

/**
 * ⑦ 태그 e2e fixture(P3-05 §5.3, 합성 — 화면시안_명세 §4 후보 A '아식스 젤카야노 14 · 크림/블랙'). ② 완료 버전(고른 상품
 * `rakuten_item` — 型番·러닝화 장르·브랜드 속성)과 ① 선택 키워드를 DB에 직접 만든다. 커머스API는 가짜 서버(`fake-commerce-tags.ts`).
 */

export const TAGS_DIR = import.meta.dirname;

/** category-leaf.json: 패션잡화 > 남성신발 > 운동화 > 러닝화 */
export const CATEGORY_LEAF = JSON.parse(
  readFileSync(join(TAGS_DIR, 'category-leaf.json'), 'utf8'),
) as { leafCategoryId: string; wholeCategoryName: string };

export interface TagsSeedInput {
  /** ① 선택 키워드(없으면 URL 후보 — 시드 키워드는 ② 型番으로) */
  keyword?: string | null;
  gender?: 'MALE' | 'FEMALE';
  /** ④ 완료(후보 리프 = category-leaf.json) */
  categoryCompleted?: boolean;
  steps?: Partial<Record<StepCode, StepStatus>>;
}

export interface TagsSeed {
  candidate: Candidate;
  sourcingStepRunId: number;
}

let seq = 0;

/** 후보 + ② 완료 버전(+ 선택: ① 키워드, ④ 완료) */
export async function seedTagsCandidate(
  prisma: PrismaService,
  input: TagsSeedInput = {},
): Promise<TagsSeed> {
  seq += 1;
  const keyword = input.keyword === undefined ? '아식스 젤카야노14' : input.keyword;
  const itemCode = `shop-t:${30000000 + seq}`;
  const [shopCode, itemId] = itemCode.split(':') as [string, string];
  const itemUrl = `https://item.rakuten.co.jp/${shopCode}/${itemId}/`;
  const sourceKeywordId =
    keyword !== null ? (await createKeyword(prisma, { state: 'SELECTED', keyword })).id : undefined;
  const { candidate, stepRunIds } = await createCandidate(prisma, {
    creationPath: keyword !== null ? 'KEYWORD' : 'RAKUTEN_URL',
    sourceKeywordId,
    rakutenQuery: null,
    sourceUrl: keyword !== null ? undefined : itemUrl,
    anchor: { modelCode: '1201A019108', colorCode: '108' },
    itemCode,
    selectedColor: '크림/블랙',
    gender: input.gender ?? 'MALE',
    genderSource: 'STEP2',
    leafCategoryId: input.categoryCompleted ? CATEGORY_LEAF.leafCategoryId : null,
    steps: {
      SOURCING: 'COMPLETED',
      ...(input.categoryCompleted ? { CATEGORY: 'COMPLETED' as const } : {}),
      ...input.steps,
    },
  });
  const sourcingStepRunId = stepRunIds.SOURCING!;
  const item = await prisma.rakutenItem.create({
    data: {
      itemCode,
      shopCode,
      shopName: '라쿠텐 샵 T',
      itemName: 'アシックス ゲルカヤノ14 1201A019-108 クリーム/ブラック',
      itemUrl,
      modelCode: '1201A019-108',
      modelCodeNorm: '1201A019108',
      entrySource: 'MANUAL',
      fetchReason: 'URL_ENTRY',
      collectedAt: new Date('2026-09-28T05:02:00Z'),
      genreId: RUNNING_GENRE_ID,
      genreSource: 'PAGE_JSON',
      genrePath: `558885:靴 > 110983:メンズ靴 > ${RUNNING_GENRE_ID}:ランニングシューズ`,
      backOrderFlag: false,
      attributes: [{ name: 'ブランド', value: 'ASICS' }],
      imageUrls: [],
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
      genreScope: 'IN_SCOPE',
      params: {},
    },
  });
  const fresh = await prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } });
  if (input.categoryCompleted && fresh.wholeCategoryName !== CATEGORY_LEAF.wholeCategoryName) {
    await prisma.candidate.update({
      where: { id: candidate.id },
      data: { wholeCategoryName: CATEGORY_LEAF.wholeCategoryName },
    });
  }
  return {
    candidate: await prisma.candidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    sourcingStepRunId,
  };
}

/** 기본 템플릿 + ④ 매핑표(④를 실제 실행기로 끝낼 때) + 태그 설정 바꾸기 */
export function tagsSettingsText(edit: (s: AppSettings) => void = () => undefined): string {
  const settings = structuredClone(DEFAULT_SETTINGS) as AppSettings;
  settings.category.leafMapping = [...CATEGORY_MAPPING];
  edit(settings);
  return `${JSON.stringify(settings, null, 2)}\n`;
}

/** ⑦ e2e가 쓰는 표(산출물 동결·추가만·삭제 금지 트리거 → TRUNCATE … RESTART IDENTITY CASCADE) */
export const TAGS_TABLES = [
  'tag_set',
  'tag_set_competitor_input',
  'tag_candidate',
  'tag_owner_edit',
  'tag_competitor_input',
  'tag_competitor_item',
  'category_decision',
  'commerce_category',
  'commerce_meta_document',
  'call_log',
] as const;

export async function truncateTags(prisma: PrismaService): Promise<void> {
  await truncate(prisma, [...STEP_ENGINE_TABLES, ...SOURCING_SNAPSHOT_TABLES, ...TAGS_TABLES]);
}
