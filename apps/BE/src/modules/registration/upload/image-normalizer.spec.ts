import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ImageNormalizeError, normalizeForUpload } from './image-normalizer.js';

const FIXTURES = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  'test',
  'fixtures',
  'registration',
  'upload',
);
const bytes = (name: string) => readFileSync(join(FIXTURES, name));

describe('image-normalizer — 실제 형식 판별 + 1000×1000 JPEG(F-AP-02, 규칙 6)', () => {
  it('PNG 1024×1024 → image/jpeg, 1000×1000, 10MB 미만', async () => {
    const out = await normalizeForUpload(bytes('gen-1024.png'));
    expect(out).toMatchObject({
      mimeType: 'image/jpeg',
      width: 1000,
      height: 1000,
      detectedMime: 'image/png',
      sourceWidth: 1024,
      sourceHeight: 1024,
    });
    const meta = await sharp(out.buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1000, 1000]);
    expect(out.byteSize).toBe(out.buffer.length);
    expect(out.byteSize).toBeLessThan(10_485_760);
  });

  it('이름은 .jpg, 실제는 WebP → 판별 결과 image/webp, 출력은 JPEG', async () => {
    const out = await normalizeForUpload(bytes('gen-webp-named.jpg'));
    expect(out.detectedMime).toBe('image/webp');
    expect((await sharp(out.buffer).metadata()).format).toBe('jpeg');
  });

  it('정사각이 아닌 원천(600×900)은 자르지 않고 흰색으로 채운다(Proposed)', async () => {
    const out = await normalizeForUpload(bytes('gen-portrait.png'));
    expect([out.width, out.height, out.sourceWidth, out.sourceHeight]).toEqual([
      1000, 1000, 600, 900,
    ]);
    // 왼쪽 위 모서리 = 채운 흰색
    const { data } = await sharp(out.buffer)
      .extract({ left: 0, top: 0, width: 4, height: 4 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(Math.min(...data)).toBeGreaterThan(245);
  });

  it('4MB 원천도 정규화본은 1000×1000 · 10MB 미만', async () => {
    const source = bytes('big-4mb.jpg');
    expect(source.length).toBeGreaterThan(4_000_000);
    const out = await normalizeForUpload(source);
    expect([out.width, out.height, out.detectedMime]).toEqual([1000, 1000, 'image/jpeg']);
    expect(out.byteSize).toBeLessThan(10_485_760);
  });

  it('이미지가 아니면 UNSUPPORTED_FORMAT(확장자를 믿지 않는다)', async () => {
    await expect(normalizeForUpload(bytes('html-with-placeholders.html'))).rejects.toThrow(
      ImageNormalizeError,
    );
    // 앞 바이트는 JPEG인데 깨진 파일
    const broken = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('broken')]);
    await expect(normalizeForUpload(broken)).rejects.toMatchObject({ reason: 'UNREADABLE' });
    await expect(normalizeForUpload(Buffer.from('<html>'))).rejects.toMatchObject({
      reason: 'UNSUPPORTED_FORMAT',
    });
  });
});
