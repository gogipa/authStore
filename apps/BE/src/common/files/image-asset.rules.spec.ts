import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { BE_ROOT } from '../config/paths.js';
import {
  assertImageAssetRules,
  type DetectedImageInfo,
  ImageAssetRuleError,
  type SaveImageMeta,
  UnsupportedImageError,
  usageRightForKind,
} from './image-asset.rules.js';
import { ImageAssetsService } from './image-assets.service.js';

const FIXTURES = join(BE_ROOT, 'test', 'fixtures', 'common', 'images');
const fixture = (name: string) => readFileSync(join(FIXTURES, name));

const small: DetectedImageInfo = { mimeType: 'image/jpeg', width: 16, height: 12, byteSize: 270 };
const upload: DetectedImageInfo = {
  mimeType: 'image/jpeg',
  width: 1000,
  height: 1000,
  byteSize: 200_000,
};
const original: SaveImageMeta = {
  kind: 'ORIGINAL',
  sourceSection: 'PRODUCT_IMAGE',
  sourceUrl: 'https://item.rakuten.co.jp/shop/item/',
  sourceItemCode: 'shop:item',
  collectedAt: new Date('2026-09-28T00:00:00Z'),
};

const violations = (meta: SaveImageMeta, info: DetectedImageInfo): string[] => {
  try {
    assertImageAssetRules(meta, info);
    return [];
  } catch (e) {
    if (e instanceof ImageAssetRuleError) return e.violations;
    throw e;
  }
};

describe('image_asset 규칙(ERD §3.6 CHECK를 앱에서 먼저)', () => {
  it('권리 용도: 원본·레퍼런스는 REFERENCE_ONLY, 생성·업로드는 PERMITTED', () => {
    expect(usageRightForKind('ORIGINAL')).toBe('REFERENCE_ONLY');
    expect(usageRightForKind('REFERENCE')).toBe('REFERENCE_ONLY');
    expect(usageRightForKind('GENERATED')).toBe('PERMITTED');
    expect(usageRightForKind('UPLOAD')).toBe('PERMITTED');
    expect(violations({ ...original, usageRight: 'PERMITTED' }, small)).toEqual([
      'ORIGINAL의 usageRight는 REFERENCE_ONLY',
    ]);
    expect(
      violations({ kind: 'GENERATED', candidateId: 1, usageRight: 'REFERENCE_ONLY' }, small),
    ).toEqual(['GENERATED의 usageRight는 PERMITTED']);
  });

  it('올바른 ORIGINAL은 통과, 필수 출처가 빠지면 실패', () => {
    expect(violations(original, small)).toEqual([]);
    expect(violations({ kind: 'ORIGINAL' }, small)).toEqual([
      'ORIGINAL은 sourceUrl 필수',
      'ORIGINAL은 sourceItemCode 필수',
      'ORIGINAL은 collectedAt 필수',
      'ORIGINAL은 sourceSection 필수',
    ]);
  });

  it('ORIGINAL만 candidateId가 NULL이다', () => {
    expect(violations({ ...original, candidateId: 3 }, small)).toContain(
      'ORIGINAL은 candidateId가 없어야 한다',
    );
    expect(violations({ kind: 'GENERATED' }, small)).toContain('GENERATED는 candidateId 필수');
    expect(violations({ kind: 'REFERENCE', candidateId: 1 }, small)).toEqual([]);
  });

  it('sourceSection은 ORIGINAL만', () => {
    expect(
      violations({ kind: 'GENERATED', candidateId: 1, sourceSection: 'PRODUCT_IMAGE' }, small),
    ).toContain('sourceSection은 ORIGINAL만');
  });

  it('UPLOAD는 원 파일이 있는 1000×1000 JPEG, 10MB 미만', () => {
    const meta: SaveImageMeta = { kind: 'UPLOAD', candidateId: 1, derivedFromImageAssetId: 9 };
    expect(violations(meta, upload)).toEqual([]);
    expect(violations({ ...meta, derivedFromImageAssetId: null }, upload)).toContain(
      'UPLOAD는 derivedFromImageAssetId 필수',
    );
    expect(violations(meta, { ...upload, mimeType: 'image/png' })).toContain('UPLOAD는 JPEG');
    expect(violations(meta, { ...upload, width: 999 })).toContain('UPLOAD는 1000×1000');
    expect(violations(meta, { ...upload, byteSize: 10_485_760 })).toContain(
      'UPLOAD는 10MB(10,485,760바이트) 미만',
    );
    expect(violations(meta, { ...upload, byteSize: 10_485_759 })).toEqual([]);
  });

  it('열 길이를 넘으면 실패', () => {
    expect(violations({ ...original, sourceItemCode: 'x'.repeat(129) }, small)).toContain(
      'sourceItemCode는 128자 이하',
    );
  });
});

describe('ImageAssetsService.detect(내용으로 형식 판별)', () => {
  it.each([
    ['solid-red-16x12.jpg', 'image/jpeg'],
    ['solid-green-16x12.png', 'image/png'],
    ['solid-blue-16x12.webp', 'image/webp'],
    ['png-content-named.jpg', 'image/png'],
  ])('%s → %s(확장자를 믿지 않는다)', async (name, mime) => {
    const buf = fixture(name);
    const info = await ImageAssetsService.detect(buf);
    expect(info).toEqual({ mimeType: mime, width: 16, height: 12, byteSize: buf.length });
  });

  it('이미지가 아니면 UnsupportedImageError', async () => {
    await expect(ImageAssetsService.detect(Buffer.from('not an image'))).rejects.toThrow(
      UnsupportedImageError,
    );
  });

  it('지원 밖 형식(TIFF)은 UnsupportedImageError', async () => {
    const tiff = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .tiff()
      .toBuffer();
    await expect(ImageAssetsService.detect(tiff)).rejects.toThrow(/tiff/);
  });
});
