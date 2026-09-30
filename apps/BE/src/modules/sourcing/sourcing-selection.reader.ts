import type { Prisma } from '../../generated/prisma/client.js';
import type { AppSettings } from '../settings/schema/settings.types.js';
import { idPathFromNamePath } from '../integrations/rakuten/rakuten-genre.service.js';
import type {
  SourcingGenreView,
  SourcingImagesView,
  SourcingItemContentView,
  SourcingSelectionReader,
  SourcingSelectionView,
  SourcingTargetSkus,
} from '../step-engine/ports/sourcing-selection.port.js';
import { comparisonParamsOf } from './sourcing-output.js';
import { judgeStock } from './stock-judgement.js';

type Db = Prisma.TransactionClient;

/**
 * ② 소싱 선택 읽기(ERD `sourcing_comparison` '소싱 선택 읽기 규칙', P2-02). 순수 DB 읽기 — sourcing이 앱 시작 때
 * `StepEngineApi.registerSourcingSelectionReader`로 등록하고, ③·⑤·⑥은 step-engine을 거쳐 이것만 쓴다.
 * - 비교를 한 버전(`comparison_performed=true`): `is_selected` 행(검증 행)의 rakuten_item·대표 SKU·송료·쿠폰
 * - 비교를 하지 않은 버전(URL로 만들기·그 재조회): 머리 행의 `selected_rakuten_item_id`·송료. 쿠폰은 0(③ 입력)
 * 선택이 없으면(검색 뒤 앵커·선택 대기, 색상 선택 전) null.
 */
export async function readSourcingSelection(
  db: Db,
  sourcingStepRunId: number,
): Promise<SourcingSelectionView | null> {
  const head = await db.sourcingComparison.findUnique({
    where: { stepRunId: sourcingStepRunId },
    include: {
      selectedRakutenItem: true,
      rows: { where: { isSelected: true }, take: 1, include: { rakutenItem: true } },
    },
  });
  if (!head) return null;
  const base = {
    sourcingStepRunId,
    sourcingComparisonId: head.id,
    action: head.action as SourcingSelectionView['action'],
    comparisonPerformed: head.comparisonPerformed,
    anchorColorLabel: head.anchorColorLabel,
    anchorColorCode: head.anchorColorCode,
    adultProductConfirmedAt: head.adultProductConfirmedAt,
  };
  if (!head.comparisonPerformed) {
    const item = head.selectedRakutenItem;
    if (!item) return null;
    return {
      ...base,
      rakutenItemId: item.id,
      itemCode: item.itemCode,
      itemName: item.itemName,
      itemUrl: item.itemUrl,
      collectedAt: item.collectedAt,
      representativeRakutenSkuId: null,
      shippingYen: head.shippingYen,
      shippingSource: head.shippingSource,
      couponYen: 0,
    };
  }
  const row = head.rows[0];
  if (!row?.rakutenItem) return null;
  return {
    ...base,
    rakutenItemId: row.rakutenItem.id,
    itemCode: row.itemCode,
    itemName: row.itemName,
    itemUrl: row.itemUrl,
    collectedAt: row.rakutenItem.collectedAt,
    representativeRakutenSkuId: row.representativeRakutenSkuId,
    shippingYen: row.shippingYen,
    shippingSource: row.shippingSource,
    couponYen: row.couponYen,
  };
}

export const sourcingSelectionReader: SourcingSelectionReader = { read: readSourcingSelection };

/**
 * ② 버전의 소싱 선택 상품에서 목표 사이즈별 SKU·재고 칸(P2-05 Proposed — ③ 판정 입력 '② 목표 사이즈 SKU가·재고').
 * ② 재고 판정(`judgeStock` — 앵커 색상·기본 폭·목표 범위·取り寄せ 제외)을 **그 ② 버전의 설정 사본**(`comparisonParamsOf`,
 * 빠진 값은 지금 설정)으로 다시 돌린다. 성별은 부르는 쪽(③ 입력 `candidate.gender`)이 준다. 선택이 없으면 null.
 * 비교를 한 버전이면 고른 행의 포인트 합계(참고치)도 준다.
 */
export async function readSourcingTargetSkus(
  db: Db,
  sourcingStepRunId: number,
  gender: 'MALE' | 'FEMALE',
  settings: Readonly<AppSettings>,
): Promise<SourcingTargetSkus | null> {
  const selection = await readSourcingSelection(db, sourcingStepRunId);
  if (!selection) return null;
  const head = await db.sourcingComparison.findUniqueOrThrow({
    where: { id: selection.sourcingComparisonId },
    select: { params: true },
  });
  const item = await db.rakutenItem.findUniqueOrThrow({
    where: { id: selection.rakutenItemId },
    include: { skus: { orderBy: { id: 'asc' } } },
  });
  const rules = comparisonParamsOf(head.params, settings);
  const judged = judgeStock({
    skus: item.skus,
    itemBackOrderFlag: item.backOrderFlag,
    color: {
      anchorColorCode: selection.anchorColorCode,
      anchorColorLabel: selection.anchorColorLabel,
    },
    gender,
    rules: {
      targetSizeMm: rules.targetSizeMm,
      minSizeCount: rules.minSizeCount,
      defaultWidth: rules.defaultWidth,
      excludeBackOrder: rules.excludeBackOrder,
    },
  });
  const priceOf = new Map(item.skus.map((sku) => [sku.id, sku.taxIncludedPriceYen]));
  const row = selection.comparisonPerformed
    ? await db.sourcingComparisonRow.findFirst({
        where: { sourcingComparisonId: selection.sourcingComparisonId, isSelected: true },
        select: { pointsTotalPt: true },
      })
    : null;
  const sizes = (judged?.sizes ?? []).map((size) => ({
    sizeMm: size.sizeMm,
    status: size.status,
    rakutenSkuId: size.skuId,
    taxIncludedPriceYen: size.skuId !== null ? (priceOf.get(size.skuId) ?? null) : null,
  }));
  return {
    sourcingStepRunId,
    rakutenItemId: item.id,
    gender,
    sizes,
    inStockSizeCount: sizes.filter((size) => size.status === 'IN_STOCK').length,
    pointsTotalPt: row?.pointsTotalPt ?? null,
  };
}

/**
 * ② 버전의 소싱 선택 상품 장르·상품유형(P2-06 Proposed — ④ 입력 '② 장르·상품유형'). 고른 페이지 스냅샷
 * `rakuten_item`의 `genre_id`·`genre_path`(`558885:靴 > 110983:メンズ靴` 사본 → id 경로)·`product_type`. 선택이 없으면 null.
 */
export async function readSourcingGenre(
  db: Db,
  sourcingStepRunId: number,
): Promise<SourcingGenreView | null> {
  const selection = await readSourcingSelection(db, sourcingStepRunId);
  if (!selection) return null;
  const item = await db.rakutenItem.findUniqueOrThrow({
    where: { id: selection.rakutenItemId },
    select: { id: true, genreId: true, genrePath: true, productType: true },
  });
  const path = idPathFromNamePath(item.genrePath) ?? [];
  const genreIdPath =
    path.length > 0 ? path : item.genreId !== null ? [item.genreId] : ([] as number[]);
  return {
    sourcingStepRunId,
    rakutenItemId: item.id,
    genreId: item.genreId ?? genreIdPath.at(-1) ?? null,
    genreIdPath,
    productType: item.productType,
  };
}

/**
 * ② 버전의 소싱 선택 상품 원본 이미지 출처(P3-01 Proposed — ⑤ 원본 받기). 고른 페이지 스냅샷의 `image_urls`(`media.images[]`)·
 * 샵·정규화 型番과, SKU 색상 코드가 하나뿐이면 그 색상 코드(여럿·없으면 null). 선택이 없으면 null.
 */
export async function readSourcingImages(
  db: Db,
  sourcingStepRunId: number,
): Promise<SourcingImagesView | null> {
  const selection = await readSourcingSelection(db, sourcingStepRunId);
  if (!selection) return null;
  const item = await db.rakutenItem.findUniqueOrThrow({
    where: { id: selection.rakutenItemId },
    select: {
      id: true,
      itemCode: true,
      shopCode: true,
      shopName: true,
      itemUrl: true,
      collectedAt: true,
      imageUrls: true,
      modelCodeNorm: true,
      skus: { select: { colorCode: true } },
    },
  });
  const colors = [
    ...new Set(item.skus.map((sku) => sku.colorCode).filter((c): c is string => !!c)),
  ];
  return {
    sourcingStepRunId,
    rakutenItemId: item.id,
    itemCode: item.itemCode,
    shopCode: item.shopCode,
    shopName: item.shopName,
    itemUrl: item.itemUrl,
    collectedAt: item.collectedAt,
    imageUrls: Array.isArray(item.imageUrls)
      ? item.imageUrls.filter((u): u is string => typeof u === 'string' && u !== '')
      : [],
    modelCodeNorm: item.modelCodeNorm,
    colorCode: colors.length === 1 ? colors[0]! : null,
  };
}

/**
 * ② 버전의 소싱 선택 상품 글·속성(P3-03 Proposed — ⑥-1·⑥-2 입력). 고른 페이지 스냅샷의 상품명·설명(NFKC 글·HTML 원문)·상품
 * 속성과, 선택 색상(앵커 색상 코드 → 라벨) SKU의 속성(대표 SKU 먼저). 선택 색상 SKU가 없으면 모든 SKU. 선택이 없으면 null.
 */
export async function readSourcingItemContent(
  db: Db,
  sourcingStepRunId: number,
): Promise<SourcingItemContentView | null> {
  const selection = await readSourcingSelection(db, sourcingStepRunId);
  if (!selection) return null;
  const item = await db.rakutenItem.findUniqueOrThrow({
    where: { id: selection.rakutenItemId },
    select: {
      id: true,
      itemCode: true,
      itemUrl: true,
      itemName: true,
      modelCode: true,
      descriptionText: true,
      descriptionHtml: true,
      attributes: true,
      collectedAt: true,
      skus: {
        orderBy: { id: 'asc' },
        select: { id: true, colorCode: true, colorLabel: true, attributes: true },
      },
    },
  });
  const sameColor = item.skus.filter(
    (sku) =>
      (selection.anchorColorCode !== null && sku.colorCode === selection.anchorColorCode) ||
      (selection.anchorColorLabel !== null && sku.colorLabel === selection.anchorColorLabel),
  );
  const skus = (sameColor.length > 0 ? sameColor : item.skus).sort((a, b) =>
    a.id === selection.representativeRakutenSkuId
      ? -1
      : b.id === selection.representativeRakutenSkuId
        ? 1
        : a.id - b.id,
  );
  return {
    sourcingStepRunId,
    rakutenItemId: item.id,
    itemCode: item.itemCode,
    itemUrl: item.itemUrl,
    itemName: item.itemName,
    modelCode: item.modelCode,
    descriptionText: item.descriptionText,
    descriptionHtml: item.descriptionHtml,
    itemAttributes: item.attributes ?? null,
    skuAttributes: skus.map((sku) => sku.attributes ?? null).filter((a) => a !== null),
    selectedColorRaw: selection.anchorColorLabel,
    collectedAt: item.collectedAt,
  };
}

/**
 * step-engine에 등록할 읽기 함수(`StepEngineApi.registerSourcingSelectionReader`). 목표 사이즈 SKU 읽기(P2-05)는 버전
 * 설정 사본에 빠진 값을 지금 설정으로 채우므로 설정 읽기를 받는다.
 */
export function createSourcingSelectionReader(
  currentSettings: () => Readonly<AppSettings>,
): SourcingSelectionReader {
  return {
    read: readSourcingSelection,
    readTargetSkus: (db, sourcingStepRunId, gender) =>
      readSourcingTargetSkus(db, sourcingStepRunId, gender, currentSettings()),
    readGenre: readSourcingGenre,
    readImages: readSourcingImages,
    readItemContent: readSourcingItemContent,
  };
}

/**
 * 재조회할 바탕 버전(F-SO-17): 이 후보의 ② 버전 중 소싱 선택이 있는 가장 최근 버전(완료·재실행 필요). `beforeRunId`를 주면
 * 그보다 앞 버전만 본다(재조회 실행 자신을 빼려고). 없으면 null → 409 SOURCING_SELECTION_REQUIRED.
 */
export async function latestSelectionBase(
  db: Db,
  candidateId: number,
  beforeRunId?: number,
): Promise<SourcingSelectionView | null> {
  const runs = await db.stepRun.findMany({
    where: {
      candidateId,
      stepCode: 'SOURCING',
      status: { in: ['COMPLETED', 'RERUN_REQUIRED'] },
      ...(beforeRunId !== undefined ? { id: { lt: beforeRunId } } : {}),
    },
    orderBy: { version: 'desc' },
    select: { id: true },
    take: 20,
  });
  for (const run of runs) {
    const selection = await readSourcingSelection(db, run.id);
    if (selection) return selection;
  }
  return null;
}
