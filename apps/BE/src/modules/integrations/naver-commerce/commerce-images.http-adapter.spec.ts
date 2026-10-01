import { ApiException } from '../../../common/errors/api.exception.js';
import { createCommerceKit } from '../../../../test/support/commerce-test-kit.js';
import {
  uploadFixture,
  uploadFixtureBytes,
} from '../../../../test/support/fake-commerce-images.js';
import {
  FAKE_ACCESS_TOKEN,
  type RecordedCommerceRequest,
} from '../../../../test/support/fake-commerce-transport.js';
import { uploadFailureOf } from '../../registration/upload/upload.step-runner.js';
import { CommerceImagesHttpAdapter, uploadUrlsOf } from './commerce-images.http-adapter.js';
import {
  COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH,
  type CommerceUploadFile,
} from './commerce-images.port.js';

const files = (): CommerceUploadFile[] => [
  { fileName: 'upload-1.jpg', mimeType: 'image/jpeg', bytes: uploadFixtureBytes('gen-1024.png') },
  {
    fileName: 'upload-2.jpg',
    mimeType: 'image/jpeg',
    bytes: uploadFixtureBytes('gen-webp-named.jpg'),
  },
];

function setup() {
  const kit = createCommerceKit();
  const adapter = new CommerceImagesHttpAdapter(kit.client);
  const uploads = () =>
    kit.transport.apiRequests.filter((r) => r.path.endsWith(COMMERCE_PRODUCT_IMAGES_UPLOAD_PATH));
  return { ...kit, adapter, uploads };
}

function partsOf(req: RecordedCommerceRequest) {
  return [...(req.form?.entries() ?? [])].map(([name, value]) => ({
    name,
    file: value instanceof Blob ? value : null,
  }));
}

describe('커머스API 이미지 업로드 어댑터(가짜 커머스 서버, P4-01 규칙 8·14)', () => {
  it('정상: POST /v1/product-images/upload, multipart 필드 imageFiles(파일 순서), 토큰은 Authorization 헤더에만, Trace-ID를 읽는다', async () => {
    const { adapter, transport, uploads } = setup();
    transport.respondWith('token-200', uploadFixture('200'));
    const result = await adapter.uploadProductImages(files(), { candidateId: 3, stepRunId: 40 });
    expect(result).toEqual({
      urls: [
        'https://shop-phinf.pstatic.net/20261001_101/fixture-upload-1.jpg',
        'https://shop-phinf.pstatic.net/20261001_102/fixture-upload-2.jpg',
      ],
      traceId: 'fixture-trace-upload-200',
    });
    const [req] = uploads();
    expect(req!.method).toBe('POST');
    expect(req!.url).toBe('https://api.commerce.naver.com/external/v1/product-images/upload');
    const parts = partsOf(req!);
    expect(parts.map((p) => p.name)).toEqual(['imageFiles', 'imageFiles']);
    expect(parts.map((p) => [p.file?.name, p.file?.type, p.file?.size])).toEqual([
      ['upload-1.jpg', 'image/jpeg', files()[0]!.bytes.length],
      ['upload-2.jpg', 'image/jpeg', files()[1]!.bytes.length],
    ]);
    expect(req!.headers.authorization).toBe(`Bearer ${FAKE_ACCESS_TOKEN}`);
    // 토큰은 헤더 밖(주소·본문 부분 이름)에 없다
    expect(req!.url).not.toContain(FAKE_ACCESS_TOKEN);
    expect(JSON.stringify(parts.map((p) => [p.name, p.file?.name]))).not.toContain(
      FAKE_ACCESS_TOKEN,
    );
    // Content-Type(경계)은 fetch가 붙인다 — 클라이언트가 multipart에 직접 넣지 않는다
    expect(req!.contentType).toBeNull();
  });

  it('500 → 외부 실패(502 EXTERNAL_API_ERROR, reason HTTP_500) → ⑧ FAILED(EXTERNAL_API)로 분류', async () => {
    const { adapter, transport } = setup();
    transport.respondWith('token-200', uploadFixture('500'));
    const error = await adapter.uploadProductImages(files()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiException);
    expect(error).toMatchObject({
      code: 'EXTERNAL_API_ERROR',
      details: { target: 'COMMERCE_API', reason: 'HTTP_500', httpStatus: 500 },
    });
    expect(uploadFailureOf(error)).toMatchObject({
      kind: 'FAILED',
      failureKind: 'EXTERNAL_API',
      errorCode: 'EXTERNAL_API_ERROR',
    });
  });

  it('타임아웃(관문이 던지는 502 TIMEOUT) → 외부 실패로 분류', async () => {
    const { adapter, transport, tokens } = setup();
    // 토큰을 먼저 받아 두고, 다음 요청(업로드)만 응답 없이 끝나게 한다
    transport.respondWith('token-200');
    await tokens.getToken();
    transport.failNext(
      new ApiException('EXTERNAL_API_ERROR', {
        details: { target: 'COMMERCE_API', reason: 'TIMEOUT' },
      }),
    );
    const error = await adapter.uploadProductImages(files()).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'EXTERNAL_API_ERROR', details: { reason: 'TIMEOUT' } });
    expect(uploadFailureOf(error)).toMatchObject({ failureKind: 'EXTERNAL_API' });
  });

  it('400 → 502 HTTP_400. URL 수가 파일 수와 다르거나 모양이 다르면 저장할 수 없어 실패', async () => {
    const { adapter, transport } = setup();
    transport.respondWith('token-200', uploadFixture('400'));
    await expect(adapter.uploadProductImages(files())).rejects.toMatchObject({
      details: { reason: 'HTTP_400' },
    });
    transport.respondWith({
      status: 200,
      headers: {},
      body: { images: [{ url: 'https://shop-phinf.pstatic.net/only-one.jpg' }] },
    });
    await expect(adapter.uploadProductImages(files())).rejects.toMatchObject({
      details: { reason: 'URL_COUNT_MISMATCH' },
    });
    transport.respondWith({ status: 200, headers: {}, body: { images: [{ url: 'http://x' }] } });
    await expect(adapter.uploadProductImages(files())).rejects.toMatchObject({
      details: { reason: 'INVALID_RESPONSE' },
    });
  });

  it('응답 모양 가정(M0 S3 전): {images:[{url}]} 또는 배열', () => {
    expect(uploadUrlsOf({ images: [{ url: 'https://a/1.jpg' }] })).toEqual(['https://a/1.jpg']);
    expect(uploadUrlsOf(['https://a/1.jpg', { url: 'https://a/2.jpg' }])).toEqual([
      'https://a/1.jpg',
      'https://a/2.jpg',
    ]);
    expect(uploadUrlsOf({ urls: [] })).toBeNull();
    expect(uploadUrlsOf({ images: [{ url: `https://${'a'.repeat(500)}` }] })).toBeNull();
  });

  it('빈 목록은 부르지 않는다', async () => {
    const { adapter, uploads } = setup();
    expect(await adapter.uploadProductImages([])).toEqual({ urls: [], traceId: null });
    expect(uploads()).toHaveLength(0);
  });
});
