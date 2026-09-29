import { type ClientRequest, get, type IncomingMessage } from 'node:http';
import request from 'supertest';
import { ProgressEventsService } from '../src/common/events/progress-events.service.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

interface Frame {
  id?: string;
  event?: string;
  data?: string;
}

/** SSE 연결 하나. supertest는 스트림이 끝나지 않아 node:http로 붙고 읽은 뒤 끊는다 */
class SseClient {
  private buffer = '';
  private frames: Frame[] = [];
  private waiters: (() => void)[] = [];
  req!: ClientRequest;
  res!: IncomingMessage;

  static connect(
    port: number,
    path: string,
    headers: Record<string, string> = {},
  ): Promise<SseClient> {
    const client = new SseClient();
    return new Promise((resolve, reject) => {
      client.req = get(
        { host: '127.0.0.1', port, path, headers: { Accept: 'text/event-stream', ...headers } },
        (res) => {
          client.res = res;
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => client.onData(chunk));
          resolve(client);
        },
      );
      client.req.on('error', reject);
    });
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n\n')) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      const frame: Frame = {};
      for (const line of raw.split('\n')) {
        const m = /^(id|event|data): ?(.*)$/.exec(line);
        if (m) frame[m[1] as keyof Frame] = m[2];
      }
      if (frame.event) this.frames.push(frame);
    }
    this.waiters.splice(0).forEach((w) => w());
  }

  /** 프레임 n개가 올 때까지 기다린다 */
  async waitFrames(n: number, timeoutMs = 3000): Promise<Frame[]> {
    const deadline = Date.now() + timeoutMs;
    while (this.frames.length < n) {
      if (Date.now() > deadline) throw new Error(`SSE 프레임 ${n}개를 받지 못했습니다`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    return this.frames.slice(0, n);
  }

  close(): void {
    this.req.destroy();
  }
}

const statusChanged = (candidateId: number) => ({
  candidateId,
  fromStatus: null,
  toStatus: 'WORKING' as const,
  reason: 'CREATED' as const,
  excludedReason: null,
  changedAt: '2026-09-28T12:00:00+09:00',
});

describe('GET /api/v1/events (e2e, SSE)', () => {
  let t: TestApp;
  let events: ProgressEventsService;
  const clients: SseClient[] = [];

  const open = async (path = '/api/v1/events', headers: Record<string, string> = {}) => {
    const c = await SseClient.connect(t.port, path, headers);
    clients.push(c);
    return c;
  };

  /** 구독 수가 n이 될 때까지 기다린다(연결·끊김 처리는 비동기다) */
  const waitSubscribers = async (n: number) => {
    const deadline = Date.now() + 3000;
    while (events.subscriberCount !== n) {
      if (Date.now() > deadline) {
        throw new Error(`구독 수가 ${n}이 되지 않았습니다(${events.subscriberCount})`);
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  };

  beforeAll(async () => {
    t = await createTestApp();
    events = t.app.get(ProgressEventsService);
  });

  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    await waitSubscribers(0);
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('헤더: text/event-stream, Cache-Control에 no-cache', async () => {
    const c = await open();
    expect(c.res.statusCode).toBe(200);
    expect(c.res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(c.res.headers['cache-control']).toMatch(/(^|[ ,])no-cache([ ,]|$)/);
  });

  it('publish 뒤 id:·event:·data:(한 줄 JSON) 프레임이 온다. id는 단조 증가', async () => {
    const c = await open('/api/v1/events', { 'Last-Event-ID': '999' });
    await waitSubscribers(1);
    events.publish('candidate.status-changed', statusChanged(1));
    events.publish('call-usage.changed', {
      target: 'RAKUTEN_PAGE',
      kstDate: '2026-09-28',
      count: 38,
      dailyLimit: 110,
      remaining: 72,
      limitReached: false,
      blockedUntil: null,
      httpStatus: null,
    });
    const [a, b] = await c.waitFrames(2);
    expect(a!.event).toBe('candidate.status-changed');
    expect(a!.id).toMatch(/^\d+$/);
    expect(JSON.parse(a!.data!)).toEqual(statusChanged(1));
    expect(b!.event).toBe('call-usage.changed');
    expect(Number(b!.id)).toBeGreaterThan(Number(a!.id));
    expect(JSON.parse(b!.data!)).toMatchObject({ count: 38, remaining: 72 });
  });

  it('?candidateId=12 구독자는 후보 13 이벤트를 받지 않고 전역 이벤트는 받는다', async () => {
    const c = await open('/api/v1/events?candidateId=12');
    await waitSubscribers(1);
    events.publish('candidate.status-changed', statusChanged(13));
    events.publish(
      'sourcing.row-updated',
      {
        sourcingComparisonId: 5,
        rowId: 9,
        isVerified: true,
        stockPass: true,
        inStockSizeCount: 4,
        effectivePriceYen: 12000,
        manualCheckRequired: false,
      },
      { candidateId: 13 },
    );
    events.publish('registration-switch.changed', {
      apiBlocked: true,
      changedAt: '2026-09-28T12:00:00+09:00',
      revertedCandidateIds: [],
    });
    events.publish('candidate.status-changed', statusChanged(12));
    const frames = await c.waitFrames(2);
    expect(frames.map((f) => f.event)).toEqual([
      'registration-switch.changed',
      'candidate.status-changed',
    ]);
    expect(JSON.parse(frames[1]!.data!)).toMatchObject({ candidateId: 12 });
  });

  it('연결이 끊기면 구독을 푼다', async () => {
    expect(events.subscriberCount).toBe(0);
    const c = await open();
    await waitSubscribers(1);
    c.close();
    await waitSubscribers(0);
    expect(events.subscriberCount).toBe(0);
  });

  it.each(['abc', '0', '-3', '1.5', '1e3', ''])(
    '?candidateId=%s → 422 INVALID_QUERY_PARAMETER',
    async (value) => {
      const res = await request(t.app.getHttpServer())
        .get(`/api/v1/events?candidateId=${value}`)
        .expect(422);
      expect(res.body).toMatchObject({ code: 'INVALID_QUERY_PARAMETER', status: 422 });
    },
  );

  it('Host가 틀리면 403 HOST_NOT_ALLOWED', async () => {
    const res = await request(t.app.getHttpServer())
      .get('/api/v1/events')
      .set('Host', 'evil.example:3100')
      .expect(403);
    expect((res.body as { code: string }).code).toBe('HOST_NOT_ALLOWED');
  });
});
