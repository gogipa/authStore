import { Agent, get, type ClientRequest, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DEFAULT_SSE_HEARTBEAT_INTERVAL_MS,
  SSE_HEARTBEAT_INTERVAL_MS,
} from '../src/common/events/events.controller.js';
import { ProgressEventsService } from '../src/common/events/progress-events.service.js';
import { createTestApp, type TestApp } from './helpers/test-app.js';

/** 종료가 이 안에 끝나야 한다. `nest start --watch`는 앞 프로세스가 끝나야 새 프로세스를 띄운다 */
const CLOSE_BUDGET_MS = 3000;

/** 열어 둔 SSE 연결 하나(브라우저 EventSource·Vite 프록시처럼 끊지 않는다) */
interface OpenSse {
  req: ClientRequest;
  res: IncomingMessage;
  /** 서버가 연결을 닫으면 풀린다 */
  closed: Promise<void>;
}

function openSse(port: number): Promise<OpenSse> {
  return new Promise((resolve, reject) => {
    const req = get(
      { host: '127.0.0.1', port, path: '/api/v1/events', headers: { Accept: 'text/event-stream' } },
      (res) => {
        res.resume();
        const closed = new Promise<void>((done) => res.once('close', () => done()));
        resolve({ req, res, closed });
      },
    );
    req.on('error', reject);
  });
}

/** 포트에 아직 누가 듣고 있는지(연결이 되면 true) */
function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

async function waitFor(check: () => boolean, label: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${label}이(가) 되지 않았습니다`);
    await delay(10);
  }
}

describe('앱 종료(e2e) — SSE 연결이 열려 있어도 곧바로 닫힌다(개발 서버 watch 재시작)', () => {
  let t: TestApp | undefined;
  let closing: Promise<unknown> | undefined;
  let agent: Agent | undefined;
  const sseClients: OpenSse[] = [];

  afterEach(async () => {
    // 고치기 전처럼 종료가 걸려도 테스트가 멈추지 않게 클라이언트 쪽에서 끊고 마저 닫는다
    sseClients.splice(0).forEach((c) => c.req.destroy());
    agent?.destroy();
    await (closing ?? t?.app.close());
    t = undefined;
    closing = undefined;
    agent = undefined;
  });

  it('운영과 같은 25초 연결 유지 주석을 쓰는 SSE 연결과 쉬는 keep-alive 연결이 있어도 app.close()가 3초 안에 끝나고 포트를 놓는다', async () => {
    t = await createTestApp({
      overrides: [
        { provide: SSE_HEARTBEAT_INTERVAL_MS, useValue: DEFAULT_SSE_HEARTBEAT_INTERVAL_MS },
      ],
    });
    const { app, port } = t;
    const events = app.get(ProgressEventsService);
    agent = new Agent({ keepAlive: true });

    // 화면(EventSource)이 붙어 있는 상태: SSE 연결 2개
    sseClients.push(await openSse(port), await openSse(port));
    await waitFor(() => events.subscriberCount === 2, 'SSE 구독 2개');
    // Vite 프록시처럼 요청을 마친 뒤 쉬고 있는 keep-alive 연결 1개(없는 경로 404여도 응답은 끝난다)
    await new Promise<void>((resolve, reject) => {
      get({ host: '127.0.0.1', port, path: '/api/v1/no-such-route', agent }, (res) => {
        res.resume();
        res.once('end', () => resolve());
      }).on('error', reject);
    });

    const startedAt = Date.now();
    closing = app.close();
    // 진 쪽 타이머가 Jest를 붙잡지 않게 ref: false
    const outcome = await Promise.race([
      closing.then(() => 'closed' as const),
      delay(CLOSE_BUDGET_MS, 'timeout' as const, { ref: false }),
    ]);
    const elapsedMs = Date.now() - startedAt;

    expect(outcome).toBe('closed');
    expect(elapsedMs).toBeLessThan(CLOSE_BUDGET_MS);
    await Promise.all(sseClients.map((c) => c.closed));
    expect(events.subscriberCount).toBe(0);
    await expect(isListening(port)).resolves.toBe(false);
  });
});
