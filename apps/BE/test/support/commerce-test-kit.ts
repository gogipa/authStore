/**
 * 커머스API 인증 단위 테스트 묶음: 가짜 시계·메모리 비밀 저장소·가짜 커머스 서버·SSE 기록기 위에
 * 실제 CommerceTokenService·CommerceApiClient를 만든다(Nest 없이 생성자로, jest.mock 없음).
 */
import type {
  ProgressEventDataMap,
  ProgressEventName,
} from '../../src/common/events/progress-event.types.js';
import type { ProgressEventsService } from '../../src/common/events/progress-events.service.js';
import type { SecretKey } from '../../src/common/secrets/secret-keys.js';
import { CommerceApiClient } from '../../src/modules/integrations/naver-commerce/commerce-api.client.js';
import { CommerceTokenService } from '../../src/modules/integrations/naver-commerce/commerce-token.service.js';
import { FakeClock } from '../helpers/fakes.js';
import { FakeCommerceTransport, signatureVector } from './fake-commerce-transport.js';
import { InMemorySecretStore } from './in-memory-secret-store.js';

/** 2026-09-28 14:00 KST */
export const KIT_START_MS = Date.parse('2026-09-28T05:00:00Z');

export interface RecordedEvent {
  name: ProgressEventName;
  data: unknown;
}

/** ProgressEventsService 대신 발행만 기록한다 */
export class RecordingProgressEvents {
  readonly published: RecordedEvent[] = [];

  publish<N extends ProgressEventName>(name: N, data: ProgressEventDataMap[N]) {
    this.published.push({ name, data });
    return { id: this.published.length, name, data, candidateId: null };
  }

  of<N extends ProgressEventName>(name: N): ProgressEventDataMap[N][] {
    return this.published
      .filter((e) => e.name === name)
      .map((e) => e.data as ProgressEventDataMap[N]);
  }
}

export function commerceSecretsFromVector(): Partial<Record<SecretKey, string>> {
  const v = signatureVector();
  return { COMMERCE_CLIENT_ID: v.clientId, COMMERCE_CLIENT_SECRET: v.clientSecret };
}

export function createCommerceKit(
  options: { secrets?: Partial<Record<SecretKey, string>>; startMs?: number } = {},
) {
  const clock = new FakeClock(options.startMs ?? KIT_START_MS);
  const store = new InMemorySecretStore({
    now: () => clock.now(),
    initial: options.secrets ?? commerceSecretsFromVector(),
  });
  const transport = new FakeCommerceTransport();
  const events = new RecordingProgressEvents();
  const tokens = new CommerceTokenService(
    store,
    transport,
    clock,
    events as unknown as ProgressEventsService,
  );
  const client = new CommerceApiClient(tokens, transport);
  return { clock, store, transport, events, tokens, client };
}
