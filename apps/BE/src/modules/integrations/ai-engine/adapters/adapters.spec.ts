import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AI_FIXTURE_ROOT,
  createFakeCliWorld,
  type FakeCliEngine,
  type FakeCliWorld,
} from '../../../../../test/support/fake-ai-cli.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
  AiEngineUnavailableError,
  AiOutputInvalidError,
} from '../ai-engine.errors.js';
import type { AiEngineAdapter } from '../ai-engine.port.js';
import { checkIsolatedCliInvocation } from '../cli-isolation.js';
import { IsolatedCliRunner } from '../process/isolated-cli-runner.js';
import { AgyAdapter, buildAgyArgs } from './agy.adapter.js';
import { buildClaudeArgs, ClaudeCodeAdapter } from './claude-code.adapter.js';
import { buildCodexArgs, CodexAdapter } from './codex.adapter.js';

const SCHEMA = JSON.parse(
  readFileSync(join(AI_FIXTURE_ROOT, 'schemas', 'valid.schema.json'), 'utf8'),
) as Record<string, unknown>;

const TEXT = { model: 'sonnet', timeoutMs: 120_000 };

function adapterFor(engine: FakeCliEngine, runner: IsolatedCliRunner): AiEngineAdapter {
  if (engine === 'claude') return new ClaudeCodeAdapter(runner);
  if (engine === 'agy') return new AgyAdapter(runner);
  return new CodexAdapter(runner);
}

async function errorOf(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => null,
    (e: unknown) => e,
  );
}

describe('인자 빌더(P1-10 규칙 4·6, P1-01 F-BS-07 검사기와 함께)', () => {
  const schema = { type: 'object', properties: {}, required: [], additionalProperties: false };

  it('buildClaudeArgs(텍스트): -p·--model sonnet·--output-format json·--json-schema·--tools ""·--no-session-persistence·격리 플래그', () => {
    const args = buildClaudeArgs({ prompt: '[지시] x', model: 'sonnet', schema, imageDir: null });
    expect(args.slice(0, 4)).toEqual(['-p', '[지시] x', '--model', 'sonnet']);
    expect(args).toEqual(
      expect.arrayContaining([
        '--output-format',
        'json',
        '--no-session-persistence',
        '--safe-mode',
      ]),
    );
    expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(schema));
    expect(args[args.indexOf('--tools') + 1]).toBe('');
    expect(args).not.toContain('--add-dir');
    expect(
      checkIsolatedCliInvocation({
        bin: 'claude',
        args,
        cwd: '/definitely/missing',
        env: {},
        shell: false,
      }).filter((v) => !v.startsWith('cwd')),
    ).toEqual([]);
  });

  it('buildClaudeArgs(비전): --tools Read --allowedTools Read --add-dir <폴더>, --tools "" 없음', () => {
    const args = buildClaudeArgs({
      prompt: '[지시] x',
      model: 'sonnet',
      schema,
      imageDir: '/tmp/img',
    });
    const i = args.indexOf('--tools');
    expect(args.slice(i, i + 6)).toEqual([
      '--tools',
      'Read',
      '--allowedTools',
      'Read',
      '--add-dir',
      '/tmp/img',
    ]);
    expect(args.filter((a, k) => a === '--tools' && args[k + 1] === '')).toHaveLength(0);
  });

  it('buildAgyArgs: 텍스트 --print-timeout 120s, 비전 180s + --add-dir. 0·음수는 오류', () => {
    const text = buildAgyArgs({
      prompt: '[지시] x',
      model: 'gemini-3.8-flash-medium',
      schema,
      timeoutMs: 120_000,
      imageDir: null,
    });
    expect(text.slice(0, 4)).toEqual(['-p', '[지시] x', '--model', 'gemini-3.8-flash-medium']);
    expect(text[text.indexOf('--print-timeout') + 1]).toBe('120s');
    expect(text).toEqual(expect.arrayContaining(['--output-format', 'json', '--json-schema']));
    const vision = buildAgyArgs({
      prompt: '[지시] x',
      model: 'gemini-3.8-flash-high',
      schema,
      timeoutMs: 180_000,
      imageDir: '/tmp/img',
    });
    expect(vision[vision.indexOf('--print-timeout') + 1]).toBe('180s');
    expect(vision[vision.indexOf('--add-dir') + 1]).toBe('/tmp/img');
    for (const timeoutMs of [0, -1, Number.NaN]) {
      expect(() =>
        buildAgyArgs({ prompt: 'x', model: 'm', schema, timeoutMs, imageDir: null }),
      ).toThrow(/print-timeout/);
    }
  });

  it('buildCodexArgs(비전 2장): exec <prompt> 바로 뒤에 --image a.jpg --image b.jpg, 필수 플래그 포함', () => {
    const args = buildCodexArgs({
      prompt: '[지시] x',
      model: 'gpt-5',
      schemaFile: '/tmp/io/output-schema.json',
      lastMessageFile: '/tmp/work/last-message.json',
      imagePaths: ['a.jpg', 'b.jpg'],
    });
    expect(args.slice(0, 6)).toEqual(['exec', '[지시] x', '--image', 'a.jpg', '--image', 'b.jpg']);
    expect(args).toEqual(
      expect.arrayContaining([
        '--model',
        'gpt-5',
        '--output-schema',
        '/tmp/io/output-schema.json',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '--ephemeral',
        '--output-last-message',
        '/tmp/work/last-message.json',
      ]),
    );
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
  });

  it('모델이 비면 빌더도 던진다(--model 명시, 규칙 2)', () => {
    expect(() => buildClaudeArgs({ prompt: 'x', model: ' ', schema, imageDir: null })).toThrow();
    expect(() =>
      buildCodexArgs({
        prompt: 'x',
        model: '',
        schemaFile: 'a',
        lastMessageFile: 'b',
        imagePaths: [],
      }),
    ).toThrow();
  });
});

describe('어댑터 결과 해석(P1-10 규칙 8·9·12) — 가짜 CLI·합성 fixture', () => {
  let world: FakeCliWorld;
  let runner: IsolatedCliRunner;

  beforeEach(() => {
    world = createFakeCliWorld();
    runner = new IsolatedCliRunner({ env: world.env });
  });

  afterEach(() => {
    world.cleanup();
  });

  it('claude text-success.json: structured_output만 결과로 나온다', async () => {
    world.setScenario({ claude: { run: { stdout: 'claude/text-success.json' } } });
    const result = await new ClaudeCodeAdapter(runner).runStructured(
      'CT-01',
      SCHEMA,
      { prompt: '[지시] x' },
      TEXT,
    );
    const envelope = JSON.parse(
      readFileSync(join(AI_FIXTURE_ROOT, 'claude', 'text-success.json'), 'utf8'),
    ) as { structured_output: unknown };
    expect(result.output).toEqual(envelope.structured_output);
    expect(result.model).toBe('sonnet');
    expect(typeof result.latencyMs).toBe('number');
  });

  it.each([
    [
      'claude',
      { stdout: 'claude/success-empty-structured-output.json' },
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
    ],
    [
      'agy',
      { stdout: 'agy/success-empty-structured-output.json' },
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
    ],
    ['agy', { stdout: 'agy/partial-output-warning.json' }, AI_RUN_ERROR_CODES.OUTPUT_INVALID],
    [
      'agy',
      { stdout: 'agy/success.json', stderr: 'agy/agy-error.stderr.txt' },
      AI_RUN_ERROR_CODES.AGY_ERROR,
    ],
    ['claude', { stdout: 'claude/text-success.json', exit: 1 }, AI_RUN_ERROR_CODES.CLI_FAILED],
    ['agy', { stdout: 'agy/success.json', exit: 1 }, AI_RUN_ERROR_CODES.CLI_FAILED],
    [
      'codex',
      { stdout: 'codex/events.jsonl', lastMessage: 'codex/last-message-success.json', exit: 1 },
      AI_RUN_ERROR_CODES.CLI_FAILED,
    ],
    ['claude', { stdout: 'claude/extra-field.json' }, AI_RUN_ERROR_CODES.OUTPUT_INVALID],
    ['claude', { stdout: { text: '이건 JSON이 아니다' } }, AI_RUN_ERROR_CODES.OUTPUT_INVALID],
    [
      'codex',
      { stdout: 'codex/events.jsonl', lastMessage: null },
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
    ],
    [
      'codex',
      { stdout: 'codex/events.jsonl', lastMessage: { text: '{"title":"x"' } },
      AI_RUN_ERROR_CODES.OUTPUT_INVALID,
    ],
  ] as const)('%s %j → 실패(%s)', async (engine, run, code) => {
    world.setScenario({ [engine]: { run } });
    const err = await errorOf(
      adapterFor(engine, runner).runStructured('CT-01', SCHEMA, { prompt: '[지시] x' }, TEXT),
    );
    expect(err).toBeInstanceOf(
      code === AI_RUN_ERROR_CODES.OUTPUT_INVALID ? AiOutputInvalidError : AiCallFailedError,
    );
    expect((err as AiOutputInvalidError | AiCallFailedError).errorCode).toBe(code);
  });

  it('codex: stdout에 다른 JSON이 있어도 --output-last-message 파일 값만 쓴다', async () => {
    world.setScenario({
      codex: {
        run: {
          stdout: { text: '{"title":"STDOUT 값","bullets":[],"note":"stdout"}' },
          lastMessage: 'codex/last-message-success.json',
        },
      },
    });
    const result = await new CodexAdapter(runner).runStructured(
      'CT-01',
      SCHEMA,
      { prompt: '[지시] x' },
      { model: 'gpt-5', timeoutMs: 120_000 },
    );
    expect(result.output).toEqual(
      JSON.parse(readFileSync(join(AI_FIXTURE_ROOT, 'codex', 'last-message-success.json'), 'utf8')),
    );
    const [rec] = world.records();
    // 결과 파일은 작업 폴더 안(spawn 때는 비어 있다), 스키마 파일은 따로 둔 폴더
    const lastMessage = rec!.argv[rec!.argv.indexOf('--output-last-message') + 1]!;
    expect(lastMessage.endsWith('/last-message.json')).toBe(true);
    expect(rec!.cwdEntries).toEqual([]);
    expect(rec!.argv[rec!.argv.indexOf('--output-schema') + 1]).not.toContain(rec!.cwd);
  });

  describe('비전(규칙 9)', () => {
    let images: string[];

    beforeEach(() => {
      images = [join(world.dir, 'side.JPG'), join(world.dir, 'back.png')];
      writeFileSync(images[0]!, 'fake-jpeg');
      writeFileSync(images[1]!, 'fake-png');
    });

    it('claude: Read·이미지 전용 폴더(이번 이미지만) → images_seen이 맞으면 통과', async () => {
      world.setScenario({ claude: { run: { stdout: 'claude/vision-success.json' } } });
      const result = await new ClaudeCodeAdapter(runner).runStructured(
        'CT-02',
        SCHEMA,
        { prompt: '[지시] x', imagePaths: images },
        { model: 'sonnet', timeoutMs: 180_000 },
      );
      expect(result.output).toMatchObject({ images_seen: ['image-1.jpg', 'image-2.png'] });
      const [rec] = world.records();
      expect(rec!.addDirEntries).toEqual(['image-1.jpg', 'image-2.png']);
      expect(rec!.argv).toEqual(expect.arrayContaining(['--tools', 'Read', '--allowedTools']));
      const schemaArg = JSON.parse(rec!.argv[rec!.argv.indexOf('--json-schema') + 1]!) as {
        required: string[];
      };
      expect(schemaArg.required).toContain('images_seen');
    });

    it('images_seen이 없거나 넘긴 이미지와 다르면 실패(AI_IMAGES_NOT_SEEN)', async () => {
      world.setScenario({ claude: { run: { stdout: 'claude/text-success.json' } } });
      const missing = await errorOf(
        new ClaudeCodeAdapter(runner).runStructured(
          'CT-02',
          SCHEMA,
          { prompt: '[지시] x', imagePaths: images },
          { model: 'sonnet', timeoutMs: 180_000 },
        ),
      );
      expect((missing as AiOutputInvalidError).errorCode).toBe(AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN);

      world.setScenario({ claude: { run: { stdout: 'claude/vision-success.json' } } });
      const third = join(world.dir, 'top.webp');
      writeFileSync(third, 'fake-webp');
      const mismatch = await errorOf(
        new ClaudeCodeAdapter(runner).runStructured(
          'CT-02',
          SCHEMA,
          { prompt: '[지시] x', imagePaths: [...images, third] },
          { model: 'sonnet', timeoutMs: 180_000 },
        ),
      );
      expect((mismatch as AiOutputInvalidError).errorCode).toBe(AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN);
    });

    it('agy는 --add-dir, codex는 exec <prompt> 뒤 --image(이미지 전용 폴더의 복사본)', async () => {
      const vision = {
        text: JSON.stringify({
          status: 'SUCCESS',
          structured_output: {
            title: 't',
            bullets: [],
            note: null,
            images_seen: ['image-1.jpg', 'image-2.png'],
          },
          warnings: [],
        }),
      };
      world.setScenario({
        agy: { run: { stdout: vision } },
        codex: {
          run: {
            stdout: 'codex/events.jsonl',
            lastMessage: {
              text: JSON.stringify({
                title: 't',
                bullets: [],
                note: null,
                images_seen: ['image-1.jpg', 'image-2.png'],
              }),
            },
          },
        },
      });
      await new AgyAdapter(runner).runStructured(
        'CT-02',
        SCHEMA,
        { prompt: '[지시] x', imagePaths: images },
        { model: 'gemini-3.8-flash-high', timeoutMs: 180_000 },
      );
      await new CodexAdapter(runner).runStructured(
        'CT-02',
        SCHEMA,
        { prompt: '[지시] x', imagePaths: images },
        { model: 'gpt-5', timeoutMs: 180_000 },
      );
      const [agy, codex] = world.records();
      expect(agy!.addDirEntries).toEqual(['image-1.jpg', 'image-2.png']);
      expect(agy!.argv[agy!.argv.indexOf('--print-timeout') + 1]).toBe('180s');
      expect(codex!.argv[0]).toBe('exec');
      expect(codex!.argv[2]).toBe('--image');
      expect(codex!.images.map((i) => i.path.split('/').pop())).toEqual([
        'image-1.jpg',
        'image-2.png',
      ]);
      expect(codex!.images.every((i) => i.exists)).toBe(true);
    });
  });

  it('규칙 12: 실행 파일 없음(ENOENT) → NOT_INSTALLED, 로그인 풀림 출력 → NOT_LOGGED_IN', async () => {
    const noClaude = createFakeCliWorld(['agy']);
    try {
      const err = await errorOf(
        new ClaudeCodeAdapter(new IsolatedCliRunner({ env: noClaude.env })).runStructured(
          'CT-01',
          SCHEMA,
          { prompt: '[지시] x' },
          TEXT,
        ),
      );
      expect(err).toBeInstanceOf(AiEngineUnavailableError);
      expect((err as AiEngineUnavailableError).reason).toBe('NOT_INSTALLED');
    } finally {
      noClaude.cleanup();
    }
    world.setScenario({ claude: { run: { stdout: 'claude/error-logged-out.json', exit: 1 } } });
    const loggedOut = await errorOf(
      new ClaudeCodeAdapter(runner).runStructured('CT-01', SCHEMA, { prompt: '[지시] x' }, TEXT),
    );
    expect(loggedOut).toBeInstanceOf(AiEngineUnavailableError);
    expect((loggedOut as AiEngineUnavailableError).reason).toBe('NOT_LOGGED_IN');
  });

  it('로그인 확인: claude auth status·codex login status 출력으로 OK·NOT_LOGGED_IN', async () => {
    expect(await new ClaudeCodeAdapter(runner).authStatus()).toBe('OK');
    expect(await new CodexAdapter(runner).authStatus()).toBe('OK');
    world.setScenario({
      claude: { auth: { stdout: 'claude/auth-status-logged-out.txt', exit: 1 } },
      codex: { auth: { stdout: 'codex/login-status-logged-out.txt', exit: 1 } },
    });
    expect(await new ClaudeCodeAdapter(runner).authStatus()).toBe('NOT_LOGGED_IN');
    expect(await new CodexAdapter(runner).authStatus()).toBe('NOT_LOGGED_IN');
    const authArgs = world
      .records()
      .filter((r) => r.kind === 'auth')
      .map((r) => `${r.engine} ${r.argv.join(' ')}`);
    expect(authArgs).toEqual(expect.arrayContaining(['claude auth status', 'codex login status']));
  });

  it('감지: --version으로 버전(2.1.269·1.2.9·0.44.0)·경로. 없거나 --version이 실패하면 미설치', async () => {
    const claude = await new ClaudeCodeAdapter(runner).detect();
    expect(claude).toEqual({
      installed: true,
      binPath: join(world.dir, 'claude'),
      cliVersion: '2.1.269',
      versionSupported: null,
    });
    expect((await new AgyAdapter(runner).detect()).cliVersion).toBe('1.2.9');
    expect((await new CodexAdapter(runner).detect()).cliVersion).toBe('0.44.0');
    world.setScenario({ agy: { version: null } });
    expect(await new AgyAdapter(runner).detect()).toEqual({
      installed: false,
      binPath: null,
      cliVersion: null,
      versionSupported: null,
    });
    const onlyAgy = createFakeCliWorld(['agy']);
    try {
      expect(
        (await new CodexAdapter(new IsolatedCliRunner({ env: onlyAgy.env })).detect()).installed,
      ).toBe(false);
      expect(onlyAgy.records().filter((r) => r.engine === 'codex')).toHaveLength(0);
    } finally {
      onlyAgy.cleanup();
    }
  });

  describe.each(['claude', 'agy', 'codex'] as const)('세 어댑터 공통 모양 — %s', (engine) => {
    it('detect·authStatus·smokeTest·runStructured가 같은 모양을 돌려준다', async () => {
      world.setScenario({
        claude: { run: { stdout: 'claude/smoke-ok.json' } },
        agy: { run: { stdout: 'agy/smoke-ok.json' } },
        codex: {
          run: { stdout: 'codex/events.jsonl', lastMessage: 'codex/last-message-smoke-ok.json' },
        },
      });
      const adapter = adapterFor(engine, runner);
      const detection = await adapter.detect();
      expect(Object.keys(detection).sort()).toEqual(
        ['binPath', 'cliVersion', 'installed', 'versionSupported'].sort(),
      );
      expect(['OK', 'NOT_LOGGED_IN', 'UNKNOWN']).toContain(await adapter.authStatus());
      const smoke = await adapter.smokeTest('m-1');
      expect(smoke).toEqual({
        status: 'PASSED',
        model: 'm-1',
        latencyMs: expect.any(Number) as number,
        errorCode: null,
        errorMessage: null,
      });
      const run = await adapter.runStructured(
        'AI-07',
        {
          type: 'object',
          properties: { answer: { type: 'string', enum: ['OK'] } },
          required: ['answer'],
          additionalProperties: false,
        },
        { prompt: '[지시] x' },
        { model: 'm-1', timeoutMs: 120_000 },
      );
      expect(Object.keys(run).sort()).toEqual(['cliVersion', 'latencyMs', 'model', 'output']);
      expect(run.output).toEqual({ answer: 'OK' });
    });
  });

  it('agy.authStatus()는 spawn 없이 UNKNOWN', async () => {
    expect(await new AgyAdapter(runner).authStatus()).toBe('UNKNOWN');
    expect(world.records()).toHaveLength(0);
  });

  it('연결 테스트 실패는 던지지 않고 FAILED(CONTRACT_FAILED·NOT_LOGGED_IN)로 돌려준다', async () => {
    world.setScenario({ claude: { run: { stdout: 'claude/text-success.json' } } });
    const contract = await new ClaudeCodeAdapter(runner).smokeTest('sonnet');
    expect(contract).toMatchObject({
      status: 'FAILED',
      model: 'sonnet',
      errorCode: 'CONTRACT_FAILED',
    });
    world.setScenario({ claude: { run: { stdout: 'claude/error-logged-out.json', exit: 1 } } });
    const loggedOut = await new ClaudeCodeAdapter(runner).smokeTest('sonnet');
    expect(loggedOut).toMatchObject({ status: 'FAILED', errorCode: 'NOT_LOGGED_IN' });
  });
});
