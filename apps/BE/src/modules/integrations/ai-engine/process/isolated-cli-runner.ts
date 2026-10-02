import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { AI_OUTPUT_MAX_BYTES, AI_PROCESS_KILL_GRACE_MS } from '../ai-engine.constants.js';
import {
  AI_CLI_BINARIES,
  assertIsolatedCliInvocation,
  type AiCliBinary,
  type CliInvocationMode,
} from '../cli-isolation.js';
import { locateCliBinary } from './cli-locator.js';
import { buildAiCliEnv } from './env-allowlist.js';

/**
 * AI CLI spawn 래퍼 하나(P1-10 규칙 1·2·3, F-BS-27). **`node:child_process`는 앱 모듈 안에서 이 파일만 import한다**
 * (`child-process-boundary.spec.ts`가 글자로 본다). 텍스트·비전 어댑터 3개와 P3-02 이미지 생성 공급자가 같이 쓴다.
 *
 * 한 번 실행:
 * 1. 실행 파일 이름 검사 — `claude`·`agy`·`codex`만(경로·다른 이름·래퍼는 spawn 전에 거부, 규칙 1)
 * 2. 셸 없이 `PATH`에서 경로를 찾는다(`cli-locator`). 없으면 `CliSpawnError('NOT_FOUND')`
 * 3. 자식 환경변수 = 허용 목록(규칙 3). 격리 검사기(`assertIsolatedCliInvocation`)를 통과해야 spawn한다
 * 4. `spawn(경로, 인자 배열, { shell: false, stdio: ['ignore','pipe','pipe'] })` — stdin은 닫는다(규칙 2)
 * 5. 시간 제한 + 여유(`AI_PROCESS_KILL_GRACE_MS`)가 지나면 SIGTERM, 그래도 살아 있으면 SIGKILL(Proposed, M1)
 * 6. `signal`이 끊기면(이미지 생성 하드 타임아웃 — M0 S1) 같은 방법으로 자식을 끝내고 `signal.reason`으로 거절한다
 * CLI 설치·업데이트·전역 설정 쓰기는 하지 않는다(규칙 5).
 */

export interface CliRunRequest {
  /** 실행 파일 이름(`claude`·`agy`·`codex`). 경로는 받지 않는다 */
  bin: string;
  args: readonly string[];
  /** 빈 작업 폴더(절대 경로, 저장소 밖) */
  cwd: string;
  /** CLI에 준 시간 제한(ms). 이 값 + 여유가 지나면 자식을 끝낸다 */
  timeoutMs: number;
  /** `invoke`(구조화 호출, 기본) · `probe`(`--version`·로그인 확인) */
  mode?: CliInvocationMode;
  /**
   * 부르는 쪽의 중단 신호(선택). 끊기면 SIGTERM → 여유 뒤 SIGKILL로 자식을 끝내고 `signal.reason`으로 거절한다.
   * spawn 전에 이미 끊겼으면 spawn하지 않는다(M0 S1 — 이미지 생성 하드 타임아웃, `ImageGenRequest.signal`)
   */
  signal?: AbortSignal;
}

export interface CliRunResult {
  binPath: string;
  /** 종료 코드(신호로 끝나면 null) */
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  /** 시간 제한을 넘겨 앱이 끝냈다 */
  timedOut: boolean;
  /** 출력 상한을 넘겨 일부를 버렸다 */
  outputTruncated: boolean;
  durationMs: number;
}

/** spawn 전·중 실패. NOT_FOUND는 어댑터가 NOT_INSTALLED로 바꾼다 */
export class CliSpawnError extends Error {
  constructor(
    readonly reason: 'NOT_ALLOWED' | 'NOT_FOUND' | 'SPAWN_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'CliSpawnError';
  }
}

export type SpawnFunction = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess;

export interface IsolatedCliRunnerOptions {
  /** 부모 환경변수(허용 목록으로 거른다). 기본 process.env */
  env?: Readonly<Record<string, string | undefined>>;
  /** 테스트: spawn 바꿔 끼우기(프로세스 수 세기) */
  spawn?: SpawnFunction;
  /** 출력 상한(바이트) */
  maxOutputBytes?: number;
  /** 시간 제한 뒤 여유(ms) */
  killGraceMs?: number;
}

export function isAllowedCliBinary(bin: string): bin is AiCliBinary {
  return (AI_CLI_BINARIES as readonly string[]).includes(bin);
}

/** Nest에는 `{ provide: IsolatedCliRunner, useFactory: () => new IsolatedCliRunner() }`로 등록한다(생성자가 옵션 객체) */
export class IsolatedCliRunner {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly spawnFn: SpawnFunction;
  private readonly maxOutputBytes: number;
  private readonly killGraceMs: number;

  constructor(options: IsolatedCliRunnerOptions = {}) {
    this.env = options.env ?? process.env;
    this.spawnFn = options.spawn ?? nodeSpawn;
    this.maxOutputBytes = options.maxOutputBytes ?? AI_OUTPUT_MAX_BYTES;
    this.killGraceMs = options.killGraceMs ?? AI_PROCESS_KILL_GRACE_MS;
  }

  /** 실행 파일 경로(셸 없이 PATH 훑기). 허용 이름이 아니거나 없으면 null */
  locate(bin: string): string | null {
    if (!isAllowedCliBinary(bin)) return null;
    return locateCliBinary(bin, this.env);
  }

  async run(req: CliRunRequest): Promise<CliRunResult> {
    if (!isAllowedCliBinary(req.bin)) {
      throw new CliSpawnError(
        'NOT_ALLOWED',
        `실행 파일은 ${AI_CLI_BINARIES.join('·')}만 부른다(요청: ${req.bin.slice(0, 40)})`,
      );
    }
    if (!Number.isFinite(req.timeoutMs) || req.timeoutMs <= 0) {
      throw new Error('AI CLI 시간 제한은 0보다 커야 한다(무제한 금지)');
    }
    if (req.signal?.aborted) throw abortReason(req.signal);
    const binPath = locateCliBinary(req.bin, this.env);
    if (!binPath)
      throw new CliSpawnError('NOT_FOUND', `${req.bin} 실행 파일을 PATH에서 찾지 못했다`);
    const env = buildAiCliEnv(req.bin, this.env);
    const args = [...req.args];
    assertIsolatedCliInvocation(
      { bin: binPath, args, cwd: req.cwd, env, shell: false },
      req.mode ?? 'invoke',
    );
    return this.spawnAndCollect(binPath, args, req.cwd, env, req.timeoutMs, req.signal);
  }

  private spawnAndCollect(
    binPath: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): Promise<CliRunResult> {
    const started = performance.now();
    return new Promise<CliRunResult>((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = this.spawnFn(binPath, args, {
          cwd,
          env,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
      } catch (error) {
        reject(spawnFailure(binPath, error));
        return;
      }
      const out = new OutputBuffer(this.maxOutputBytes);
      const err = new OutputBuffer(this.maxOutputBytes);
      child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr?.on('data', (chunk: Buffer) => err.push(chunk));
      let timedOut = false;
      let aborted = false;
      let killTimer: NodeJS.Timeout | null = null;
      const terminate = () => {
        if (killTimer) return;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.killGraceMs);
        killTimer.unref();
      };
      const timer = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs + this.killGraceMs);
      timer.unref();
      const onAbort = () => {
        aborted = true;
        terminate();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
      let settled = false;
      const cleanup = () => {
        settled = true;
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        signal?.removeEventListener('abort', onAbort);
      };
      child.once('error', (error) => {
        if (settled) return;
        cleanup();
        reject(spawnFailure(binPath, error));
      });
      child.once('close', (code, exitSignal) => {
        if (settled) return;
        cleanup();
        if (aborted && signal) {
          reject(abortReason(signal));
          return;
        }
        resolve({
          binPath,
          exitCode: code,
          signal: exitSignal,
          stdout: out.text(),
          stderr: err.text(),
          timedOut,
          outputTruncated: out.truncated || err.truncated,
          durationMs: Math.max(0, Math.round(performance.now() - started)),
        });
      });
    });
  }
}

/** 중단 신호의 이유(Error가 아니면 감싼다) */
function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error('AI CLI 호출을 중단했다');
}

function spawnFailure(binPath: string, error: unknown): CliSpawnError {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') {
    return new CliSpawnError('NOT_FOUND', `실행 파일이 사라졌다(ENOENT): ${binPath}`);
  }
  return new CliSpawnError('SPAWN_FAILED', `실행하지 못했다(${code ?? 'unknown'})`);
}

/** 상한까지만 모으는 출력 버퍼 */
class OutputBuffer {
  private readonly chunks: Buffer[] = [];
  private size = 0;
  truncated = false;

  constructor(private readonly max: number) {}

  push(chunk: Buffer): void {
    if (this.size >= this.max) {
      this.truncated = true;
      return;
    }
    const room = this.max - this.size;
    const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
    if (part.length < chunk.length) this.truncated = true;
    this.chunks.push(part);
    this.size += part.length;
  }

  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}
