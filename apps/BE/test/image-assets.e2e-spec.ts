import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { FileStorageService } from '../src/common/files/file-storage.service.js';
import type { SaveImageMeta } from '../src/common/files/image-asset.rules.js';
import { ImageAssetsService } from '../src/common/files/image-assets.service.js';
import { createTestApp, type TestApp, truncate } from './helpers/test-app.js';

const FIXTURES = join(import.meta.dirname, 'fixtures', 'common', 'images');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

/** 05-2 ImageAssetMeta required 19개 */
const META_KEYS = [
  'id',
  'kind',
  'sha256',
  'byteSize',
  'mimeType',
  'width',
  'height',
  'sourceSection',
  'sourceUrl',
  'sourceItemCode',
  'sourceShopCode',
  'sourceModelCodeNorm',
  'sourceColorCode',
  'collectedAt',
  'usageRight',
  'candidateId',
  'derivedFromImageAssetId',
  'createdAt',
  'fileUrl',
];

const originalMeta = (itemCode = 'fixture-shop:item-1'): SaveImageMeta => ({
  kind: 'ORIGINAL',
  sourceSection: 'PRODUCT_IMAGE',
  sourceUrl: 'https://item.rakuten.co.jp/fixture-shop/item-1/',
  sourceItemCode: itemCode,
  sourceShopCode: 'fixture-shop',
  collectedAt: new Date('2026-09-28T01:00:00Z'),
});

describe('이미지 파일(e2e, image_asset)', () => {
  let t: TestApp;
  let images: ImageAssetsService;
  let storage: FileStorageService;
  const http = () => request(t.app.getHttpServer());

  const imageFiles = (): string[] => {
    const root = join(storage.rootDir, 'images');
    try {
      return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter((d) => d.isFile())
        .map((d) => d.name);
    } catch {
      return [];
    }
  };

  beforeAll(async () => {
    t = await createTestApp();
    images = t.app.get(ImageAssetsService);
    storage = t.app.get(FileStorageService);
  });

  beforeEach(async () => {
    await truncate(t.prisma, ['image_asset']);
    rmSync(join(storage.rootDir, 'images'), { recursive: true, force: true });
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('데이터 폴더는 os.tmpdir() 아래 임시 폴더다(저장소 .data를 쓰지 않는다)', () => {
    expect(storage.rootDir).toContain('autostore-e2e-');
  });

  it('없는 id → 404 IMAGE_ASSET_NOT_FOUND 봉투(메타·파일 모두)', async () => {
    for (const path of ['/api/v1/image-assets/999', '/api/v1/image-assets/999/file']) {
      const res = await http().get(path).expect(404);
      expect(res.body).toMatchObject({
        code: 'IMAGE_ASSET_NOT_FOUND',
        status: 404,
        message: '이미지를 찾을 수 없습니다.',
        path,
      });
    }
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])(
    'id 형식이 아니면(%s) 그런 이미지는 없다 → 404 IMAGE_ASSET_NOT_FOUND',
    async (id) => {
      const res = await http().get(`/api/v1/image-assets/${id}`).expect(404);
      expect((res.body as { code: string }).code).toBe('IMAGE_ASSET_NOT_FOUND');
    },
  );

  it('같은 바이트를 두 번 saveImage(ORIGINAL) → 행 1개, 파일 1개', async () => {
    const buf = fixture('solid-red-16x12.jpg');
    const a = await images.saveImage(buf, originalMeta());
    const b = await images.saveImage(buf, originalMeta());
    expect(b.id).toBe(a.id);
    expect(await t.prisma.imageAsset.count()).toBe(1);
    expect(imageFiles()).toHaveLength(1);
    const sha = createHash('sha256').update(buf).digest('hex');
    expect(a.filePath).toBe(`images/${sha.slice(0, 2)}/${sha}.jpg`);
  });

  it('같은 파일이 다른 상품 원본이면 행은 따로, 디스크 파일은 하나', async () => {
    const buf = fixture('solid-red-16x12.jpg');
    const a = await images.saveImage(buf, originalMeta('shop:a'));
    const b = await images.saveImage(buf, originalMeta('shop:b'));
    expect(b.id).not.toBe(a.id);
    expect(imageFiles()).toHaveLength(1);
  });

  it('부르는 쪽 트랜잭션 안에서도 저장된다(ORIGINAL 중복도 트랜잭션을 깨지 않는다)', async () => {
    const buf = fixture('solid-green-16x12.png');
    await images.saveImage(buf, originalMeta());
    const again = await t.prisma.$transaction(async (tx) => {
      const row = await images.saveImage(buf, originalMeta(), tx);
      const count = await tx.imageAsset.count();
      return { row, count };
    });
    expect(again.count).toBe(1);
  });

  it('메타 200: 키가 ImageAssetMeta required 19개와 같고 filePath·로컬 경로가 없다', async () => {
    const row = await images.saveImage(fixture('solid-red-16x12.jpg'), originalMeta());
    const res = await http().get(`/api/v1/image-assets/${row.id}`).expect(200);
    const body = res.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...META_KEYS].sort());
    expect(body).not.toHaveProperty('filePath');
    expect(JSON.stringify(body)).not.toContain(storage.rootDir);
    expect(body).toMatchObject({
      id: row.id,
      kind: 'ORIGINAL',
      mimeType: 'image/jpeg',
      width: 16,
      height: 12,
      usageRight: 'REFERENCE_ONLY',
      candidateId: null,
      sourceSection: 'PRODUCT_IMAGE',
      collectedAt: '2026-09-28T01:00:00.000Z',
      fileUrl: `/api/v1/image-assets/${row.id}/file`,
    });
  });

  it('/file 200: Content-Type·ETag·Cache-Control, 같은 If-None-Match → 304 본문 없음', async () => {
    const buf = fixture('solid-red-16x12.jpg');
    const row = await images.saveImage(buf, originalMeta());
    const res = await http()
      .get(`/api/v1/image-assets/${row.id}/file`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers.etag).toBe(`"${row.sha256}"`);
    expect(res.headers['cache-control']).toBe('private, immutable');
    expect((res.body as Buffer).equals(buf)).toBe(true);

    const notModified = await http()
      .get(`/api/v1/image-assets/${row.id}/file`)
      .set('If-None-Match', `"${row.sha256}"`)
      .expect(304);
    expect(notModified.text ?? '').toBe('');
    expect(notModified.headers.etag).toBe(`"${row.sha256}"`);

    await http()
      .get(`/api/v1/image-assets/${row.id}/file`)
      .set('If-None-Match', `"${'0'.repeat(64)}"`)
      .expect(200);
  });

  it('파일을 지운 뒤 → 404 IMAGE_FILE_MISSING. 다시 저장하면 파일이 돌아온다', async () => {
    const buf = fixture('solid-blue-16x12.webp');
    const row = await images.saveImage(buf, originalMeta());
    rmSync(storage.resolve(row.filePath));
    const res = await http().get(`/api/v1/image-assets/${row.id}/file`).expect(404);
    expect(res.body).toMatchObject({
      code: 'IMAGE_FILE_MISSING',
      message: '이미지 파일이 데이터 폴더에 없습니다.',
    });
    // 메타는 행만 보므로 그대로 200
    await http().get(`/api/v1/image-assets/${row.id}`).expect(200);
    await images.saveImage(buf, originalMeta());
    await http().get(`/api/v1/image-assets/${row.id}/file`).expect(200);
  });

  it('.jpg 이름의 PNG → mimeType image/png(확장자를 믿지 않는다)', async () => {
    const row = await images.saveImage(fixture('png-content-named.jpg'), originalMeta());
    expect(row.mimeType).toBe('image/png');
    expect(row.filePath.endsWith('.png')).toBe(true);
    const res = await http().get(`/api/v1/image-assets/${row.id}/file`).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
  });

  it('규칙 위반(ORIGINAL에 candidateId)은 행도 파일도 만들지 않는다', async () => {
    await expect(
      images.saveImage(fixture('solid-red-16x12.jpg'), { ...originalMeta(), candidateId: 1 }),
    ).rejects.toThrow(/candidateId/);
    expect(await t.prisma.imageAsset.count()).toBe(0);
    expect(imageFiles()).toHaveLength(0);
  });

  it('image_asset은 추가만 한다(UPDATE는 트리거가 막는다)', async () => {
    const row = await images.saveImage(fixture('solid-red-16x12.jpg'), originalMeta());
    await expect(
      t.prisma.imageAsset.update({ where: { id: row.id }, data: { width: 1 } }),
    ).rejects.toThrow();
  });
});
