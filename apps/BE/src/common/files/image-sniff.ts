import type { SupportedImageMime } from './image-asset.rules.js';

/**
 * 파일 앞머리(매직 바이트)로 이미지 형식을 판별한다(확장자를 믿지 않는다 — ERD `image_asset.mime_type`). 받는 형식은 P1-01
 * 이미지 저장과 같은 JPEG·PNG·WebP·GIF. 모르면 null.
 * P3-01이 ⑤ 원본 받기에 처음 만들었고, P4-01 ⑧ 업로드 정규화(agy 생성본은 확장자와 실제 포맷이 다를 수 있다 — PRD §8.4)가 같이
 * 쓰도록 common으로 옮겼다(thumbnails는 다시 내보낸다).
 */
export function sniffImageMime(bytes: Uint8Array): SupportedImageMime | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (buf.length >= 6) {
    const head = buf.subarray(0, 6).toString('latin1');
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
