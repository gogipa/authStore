import { Logger } from '@nestjs/common';
import sharp from 'sharp';
import {
  ImageGenError,
  type ImageGenIdentity,
  type ImageGenProvider,
  type ImageGenProviderCode,
  type ImageGenRequest,
  type ImageGenResult,
} from './image-gen.port.js';

/**
 * 가짜 공급자 대본 한 건(P3-02 §5.1 — test/fixtures/thumbnails/fake-provider-scenarios.json과 같은 이름).
 * - `success`: 이미지(없으면 요청 해상도의 단색 PNG를 만든다 — 부를 때마다 색이 달라 파일 해시가 다르다)
 * - `refused`: 콘텐츠 필터 거부(사유)
 * - `failed`: 생성 실패(`ImageGenError`)
 * - `timeout`: 끝나지 않는다 — 부르는 쪽 하드 타임아웃이 `signal`을 끊을 때까지 기다린다
 */
export type FakeImageGenScenario =
  | { kind: 'success'; bytes?: Buffer; fileName?: string | null }
  | { kind: 'refused'; reason?: string }
  | { kind: 'failed'; message?: string }
  | { kind: 'timeout' };

/** 가짜 공급자가 기록하는 모델·버전(실제 모델과 헷갈리지 않게 'fake'를 붙인다) */
export const FAKE_IMAGE_GEN_MODEL = 'fake-image-gen';
export const FAKE_IMAGE_GEN_VERSION = 'fake-1';

/** 기본 거부 사유·실패 문구(대본에 없을 때) */
export const FAKE_REFUSAL_REASON =
  '인물 생성 제한: 실제 사람과 닮은 얼굴은 만들 수 없습니다(가짜 공급자).';
export const FAKE_FAILURE_MESSAGE = '이미지 생성 도구가 오류로 끝났습니다(가짜 공급자).';

/** 단색 PNG 한 장(한 변 `sizePx`, 색은 `seed`로 정한다) */
export async function solidPng(sizePx: number, seed: number): Promise<Buffer> {
  const side = Math.max(16, Math.min(sizePx, 2048));
  const background = {
    r: 64 + ((seed * 53) % 160),
    g: 64 + ((seed * 97) % 160),
    b: 64 + ((seed * 31) % 160),
  };
  return sharp({ create: { width: side, height: side, channels: 3, background } })
    .png()
    .toBuffer();
}

/**
 * 테스트용 가짜 이미지 생성 공급자(P3-02 §5.1). 테스트 환경(NODE_ENV=test)의 기본 공급자다 — 개발·운영은 M0 S1 뒤 실제 어댑터
 * (`RoutingImageGenProvider` → `AgyImageGenProvider`, D-19)가 붙는다. 밖을 부르지 않고 `call_log`도 남기지 않는다.
 * 대본(`enqueue`)을 차례로 쓰고, 다 쓰면 기본 대본(`setDefault`, 처음에는 단색 PNG 성공)을 쓴다. `hold()`로 다음 결과를
 * 풀어 줄 때까지 붙잡을 수 있다(생성 중 상태를 보는 e2e). 기록 모델은 `fake-image-gen`이라 이력에서 가짜임이 보인다.
 */
export class FakeImageGenProvider implements ImageGenProvider {
  private readonly logger = new Logger(FakeImageGenProvider.name);
  private readonly queue: FakeImageGenScenario[] = [];
  private fallback: FakeImageGenScenario = { kind: 'success' };
  private gate: Promise<void> | null = null;
  private seed = 0;
  /** 받은 요청(순서대로) */
  readonly calls: ImageGenRequest[] = [];

  identify(provider: ImageGenProviderCode): ImageGenIdentity {
    return { provider, model: FAKE_IMAGE_GEN_MODEL, providerVersion: FAKE_IMAGE_GEN_VERSION };
  }

  /** 다음 호출들의 대본(차례로 쓴다) */
  enqueue(...scenarios: FakeImageGenScenario[]): this {
    this.queue.push(...scenarios);
    return this;
  }

  /** 대본이 비었을 때 쓸 기본 대본 */
  setDefault(scenario: FakeImageGenScenario): this {
    this.fallback = scenario;
    return this;
  }

  /** 다음 호출부터 결과를 붙잡는다. 돌려준 함수로 푼다 */
  hold(): () => void {
    let release: () => void = () => undefined;
    this.gate = new Promise<void>((resolve) => {
      release = () => {
        this.gate = null;
        resolve();
      };
    });
    return release;
  }

  reset(): void {
    this.queue.length = 0;
    this.calls.length = 0;
    this.fallback = { kind: 'success' };
    this.gate = null;
  }

  async generate(request: ImageGenRequest): Promise<ImageGenResult> {
    this.calls.push(request);
    const scenario = this.queue.shift() ?? this.fallback;
    // 붙잡힌 동안 끊기면(하드 타임아웃) 실제 어댑터처럼 바로 끝낸다
    if (this.gate) await Promise.race([this.gate, abortedOf(request.signal)]);
    switch (scenario.kind) {
      case 'success': {
        this.seed += 1;
        const bytes = scenario.bytes ?? (await solidPng(request.sizePx, this.seed));
        return { kind: 'IMAGE', bytes, fileName: scenario.fileName ?? `fake-${this.seed}.png` };
      }
      case 'refused':
        return { kind: 'REFUSED', reason: scenario.reason ?? FAKE_REFUSAL_REASON };
      case 'failed':
        throw new ImageGenError(scenario.message ?? FAKE_FAILURE_MESSAGE, 'FAKE_FAILED');
      case 'timeout':
        return abortedOf(request.signal);
    }
  }

  /** 앱 기본 공급자로 쓸 때 한 번 알린다(테스트 환경) */
  announceDefault(): void {
    this.logger.warn(
      '테스트 환경(NODE_ENV=test)이라 가짜 이미지 생성 공급자를 씁니다. 만든 썸네일은 단색 시험 이미지입니다.',
    );
  }
}

/** `signal`이 끊기면 그 이유로 거절하는 약속(끊기지 않으면 끝나지 않는다) */
function abortedOf(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const abort = () => {
      const reason: unknown = signal.reason;
      reject(reason instanceof Error ? reason : new Error('aborted'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}
