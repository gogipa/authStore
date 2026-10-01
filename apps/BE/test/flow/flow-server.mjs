// 흐름 테스트(P5-01) 가짜 연동 BE 감독 프로세스. Playwright webServer가 띄운다(apps/FE/e2e/playwright.config.ts).
//   node test/flow/flow-server.mjs   (cwd = apps/BE)
// - 자식 = flow-app.ts(가짜를 끼운 AppModule, 127.0.0.1:3100). DB는 autostore_test(TEST_DATABASE_URL)만 쓴다
// - 제어 API(127.0.0.1:3101, 테스트 전용 — 앱 API가 아니다)
//   GET  /__flow/health            자식이 떠 있으면 200
//   POST /__flow/reset   {fakes?}  자식을 끄고 DB를 비운 뒤 시작점 시드로 다시 켠다(테스트마다)
//   POST /__flow/restart {fakes?}  자식을 끄고(SIGTERM) DB는 그대로 다시 켠다(앱 재시작 시험)
//   POST /__flow/fakes   {...}     가짜 동작 바꾸기(등록 응답 HOLD·5xx 등)
//   GET  /__flow/state             가짜 쪽 호출 수·위반(허용 밖 호스트) — 감독이 자식을 넘어 모은 위반도 함께
// 끝날 때(SIGTERM·SIGINT) 자식을 끄고 임시 데이터 폴더를 지운다.
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, Socket } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const BE_ROOT = join(HERE, '..', '..');
const { applyTestDbEnv } = require('../../scripts/test-db-env.cjs');

const BE_PORT = 3100;
const CONTROL_PORT = Number(process.env.FLOW_CONTROL_PORT ?? 3101);
const FE_ORIGIN = 'http://127.0.0.1:5173';
const READY_TIMEOUT_MS = 120_000;
const STOP_GRACE_MS = 8_000;

const testDbUrl = applyTestDbEnv(); // 이름에 test가 없으면 여기서 멈춘다
const dataDir = mkdtempSync(join(tmpdir(), 'autostore-flow-'));
/** 자식을 넘어 모은 위반(허용 밖 호스트 호출) */
const violations = [];

let child = null;
let ready = false;
let seq = 0;
const pending = new Map();

function log(message) {
  process.stdout.write(`[flow-server] ${message}\n`);
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.connect(port, '127.0.0.1');
  });
}

function startChild({ truncate, fakes }) {
  return new Promise((resolve, reject) => {
    ready = false;
    const env = {
      ...process.env,
      DATABASE_URL: testDbUrl,
      // 개발 모드여야 FE 개발 서버(5173) Origin을 받는다(DEV_FE_ORIGINS). DB는 위에서 테스트 DB로 고정
      NODE_ENV: 'development',
      DEV_FE_ORIGINS: FE_ORIGIN,
      PORT: String(BE_PORT),
      APP_DATA_DIR: dataDir,
      LOG_LEVEL: process.env.FLOW_LOG_LEVEL ?? 'warn',
      COMMERCE_META_AUTO_SYNC: 'off',
      AI_ENGINE_STARTUP_CHECK: 'off',
      FX_AUTO_COLLECT: 'off',
      FLOW_TRUNCATE: truncate ? '1' : '0',
      FLOW_FAKES: JSON.stringify(fakes ?? {}),
    };
    const proc = fork(join(HERE, 'flow-app.ts'), [], {
      cwd: BE_ROOT,
      env,
      execArgv: ['--import', join(HERE, 'register-ts.mjs')],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    child = proc;
    const timer = setTimeout(() => {
      reject(new Error('가짜 연동 BE가 제때 뜨지 않았습니다'));
      proc.kill('SIGKILL');
    }, READY_TIMEOUT_MS);
    proc.on('message', (msg) => {
      if (msg?.type === 'ready') {
        clearTimeout(timer);
        ready = true;
        resolve();
      } else if (msg?.type === 'violation') {
        violations.push(msg.violation);
      } else if (msg?.type === 'reply') {
        pending.get(msg.id)?.(msg.body);
        pending.delete(msg.id);
      }
    });
    proc.once('exit', (code, signal) => {
      clearTimeout(timer);
      if (child === proc) {
        child = null;
        ready = false;
      }
      for (const [id, done] of pending) {
        done({ error: `자식이 끝났습니다(${code ?? signal})` });
        pending.delete(id);
      }
      if (!ready) reject(new Error(`가짜 연동 BE가 끝났습니다(code ${code}, signal ${signal})`));
    });
  });
}

function stopChild(signal = 'SIGTERM') {
  const proc = child;
  if (!proc) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => proc.kill('SIGKILL'), STOP_GRACE_MS);
    proc.once('exit', () => {
      clearTimeout(force);
      resolve();
    });
    proc.kill(signal);
  });
}

async function waitPortFree() {
  for (let i = 0; i < 100; i += 1) {
    if (!(await portInUse(BE_PORT))) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`포트 ${BE_PORT}가 비지 않습니다`);
}

function ask(type, extra = {}) {
  if (!child || !ready) return Promise.resolve({ error: '가짜 연동 BE가 떠 있지 않습니다' });
  seq += 1;
  const id = seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    child.send({ id, type, ...extra });
  });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

let queue = Promise.resolve();
/** 다시 켜기는 한 번에 하나씩 */
function serial(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

const control = createHttpServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${CONTROL_PORT}`);
  const route = `${req.method} ${url.pathname}`;
  const handle = async () => {
    if (route === 'GET /__flow/health') return send(res, ready ? 200 : 503, { ready });
    if (route === 'GET /__flow/state') {
      const state = await ask('state');
      return send(res, 200, { ...state, supervisorViolations: [...violations] });
    }
    if (route === 'POST /__flow/fakes')
      return send(res, 200, await ask('fakes', { modes: await readBody(req) }));
    if (route === 'POST /__flow/reset' || route === 'POST /__flow/restart') {
      const body = await readBody(req);
      const truncate = route.endsWith('/reset');
      await serial(async () => {
        await stopChild('SIGTERM');
        await waitPortFree();
        if (truncate) violations.length = 0;
        await startChild({ truncate, fakes: body.fakes });
      });
      return send(res, 200, { ok: true, truncated: truncate });
    }
    return send(res, 404, { error: 'not found' });
  };
  handle().catch((error) => send(res, 500, { error: String(error?.message ?? error) }));
});

async function shutdown() {
  control.close();
  await stopChild('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

async function main() {
  if (await portInUse(BE_PORT)) {
    throw new Error(
      `포트 ${BE_PORT}를 다른 프로세스가 쓰고 있습니다(개발 BE를 끄고 다시 해 주세요)`,
    );
  }
  await startChild({ truncate: true, fakes: {} });
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(CONTROL_PORT, '127.0.0.1', () => probe.close(resolve));
  });
  control.listen(CONTROL_PORT, '127.0.0.1', () =>
    log(`ready — BE 127.0.0.1:${BE_PORT}, 제어 127.0.0.1:${CONTROL_PORT}`),
  );
}

main().catch(async (error) => {
  log(`시작 실패: ${error?.stack ?? error}`);
  await stopChild('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(1);
});
