import sharp from 'sharp';
import {
  FAKE_IMAGE_GEN_MODEL,
  FAKE_REFUSAL_REASON,
  FakeImageGenProvider,
} from './fake-image-gen.provider.js';
import { ImageGenError, type ImageGenRequest } from './image-gen.port.js';

function request(signal: AbortSignal = new AbortController().signal): ImageGenRequest {
  return {
    identity: { provider: 'AGY', model: FAKE_IMAGE_GEN_MODEL, providerVersion: 'fake-1' },
    prompt: 'square 1:1',
    referenceImagePaths: ['/tmp/ref-1.jpg'],
    sizePx: 64,
    timeoutMs: 1000,
    signal,
  };
}

describe('FakeImageGenProvider(P3-02 가짜 공급자 — 밖을 부르지 않는다)', () => {
  it('identify: 설정 공급자 코드 + fake 모델(이력에서 가짜임이 보인다)', () => {
    expect(new FakeImageGenProvider().identify('GEMINI_API')).toEqual({
      provider: 'GEMINI_API',
      model: 'fake-image-gen',
      providerVersion: 'fake-1',
    });
  });

  it('기본 대본: 요청 크기의 단색 PNG, 부를 때마다 파일이 다르다', async () => {
    const fake = new FakeImageGenProvider();
    const a = await fake.generate(request());
    const b = await fake.generate(request());
    if (a.kind !== 'IMAGE' || b.kind !== 'IMAGE') throw new Error('이미지가 아닙니다');
    const meta = await sharp(a.bytes).metadata();
    expect(meta).toMatchObject({ format: 'png', width: 64, height: 64 });
    expect(a.bytes.equals(b.bytes)).toBe(false);
    expect(fake.calls).toHaveLength(2);
  });

  it('대본 차례: 성공(주어진 바이트) → 거부(사유) → 실패(ImageGenError)', async () => {
    const bytes = Buffer.from('x');
    const fake = new FakeImageGenProvider().enqueue(
      { kind: 'success', bytes, fileName: 'slot-2.jpg' },
      { kind: 'refused' },
      { kind: 'failed', message: '도구 오류' },
    );
    await expect(fake.generate(request())).resolves.toEqual({
      kind: 'IMAGE',
      bytes,
      fileName: 'slot-2.jpg',
    });
    await expect(fake.generate(request())).resolves.toEqual({
      kind: 'REFUSED',
      reason: FAKE_REFUSAL_REASON,
    });
    const failure = fake.generate(request());
    await expect(failure).rejects.toBeInstanceOf(ImageGenError);
    await expect(failure).rejects.toThrow('도구 오류');
  });

  it('timeout 대본: 끝나지 않다가 signal이 끊기면 거절한다', async () => {
    const controller = new AbortController();
    const fake = new FakeImageGenProvider().enqueue({ kind: 'timeout' });
    const pending = fake.generate(request(controller.signal));
    controller.abort(new Error('timeout'));
    await expect(pending).rejects.toThrow('timeout');
  });

  it('hold: 풀어 줄 때까지 결과를 붙잡는다', async () => {
    const fake = new FakeImageGenProvider().enqueue({ kind: 'refused', reason: 'r' });
    const release = fake.hold();
    let done = false;
    const pending = fake.generate(request()).then((r) => {
      done = true;
      return r;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await expect(pending).resolves.toEqual({ kind: 'REFUSED', reason: 'r' });
  });
});
