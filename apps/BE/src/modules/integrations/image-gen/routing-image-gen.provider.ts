import type { OnApplicationBootstrap } from '@nestjs/common';
import type { NodeEnv } from '../../../common/config/env.validation.js';
import { FakeImageGenProvider } from './fake-image-gen.provider.js';
import {
  ImageGenError,
  type ImageGenIdentity,
  type ImageGenProvider,
  type ImageGenProviderCode,
  type ImageGenRequest,
  type ImageGenResult,
} from './image-gen.port.js';

/** 어댑터가 없는 공급자를 고른 시도의 모델 칸(이력에서 보인다) */
export const IMAGE_GEN_NOT_CONNECTED_MODEL = 'not-connected';
/** 어댑터가 없는 공급자로 생성하려 할 때 call_log·실패 코드(Proposed) */
export const IMAGE_GEN_NOT_CONNECTED_CODE = 'IMAGE_GEN_PROVIDER_NOT_CONNECTED';

export function imageGenNotConnectedMessage(code: ImageGenProviderCode): string {
  return `이미지 생성 공급자 ${code}는 아직 앱에 연결되지 않았습니다. 설정 thumbnail.imageProvider를 AGY로 두세요(D-19).`;
}

/**
 * 설정 공급자(`thumbnail.imageProvider` → 시도 행의 `provider`)로 실제 어댑터를 고른다(M0 S1·D-19, P3-02 규칙 15).
 * - `identify(code)`: 그 공급자의 어댑터가 있으면 어댑터 값, 없으면 `{ code, 'not-connected', null }`(던지지 않는다)
 * - `generate`: 시도 행에 기록한 `identity.provider`의 어댑터만 부른다(다른 공급자로 넘어가지 않는다 — 폴백 체인 IM-09는 M2).
 *   어댑터가 없으면 `ImageGenError`(FAILED + 안내 문구)
 * - `onApplicationBootstrap`: 어댑터의 앱 시작 훅(agy `--version` 미리 읽기)을 넘겨준다. 어댑터는 Nest 공급자로 따로 등록하지 않고
 *   이 라우터 안에만 있다 — 그래서 테스트가 `overrideProvider(IMAGE_GEN_PROVIDER)`로 바꾸면 어댑터도 시작 훅도 생기지 않는다
 * 지금은 AGY만 붙는다. GEMINI_API(유료 키)·OPENAI_API·CODEX는 S1 미달 때 오너가 고를 대안이다(D-19).
 */
export class RoutingImageGenProvider implements ImageGenProvider, OnApplicationBootstrap {
  constructor(
    private readonly providers: Readonly<Partial<Record<ImageGenProviderCode, ImageGenProvider>>>,
  ) {}

  onApplicationBootstrap(): void {
    for (const provider of Object.values(this.providers)) {
      if (provider && hasBootstrapHook(provider)) void provider.onApplicationBootstrap();
    }
  }

  identify(code: ImageGenProviderCode): ImageGenIdentity {
    const provider = this.providers[code];
    return provider
      ? provider.identify(code)
      : { provider: code, model: IMAGE_GEN_NOT_CONNECTED_MODEL, providerVersion: null };
  }

  generate(request: ImageGenRequest): Promise<ImageGenResult> {
    const code = request.identity.provider;
    const provider = this.providers[code];
    if (!provider) {
      return Promise.reject(
        new ImageGenError(imageGenNotConnectedMessage(code), IMAGE_GEN_NOT_CONNECTED_CODE),
      );
    }
    return provider.generate(request);
  }
}

function hasBootstrapHook(provider: object): provider is OnApplicationBootstrap {
  return typeof (provider as Partial<OnApplicationBootstrap>).onApplicationBootstrap === 'function';
}

/**
 * `IMAGE_GEN_PROVIDER`에 붙일 공급자(integrations.module). NODE_ENV=test(jest 단위·e2e)는 밖을 부르지 않는 가짜 공급자, 그 밖
 * (개발·운영)은 설정 공급자로 고르는 실제 어댑터다. 흐름 테스트(Playwright)는 NODE_ENV=development로 띄우지만 `flow-app.ts`가
 * `overrideProvider(IMAGE_GEN_PROVIDER)`로 가짜를 넣어 이 함수가 돌지 않는다. e2e도 같은 방법으로 대본 가짜를 넣는다
 */
export function createImageGenProvider(
  nodeEnv: NodeEnv,
  providers: Readonly<Partial<Record<ImageGenProviderCode, ImageGenProvider>>>,
): ImageGenProvider {
  if (nodeEnv === 'test') {
    const fake = new FakeImageGenProvider();
    fake.announceDefault();
    return fake;
  }
  return new RoutingImageGenProvider(providers);
}
