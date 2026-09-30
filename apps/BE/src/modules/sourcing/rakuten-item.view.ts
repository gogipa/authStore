import type { RakutenSku } from '../../generated/prisma/client.js';
import type { RakutenItemSnapshotDto, RakutenSkuVariantDto } from './dto/rakuten.dto.js';
import type { RakutenItemWithSkus } from './rakuten-item.repository.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toSkuVariant(sku: RakutenSku): RakutenSkuVariantDto {
  return {
    id: sku.id,
    variantId: sku.variantId,
    colorLabel: sku.colorLabel,
    colorCode: sku.colorCode,
    sizeLabel: sku.sizeLabel,
    sizeMm: sku.sizeMm,
    widthLabel: sku.widthLabel,
    taxIncludedPriceYen: sku.taxIncludedPriceYen,
    quantity: sku.quantity,
    hidden: sku.hidden,
    backOrder: sku.backOrder,
    stockCondition: sku.stockCondition,
    articleNumber: sku.articleNumber,
    postageIncluded: sku.postageIncluded,
    singleItemShipping: sku.singleItemShipping,
    selectorValues: sku.selectorValues,
    attributes: sku.attributes ?? null,
  };
}

/** rakuten_item → 05-2 RakutenItemSnapshot. 설명 HTML·원본 파일 경로·해시·크기는 빼고 준다(로컬 경로 노출 금지) */
export function toSnapshot(item: RakutenItemWithSkus): RakutenItemSnapshotDto {
  return {
    id: item.id,
    itemCode: item.itemCode,
    shopCode: item.shopCode,
    shopName: item.shopName,
    itemName: item.itemName,
    itemUrl: item.itemUrl,
    modelCode: item.modelCode,
    modelCodeNorm: item.modelCodeNorm,
    entrySource: item.entrySource,
    fetchReason: item.fetchReason,
    collectedAt: item.collectedAt.toISOString(),
    genreId: item.genreId,
    genreSource: item.genreSource,
    genrePath: item.genrePath,
    productType: item.productType,
    backOrderFlag: item.backOrderFlag,
    unlimitedInventory: item.unlimitedInventory,
    allSkuSamePrice: item.allSkuSamePrice,
    saleStartsAt: iso(item.saleStartsAt),
    saleEndsAt: iso(item.saleEndsAt),
    descriptionText: item.descriptionText,
    attributes: item.attributes ?? null,
    variantSelectors: item.variantSelectors ?? null,
    imageUrls: Array.isArray(item.imageUrls) ? (item.imageUrls as string[]) : [],
    manualCheckRequired: item.manualCheckRequired,
    manualCheckNote: item.manualCheckNote,
    skus: item.skus.map(toSkuVariant),
  };
}
