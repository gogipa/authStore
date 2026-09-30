import { spawn as nodeSpawn, type SpawnOptions } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { createFakeCliWorld, type FakeCliWorld } from '../../../../../test/support/fake-ai-cli.js';
import { REPO_ROOT } from '../../../../common/config/paths.js';
import { AgyAdapter } from '../adapters/agy.adapter.js';
import { ClaudeCodeAdapter } from '../adapters/claude-code.adapter.js';
import { CodexAdapter } from '../adapters/codex.adapter.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
  AiEngineUnavailableError,
} from '../ai-engine.errors.js';
import { CliIsolationError } from '../cli-isolation.js';
import { CliSpawnError, IsolatedCliRunner, type SpawnFunction } from './isolated-cli-runner.js';

const VALID_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    note: { type: ['string', 'null'] },
  },
  required: ['title', 'bullets', 'note'],
  additionalProperties: false,
};

/** spawn 스파이: 부른 횟수·옵션을 남기고 진짜 spawn을 부른다 */
function spawnSpy() {
  const calls: { command: string; args: readonly string[]; options: SpawnOptions }[] = [];
  const fn: SpawnFunction = (command, args, options) => {
    calls.push({ command, args, options });
    return nodeSpawn(command, [...args], options);
  };
  return { fn, calls };
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

describe('IsolatedCliRunner(P1-10 규칙 1·2·3) — 가짜 CLI', () => {
  let world: FakeCliWorld;

  beforeEach(() => {
    world = createFakeCliWorld();
  });

  afterEach(() => {
    world.cleanup();
  });

  it.each(['gemini', 'agy-image', '/bin/sh', '/usr/local/bin/claude', 'claude-code'])(
    '규칙 1: %s 실행 요청은 spawn 전에 거부한다(프로세스 0개)',
    async (bin) => {
      const spy = spawnSpy();
      const runner = new IsolatedCliRunner({ env: world.env, spawn: spy.fn });
      const cwd = mkdtempSync(join(tmpdir(), 'autostore-ai-test-'));
      try {
        await expect(
          runner.run({ bin, args: ['--model', 'x'], cwd, timeoutMs: 1000 }),
        ).rejects.toMatchObject({ name: 'CliSpawnError', reason: 'NOT_ALLOWED' });
        expect(spy.calls).toHaveLength(0);
        expect(world.records()).toHaveLength(0);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
    },
  );

  it('규칙 2: 텍스트 호출 1회 — cwd는 os.tmpdir() 아래·저장소 밖·시작 때 빈 폴더, 호출 뒤 삭제, stdin 닫힘, shell 없음', async () => {
    const spy = spawnSpy();
    const runner = new IsolatedCliRunner({ env: world.env, spawn: spy.fn });
    const adapter = new ClaudeCodeAdapter(runner);
    const result = await adapter.runStructured(
      'CT-01',
      VALID_SCHEMA,
      { prompt: '[지시] 카피를 써라' },
      { model: 'sonnet', timeoutMs: 120_000 },
    );
    expect(typeof (result.output as { title?: unknown }).title).toBe('string');

    const [rec] = world.records();
    expect(rec).toBeDefined();
    // 자식의 process.cwd()는 실제 경로(/private/var/…)다. 폴더는 이미 지워져 있다
    const cwd = rec!.cwd;
    expect(isInside(realpathSync.native(tmpdir()), cwd)).toBe(true);
    expect(isInside(REPO_ROOT, cwd)).toBe(false);
    expect(rec!.cwdEntries).toEqual([]);
    expect(rec!.cwdEntries).not.toContain('.claude');
    expect(rec!.cwdEntries).not.toContain('.mcp.json');
    expect(existsSync(rec!.cwd)).toBe(false);
    expect(rec!.stdin).toBe('null-device');

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]!.options.shell).toBe(false);
    expect((spy.calls[0]!.options.stdio as unknown[])[0]).toBe('ignore');
    expect(Array.isArray(spy.calls[0]!.args)).toBe(true);
    expect(spy.calls[0]!.command).toBe(join(world.dir, 'claude'));
  });

  it("규칙 2: model ''이면 spawn 없이 AI_ENGINE_UNAVAILABLE(MODEL_NOT_SET)", async () => {
    const spy = spawnSpy();
    const runner = new IsolatedCliRunner({ env: world.env, spawn: spy.fn });
    for (const adapter of [
      new ClaudeCodeAdapter(runner),
      new AgyAdapter(runner),
      new CodexAdapter(runner),
    ]) {
      const err: unknown = await adapter
        .runStructured(
          'CT-01',
          VALID_SCHEMA,
          { prompt: '[지시] x' },
          { model: '', timeoutMs: 1000 },
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiEngineUnavailableError);
      expect((err as AiEngineUnavailableError).reason).toBe('MODEL_NOT_SET');
    }
    expect(spy.calls).toHaveLength(0);
  });

  it('규칙 3: 부모의 ANTHROPIC_API_KEY·OPENAI_API_KEY·허용 밖 변수는 넘기지 않고, claude만 DISABLE_AUTOUPDATER=1', async () => {
    const runner = new IsolatedCliRunner({ env: world.env });
    world.setScenario({
      claude: { run: { stdout: 'claude/text-success.json' } },
      agy: { run: { stdout: 'agy/success.json' } },
    });
    await new ClaudeCodeAdapter(runner).runStructured(
      'CT-01',
      VALID_SCHEMA,
      { prompt: '[지시] x' },
      { model: 'sonnet', timeoutMs: 120_000 },
    );
    await new AgyAdapter(runner).runStructured(
      'CT-01',
      VALID_SCHEMA,
      { prompt: '[지시] x' },
      { model: 'gemini-3.8-flash-medium', timeoutMs: 120_000 },
    );
    await new CodexAdapter(runner).runStructured(
      'CT-01',
      VALID_SCHEMA,
      { prompt: '[지시] x' },
      { model: 'gpt-5', timeoutMs: 120_000 },
    );
    const byEngine = Object.fromEntries(world.records().map((r) => [r.engine, r]));
    for (const engine of ['claude', 'agy', 'codex'] as const) {
      const names = byEngine[engine]!.envNames;
      expect(names).not.toContain('ANTHROPIC_API_KEY');
      expect(names).not.toContain('OPENAI_API_KEY');
      expect(names).not.toContain('NODE_OPTIONS');
      expect(names).toEqual(expect.arrayContaining(['PATH', 'HOME']));
    }
    expect(byEngine.claude!.disableAutoupdater).toBe('1');
    expect(byEngine.agy!.disableAutoupdater).toBeNull();
    expect(byEngine.codex!.disableAutoupdater).toBeNull();
  });

  it('작업 폴더가 비어 있지 않으면 격리 검사기가 spawn 전에 막는다', async () => {
    const spy = spawnSpy();
    const runner = new IsolatedCliRunner({ env: world.env, spawn: spy.fn });
    const cwd = mkdtempSync(join(tmpdir(), 'autostore-ai-test-'));
    writeFileSync(join(cwd, '.mcp.json'), '{}');
    try {
      await expect(
        runner.run({ bin: 'agy', args: ['-p', 'x', '--model', 'm'], cwd, timeoutMs: 1000 }),
      ).rejects.toBeInstanceOf(CliIsolationError);
      expect(spy.calls).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('PATH에 없으면 CliSpawnError(NOT_FOUND) — 어댑터는 규칙 12 NOT_INSTALLED로 바꾼다', async () => {
    const onlyClaude = createFakeCliWorld(['claude']);
    try {
      const runner = new IsolatedCliRunner({ env: onlyClaude.env });
      const cwd = mkdtempSync(join(tmpdir(), 'autostore-ai-test-'));
      try {
        await expect(
          runner.run({ bin: 'codex', args: ['exec', 'x', '--model', 'm'], cwd, timeoutMs: 1000 }),
        ).rejects.toEqual(expect.objectContaining({ reason: 'NOT_FOUND' }));
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
      const err: unknown = await new CodexAdapter(runner)
        .runStructured(
          'CT-01',
          VALID_SCHEMA,
          { prompt: '[지시] x' },
          { model: 'gpt-5', timeoutMs: 1000 },
        )
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiEngineUnavailableError);
      expect((err as AiEngineUnavailableError).reason).toBe('NOT_INSTALLED');
      expect(err).not.toBeInstanceOf(CliSpawnError);
    } finally {
      onlyClaude.cleanup();
    }
  });

  it('시간 제한(+여유)을 넘기면 자식을 끝내고 AI_TIMEOUT으로 실패한다(Proposed, M1)', async () => {
    world.setScenario({ claude: { run: { stdout: 'claude/text-success.json', sleepMs: 5000 } } });
    const runner = new IsolatedCliRunner({ env: world.env, killGraceMs: 50 });
    const started = Date.now();
    const err: unknown = await new ClaudeCodeAdapter(runner)
      .runStructured(
        'CT-01',
        VALID_SCHEMA,
        { prompt: '[지시] x' },
        { model: 'sonnet', timeoutMs: 200 },
      )
      .catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(err).toBeInstanceOf(AiCallFailedError);
    expect((err as AiCallFailedError).errorCode).toBe(AI_RUN_ERROR_CODES.TIMEOUT);
  });

  it('시간 제한 0·음수는 spawn하지 않는다(무제한 금지)', async () => {
    const spy = spawnSpy();
    const runner = new IsolatedCliRunner({ env: world.env, spawn: spy.fn });
    const cwd = mkdtempSync(join(tmpdir(), 'autostore-ai-test-'));
    try {
      await expect(
        runner.run({ bin: 'claude', args: ['--version'], cwd, timeoutMs: 0, mode: 'probe' }),
      ).rejects.toThrow(/무제한/);
      expect(spy.calls).toHaveLength(0);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
