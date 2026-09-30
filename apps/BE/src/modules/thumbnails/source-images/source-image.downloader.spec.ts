import { createHash } from 'node:crypto';
import {
  thumbnailImageBytes,
  thumbnailItemFixture,
} from '../../../../test/fixtures/thumbnails/seed-thumbnail-waiting.js';
import { ApiException } from '../../../common/errors/api.exception.js';
import { ImageAssetsService } from '../../../common/files/image-assets.service.js';
import type { SaveImageMeta } from '../../../common/files/image-asset.rules.js';
import type { ImageAsset } from '../../../generated/prisma/client.js';
import type {
  RakutenImageCallContext,
  RakutenImagePort,
  RakutenImageResponse,
} from '../../integrations/rakuten/rakuten-image.port.js';
import type {
  RakutenSearchPort,
  RakutenSearchQuery,
  RakutenSearchResult,
} from '../../integrations/rakuten/rakuten-search.port.js';
import type { OriginalImageStorePort } from './original-image.store.js';
import {
  SourceImageDownloader,
  SourceImageDownloadError,
  sniffImageMime,
  type SourceImagesInput,
} from './source-image.downloader.js';

const FIXTURE = thumbnailItemFixture();
const AT = new Date('2026-09-28T05:10:00Z');
const CTX = { candidateId: 7, stepRunId: 70 };

/** 가짜 이미지 포트: fixture 파일로 답한다(`status`로 상태 코드를 바꾼다) */
class FakeImagePort implements RakutenImagePort {
  calls: string[] = [];
  status: Record<string, number> = {};
  files: Record<string, string> = { ...FIXTURE.imageFiles };

  fetchImage(url: string, _ctx?: RakutenImageCallContext): Promise<RakutenImageResponse> {
    this.calls.push(url);
    const name = this.files[url];
    const status = this.status[url] ?? (name ? 200 : 404);
    return Promise.resolve({
      httpStatus: status,
      bytes: status === 200 && name ? thumbnailImageBytes(name) : Buffer.from('nope'),
      fetchedAt: AT,
      callLogId: this.calls.length,
      finalUrl: url,
    });
  }
}

/** 가짜 Item Search(itemCode 조회 → fixture apiSearchItem) */
class FakeSearchPort implements RakutenSearchPort {
  queries: RakutenSearchQuery[] = [];
  search(query: RakutenSearchQuery): Promise<RakutenSearchResult> {
    this.queries.push(query);
    const raw = FIXTURE.apiSearchItem;
    return Promise.resolve({
      items: [
        {
          itemCode: raw.itemCode,
          itemName: 'x',
          itemUrl: 'x',
          shopCode: 'shop-a',
          shopName: null,
          itemPrice: null,
          itemPriceMin3: null,
          pointRate: null,
          postageFlag: null,
          reviewCount: null,
          reviewAverage: null,
          shipOverseasFlag: null,
          genreId: null,
          raw,
        },
      ],
      page: 1,
      totalCount: 1,
      fetchedAt: AT,
      fromCache: true,
      queryHash: 'q'.repeat(64),
    });
  }
}

/** 메모리 원본 저장소: (itemCode, sha256)이 같으면 기존 행(uq_image_asset_original 흉내). 형식·해상도는 파일 내용으로 */
class MemoryStore implements OriginalImageStorePort {
  rows: ImageAsset[] = [];
  saves = 0;

  findOriginal(itemCode: string, sha256: string): Promise<ImageAsset | null> {
    return Promise.resolve(
      this.rows.find((r) => r.sourceItemCode === itemCode && r.sha256 === sha256) ?? null,
    );
  }

  async save(buffer: Buffer, meta: SaveImageMeta): Promise<ImageAsset> {
    this.saves += 1;
    const info = await ImageAssetsService.detect(buffer);
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = await this.findOriginal(meta.sourceItemCode!, sha256);
    if (existing) return existing;
    const row = {
      id: this.rows.length + 1,
      kind: meta.kind,
      filePath: `images/${sha256.slice(0, 2)}/${sha256}`,
      sha256,
      byteSize: buffer.length,
      mimeType: info.mimeType,
      width: info.width,
      height: info.height,
      sourceSection: meta.sourceSection ?? null,
      sourceUrl: meta.sourceUrl ?? null,
      sourceItemCode: meta.sourceItemCode ?? null,
      sourceShopCode: meta.sourceShopCode ?? null,
      sourceModelCodeNorm: meta.sourceModelCodeNorm ?? null,
      sourceColorCode: meta.sourceColorCode ?? null,
      collectedAt: meta.collectedAt ?? null,
      usageRight: meta.usageRight ?? 'REFERENCE_ONLY',
      candidateId: meta.candidateId ?? null,
      derivedFromImageAssetId: null,
      createdAt: AT,
    } as ImageAsset;
    this.rows.push(row);
    return row;
  }
}

function input(patch: Partial<SourceImagesInput> = {}): SourceImagesInput {
  return {
    itemCode: FIXTURE.rakutenItem.itemCode,
    shopCode: 'shop-a',
    imageUrls: FIXTURE.rakutenItem.imageUrls,
    modelCodeNorm: '1201A019108',
    colorCode: '108',
    ...patch,
  };
}

function setup() {
  const images = new FakeImagePort();
  const search = new FakeSearchPort();
  const store = new MemoryStore();
  const downloader = new SourceImageDownloader(images, search, store);
  return { images, search, store, downloader };
}

describe('sniffImageMime — 매직 바이트로 판별(확장자를 믿지 않는다)', () => {
  it('JPEG·PNG를 내용으로 가른다(png-named.jpg → image/png)', () => {
    expect(sniffImageMime(thumbnailImageBytes('original-1.jpg'))).toBe('image/jpeg');
    expect(sniffImageMime(thumbnailImageBytes('png-named.jpg'))).toBe('image/png');
    expect(sniffImageMime(Buffer.from('GIF89a......'))).toBe('image/gif');
    expect(sniffImageMime(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe('image/webp');
    expect(sniffImageMime(Buffer.from('<html>'))).toBeNull();
  });
});

describe('SourceImageDownloader(P3-01 규칙 3·4, F-TH-01·02)', () => {
  it('media.images[] 6장을 원본 해상도로 받아 ORIGINAL·REFERENCE_ONLY·PRODUCT_IMAGE로 저장한다(출처 메타 포함)', async () => {
    const { images, search, store, downloader } = setup();
    const result = await downloader.download(input(), CTX);
    expect(result.via).toBe('MEDIA_IMAGES');
    expect(images.calls).toEqual(FIXTURE.rakutenItem.imageUrls);
    expect(search.queries).toEqual([]);
    expect(result.images).toHaveLength(6);
    expect(store.rows).toHaveLength(6);
    for (const [i, row] of store.rows.entries()) {
      expect(row).toMatchObject({
        kind: 'ORIGINAL',
        usageRight: 'REFERENCE_ONLY',
        sourceSection: 'PRODUCT_IMAGE',
        candidateId: null,
        sourceUrl: FIXTURE.rakutenItem.imageUrls[i],
        sourceItemCode: 'shop-a:10000123',
        sourceShopCode: 'shop-a',
        sourceModelCodeNorm: '1201A019108',
        sourceColorCode: '108',
        collectedAt: AT,
        mimeType: 'image/jpeg',
      });
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(result.images[5]).toMatchObject({ width: 320, height: 240, reused: false });
  });

  it('png-named.jpg(확장자 jpg, 내용 PNG) → mime_type=image/png', async () => {
    const { images, store, downloader } = setup();
    const url = 'https://tshop.r10s.jp/shop-a/cabinet/item/png-named.jpg';
    images.files[url] = 'png-named.jpg';
    const result = await downloader.download(input({ imageUrls: [url] }), CTX);
    expect(result.images[0]!.mimeType).toBe('image/png');
    expect(store.rows[0]!.mimeType).toBe('image/png');
    expect(store.rows[0]).toMatchObject({ width: 200, height: 200 });
  });

  it('image_urls가 비면 Item Search(itemCode, 필터 없음) 이미지 URL의 _ex를 1200x1200으로 키워 받는다', async () => {
    const { images, search, store, downloader } = setup();
    const result = await downloader.download(input({ imageUrls: [] }), CTX);
    expect(result.via).toBe('API_EX_FALLBACK');
    expect(search.queries).toEqual([{ itemCode: 'shop-a:10000123', sourcingFilters: false }]);
    expect(images.calls).toEqual([
      'https://thumbnail.image.rakuten.co.jp/@0_mall/shop-a/cabinet/asics-1201a019-108_1.jpg?_ex=1200x1200',
      'https://thumbnail.image.rakuten.co.jp/@0_mall/shop-a/cabinet/asics-1201a019-108_2.jpg?_ex=1200x1200',
    ]);
    expect(store.rows.map((r) => r.mimeType)).toEqual(['image/jpeg', 'image/png']);
  });

  it('같은 (itemCode, sha256)은 행을 새로 만들지 않는다(다시 받아도·한 목록에 두 번 있어도)', async () => {
    const { store, downloader } = setup();
    await downloader.download(input(), CTX);
    expect(store.rows).toHaveLength(6);
    const savesBefore = store.saves;
    const again = await downloader.download(input(), CTX);
    expect(store.rows).toHaveLength(6);
    expect(store.saves).toBe(savesBefore);
    expect(again.images.every((i) => i.reused)).toBe(true);
    expect(again.images.map((i) => i.imageAssetId)).toEqual([1, 2, 3, 4, 5, 6]);

    // 같은 파일이 다른 URL로 두 번 → 한 장
    const dup = 'https://tshop.r10s.jp/shop-a/cabinet/item/dup.jpg';
    const { images, store: store2, downloader: d2 } = setup();
    images.files[dup] = 'original-1.jpg';
    const r = await d2.download(
      input({ imageUrls: [FIXTURE.rakutenItem.imageUrls[0]!, dup] }),
      CTX,
    );
    expect(store2.rows).toHaveLength(1);
    expect(r.skipped).toEqual([{ url: dup, reason: 'DUPLICATE' }]);
  });

  it('허용 호스트 밖 주소는 보내지 않고 건너뛴다. 이미지가 아닌 응답도 건너뛴다', async () => {
    const { images, downloader } = setup();
    const bad = 'https://evil.example/x.jpg';
    const html = 'https://tshop.r10s.jp/shop-a/cabinet/item/page.jpg';
    // 이미지가 아닌 본문(fixture JSON 파일)
    images.files[html] = '../rakuten-item-asics-1201A019.json';
    const result = await downloader.download(
      input({ imageUrls: [bad, html, FIXTURE.rakutenItem.imageUrls[0]!] }),
      CTX,
    );
    expect(images.calls).not.toContain(bad);
    expect(result.skipped).toEqual([
      { url: bad, reason: 'HOST_NOT_ALLOWED' },
      { url: html, reason: 'NOT_IMAGE' },
    ]);
    expect(result.images).toHaveLength(1);
  });

  it('2xx가 아닌 응답은 곧바로 멈추고 RAKUTEN_IMAGE_HTTP_<상태>(⑤ FAILED EXTERNAL_API 근거)', async () => {
    const { images, downloader } = setup();
    images.status[FIXTURE.rakutenItem.imageUrls[1]!] = 503;
    await expect(downloader.download(input(), CTX)).rejects.toMatchObject({
      name: 'SourceImageDownloadError',
      errorCode: 'RAKUTEN_IMAGE_HTTP_503',
    });
    expect(images.calls).toHaveLength(2);
  });

  it('한 장도 받지 못하면 SOURCE_IMAGES_NOT_FOUND, 관문 오류는 그대로 던진다', async () => {
    const { downloader } = setup();
    await expect(
      downloader.download(input({ imageUrls: ['https://evil.example/a.jpg'] }), CTX),
    ).rejects.toBeInstanceOf(SourceImageDownloadError);

    const failing = new SourceImageDownloader(
      {
        fetchImage: () =>
          Promise.reject(
            new ApiException('EXTERNAL_API_ERROR', { details: { reason: 'TIMEOUT' } }),
          ),
      },
      new FakeSearchPort(),
      new MemoryStore(),
    );
    await expect(failing.download(input(), CTX)).rejects.toMatchObject({
      code: 'EXTERNAL_API_ERROR',
    });
  });
});
