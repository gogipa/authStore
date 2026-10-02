import { FakeImageGenProvider } from './fake-image-gen.provider.js';
import {
  ImageGenError,
  type ImageGenIdentity,
  type ImageGenProvider,
  type ImageGenRequest,
} from './image-gen.port.js';
import {
  createImageGenProvider,
  IMAGE_GEN_NOT_CONNECTED_CODE,
  IMAGE_GEN_NOT_CONNECTED_MODEL,
  imageGenNotConnectedMessage,
  RoutingImageGenProvider,
} from './routing-image-gen.provider.js';

/** AGY 자리에 넣는 기록용 공급자 */
function stubAgy() {
  const calls: ImageGenRequest[] = [];
  const identity: ImageGenIdentity = {
    provider: 'AGY',
    model: 'gemini-3.8-flash-medium',
    providerVersion: '1.2.14',
  };
  const provider: ImageGenProvider = {
    identify: () => identity,
    generate: (request) => {
      calls.push(request);
      return Promise.resolve({ kind: 'IMAGE', bytes: Buffer.from('x'), fileName: 'thumbnail.jpg' });
    },
  };
  return { provider, calls, identity };
}

function request(provider: ImageGenIdentity['provider']): ImageGenRequest {
  return {
    identity: { provider, model: 'm', providerVersion: null },
    prompt: 'p',
    referenceImagePaths: ['/tmp/a.jpg'],
    sizePx: 2048,
    timeoutMs: 1000,
    signal: new AbortController().signal,
  };
}

describe('RoutingImageGenProvider(M0 S1 — 설정 공급자로 실제 어댑터 고르기, D-19)', () => {
  it('identify: AGY는 어댑터 값, 어댑터가 없는 공급자는 not-connected(던지지 않는다)', () => {
    const agy = stubAgy();
    const router = new RoutingImageGenProvider({ AGY: agy.provider });
    expect(router.identify('AGY')).toEqual(agy.identity);
    expect(router.identify('GEMINI_API')).toEqual({
      provider: 'GEMINI_API',
      model: IMAGE_GEN_NOT_CONNECTED_MODEL,
      providerVersion: null,
    });
  });

  it('generate: 시도 행의 공급자 어댑터만 부른다. 어댑터가 없으면 ImageGenError(다른 공급자로 넘어가지 않는다)', async () => {
    const agy = stubAgy();
    const router = new RoutingImageGenProvider({ AGY: agy.provider });
    await expect(router.generate(request('AGY'))).resolves.toMatchObject({ kind: 'IMAGE' });
    expect(agy.calls).toHaveLength(1);
    for (const code of ['GEMINI_API', 'OPENAI_API', 'CODEX'] as const) {
      const err = await router.generate(request(code)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ImageGenError);
      expect(err).toMatchObject({
        code: IMAGE_GEN_NOT_CONNECTED_CODE,
        userMessage: imageGenNotConnectedMessage(code),
      });
    }
    expect(agy.calls).toHaveLength(1);
  });

  it('onApplicationBootstrap: 어댑터의 앱 시작 훅만 넘겨준다(훅이 없는 어댑터는 건너뛴다)', () => {
    let booted = 0;
    const withHook = Object.assign(stubAgy().provider, {
      onApplicationBootstrap: () => {
        booted += 1;
      },
    });
    new RoutingImageGenProvider({
      AGY: withHook,
      CODEX: stubAgy().provider,
    }).onApplicationBootstrap();
    expect(booted).toBe(1);
  });

  it('createImageGenProvider: 테스트 환경은 가짜 공급자, 개발·운영은 설정 공급자 라우터', () => {
    const agy = stubAgy();
    expect(createImageGenProvider('test', { AGY: agy.provider })).toBeInstanceOf(
      FakeImageGenProvider,
    );
    for (const env of ['development', 'production'] as const) {
      const provider = createImageGenProvider(env, { AGY: agy.provider });
      expect(provider).toBeInstanceOf(RoutingImageGenProvider);
      expect(provider.identify('AGY')).toEqual(agy.identity);
    }
  });
});
