import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { FileStorageService } from '../../common/files/file-storage.service.js';
import type { Prisma, RakutenItem, RakutenSku } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { ParsedItemPage } from './page-json.parser.js';

/** 원본 페이지 파일 폴더(APP_DATA_DIR 아래, 내용 주소 — Proposed 06-4 §2.1): rakuten/pages/<sha 앞 2자>/<sha>.html */
export const RAKUTEN_PAGES_DIR = 'rakuten/pages';

export type RakutenEntrySource = 'API' | 'MANUAL';
export type RakutenFetchReason = 'SOURCING' | 'URL_ENTRY' | 'STOCK_CHECK' | 'REFETCH' | 'SYNC';
export type RakutenGenreSource = 'API' | 'PAGE_JSON' | 'ITEM_SEARCH' | 'NOT_FOUND';

export interface RakutenItemSnapshotWrite {
  page: ParsedItemPage;
  itemCode: string;
  shopCode: string;
  itemUrl: string;
  entrySource: RakutenEntrySource;
  fetchReason: RakutenFetchReason;
  collectedAt: Date;
  genreId: number | null;
  genreSource: RakutenGenreSource;
  genrePath: string | null;
  /** 받은 바이트 그대로(해시·크기의 원본) */
  rawBytes: Buffer;
}

export type RakutenItemWithSkus = RakutenItem & { skus: RakutenSku[] };

function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined ? undefined : value;
}

/**
 * 라쿠텐 페이지 스냅샷(ERD `rakuten_item`·`rakuten_sku` — 추가만, 트리거가 수정·삭제를 막는다). 조회할 때마다 새 행이다
 * (재조회·재고 확인·URL 입구 모두). 원본 바이트는 사용자 데이터 폴더에 받은 그대로 두고(P1-01 파일 저장) 경로·SHA-256·크기를
 * 남긴다. 스냅샷과 SKU는 한 트랜잭션으로 넣는다. 파싱에 실패한 페이지는 부르는 쪽이 이 함수를 부르지 않는다.
 */
@Injectable()
export class RakutenItemRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
  ) {}

  async insertSnapshot(write: RakutenItemSnapshotWrite): Promise<RakutenItemWithSkus> {
    const sha256 = createHash('sha256').update(write.rawBytes).digest('hex');
    const rawFilePath = `${RAKUTEN_PAGES_DIR}/${sha256.slice(0, 2)}/${sha256}.html`;
    await this.files.writeIfAbsent(rawFilePath, write.rawBytes);
    const { page } = write;
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.rakutenItem.create({
        data: {
          itemCode: write.itemCode,
          shopCode: write.shopCode.slice(0, 64),
          shopName: page.shopName,
          itemName: page.itemName,
          itemUrl: write.itemUrl.slice(0, 2048),
          modelCode: page.modelCode,
          modelCodeNorm: page.modelCodeNorm,
          entrySource: write.entrySource,
          fetchReason: write.fetchReason,
          collectedAt: write.collectedAt,
          genreId: write.genreId,
          genreSource: write.genreSource,
          genrePath: write.genrePath?.slice(0, 500) ?? null,
          productType: null,
          backOrderFlag: page.backOrderFlag,
          unlimitedInventory: page.unlimitedInventory,
          allSkuSamePrice: page.allSkuSamePrice,
          saleStartsAt: page.saleStartsAt,
          saleEndsAt: page.saleEndsAt,
          descriptionHtml: page.descriptionHtml,
          descriptionText: page.descriptionText,
          attributes: json(page.attributes),
          variantSelectors: json(page.variantSelectors),
          imageUrls: page.imageUrls,
          manualCheckRequired: page.manualCheckRequired,
          manualCheckNote: page.manualCheckNote,
          rawFilePath,
          rawFileSha256: sha256,
          rawFileBytes: write.rawBytes.length,
        },
      });
      if (page.skus.length > 0) {
        await tx.rakutenSku.createMany({
          data: page.skus.map((sku) => ({
            rakutenItemId: item.id,
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
            selectorValues: sku.selectorValues ?? [],
            attributes: json(sku.attributes),
          })),
        });
      }
      const skus = await tx.rakutenSku.findMany({
        where: { rakutenItemId: item.id },
        orderBy: { id: 'asc' },
      });
      return { ...item, skus };
    });
  }

  findWithSkus(id: number, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    return db.rakutenItem.findUnique({
      where: { id },
      include: { skus: { orderBy: { id: 'asc' } } },
    }) as Promise<RakutenItemWithSkus | null>;
  }
}
