import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BE_ROOT } from '../../../common/config/paths.js';
import { buildAgyArgs } from './adapters/agy.adapter.js';
import { buildClaudeArgs } from './adapters/claude-code.adapter.js';
import { buildCodexArgs } from './adapters/codex.adapter.js';
import {
  assertIsolatedCliInvocation,
  checkIsolatedCliInvocation,
  CliIsolationError,
  type CliInvocation,
} from './cli-isolation.js';

describe('assertIsolatedCliInvocation(F-BS-07)', () => {
  let emptyDir: string;
  let filledDir: string;

  beforeEach(() => {
    emptyDir = mkdtempSync(join(tmpdir(), 'autostore-ai-test-'));
    filledDir = mkdtempSync(join(tmpdir(), 'autostore-ai-test-'));
    writeFileSync(join(filledDir, 'CLAUDE.md'), '# 사용자 설정');
  });

  afterEach(() => {
    rmSync(emptyDir, { recursive: true, force: true });
    rmSync(filledDir, { recursive: true, force: true });
  });

  const claude = (over: Partial<CliInvocation> = {}): CliInvocation => ({
    bin: '/usr/local/bin/claude',
    args: [
      '-p',
      'OK라고만 답해',
      '--model',
      'sonnet',
      '--output-format',
      'json',
      '--json-schema',
      '{"type":"object"}',
      '--tools',
      '',
      '--no-session-persistence',
      '--safe-mode',
      '--setting-sources',
      '',
      '--strict-mcp-config',
    ],
    cwd: emptyDir,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: '/Users/someone',
      DISABLE_AUTOUPDATER: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    shell: false,
    ...over,
  });

  it('올바른 claude 호출은 통과한다', () => {
    expect(() => assertIsolatedCliInvocation(claude())).not.toThrow();
  });

  it('M0 S6: --safe-mode·--setting-sources ""·--strict-mcp-config 셋 다 있어야 한다(하나라도 빠지면 실패)', () => {
    const without = (flag: string) => {
      const args = [...claude().args];
      const i = args.indexOf(flag);
      args.splice(i, flag === '--setting-sources' ? 2 : 1);
      return args;
    };
    for (const flag of ['--safe-mode', '--setting-sources', '--strict-mcp-config']) {
      expect(checkIsolatedCliInvocation(claude({ args: without(flag) }))).toEqual(
        expect.arrayContaining([expect.stringMatching(/전역 설정 차단/)]),
      );
    }
  });

  it('--setting-sources 값이 빈 문자열이 아니면 실패(사용자·프로젝트 설정을 읽는다)', () => {
    const args = [...claude().args];
    args[args.indexOf('--setting-sources') + 1] = 'project';
    expect(checkIsolatedCliInvocation(claude({ args }))).toEqual([
      'claude --setting-sources 값은 빈 문자열이어야 한다(사용자·프로젝트 설정을 읽지 않는다)',
    ]);
    const eqForm = [...claude().args];
    eqForm.splice(eqForm.indexOf('--setting-sources'), 2, '--setting-sources=');
    expect(checkIsolatedCliInvocation(claude({ args: eqForm }))).toEqual([]);
  });

  it('올바른 agy·codex 호출은 통과한다(전역 설정 옵션은 claude만 본다)', () => {
    expect(
      checkIsolatedCliInvocation({
        ...claude(),
        bin: 'agy',
        args: ['-p', 'x', '--model', 'gemini-3.8-flash-medium', '--print-timeout', '120s'],
      }),
    ).toEqual([]);
    expect(
      checkIsolatedCliInvocation({
        ...claude(),
        bin: 'codex',
        args: ['exec', 'x', '--model=gpt-5', '--sandbox', 'read-only', '--ephemeral'],
      }),
    ).toEqual([]);
  });

  it('파일이 든 cwd는 실패', () => {
    expect(() => assertIsolatedCliInvocation(claude({ cwd: filledDir }))).toThrow(
      /cwd가 비어 있지 않다/,
    );
  });

  it('저장소 안 cwd는 실패(상위 .claude·CLAUDE.md)', () => {
    expect(checkIsolatedCliInvocation(claude({ cwd: BE_ROOT }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/저장소 안/)]),
    );
  });

  it('shell: true는 실패', () => {
    expect(() => assertIsolatedCliInvocation(claude({ shell: true }))).toThrow(/shell: false/);
    expect(checkIsolatedCliInvocation(claude({ shell: '/bin/zsh' }))).toContain(
      'shell: false여야 한다',
    );
  });

  it('--model이 없으면 실패', () => {
    const args = claude().args.filter((a) => a !== '--model' && a !== 'sonnet');
    expect(() => assertIsolatedCliInvocation(claude({ args }))).toThrow(/--model/);
    expect(checkIsolatedCliInvocation(claude({ args: [...args, '--model'] }))).toContain(
      '--model을 적어야 한다',
    );
  });

  it.each(['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'GEMINI_API_KEY'])(
    'env에 %s가 있으면 실패',
    (key) => {
      const inv = claude({ env: { ...claude().env, [key]: 'dummy' } });
      expect(() => assertIsolatedCliInvocation(inv)).toThrow(CliIsolationError);
      expect(checkIsolatedCliInvocation(inv)).toContain(`env에 ${key}를 넘기면 안 된다`);
    },
  );

  it('허용 목록 밖 환경변수는 실패', () => {
    expect(
      checkIsolatedCliInvocation(claude({ env: { PATH: '/usr/bin', NODE_OPTIONS: '--x' } })),
    ).toContain('env NODE_OPTIONS는 허용 목록에 없다');
  });

  it('claude에 전역 설정 차단 옵션이 없으면 실패', () => {
    const args = claude().args.filter((a) => a !== '--safe-mode');
    expect(() => assertIsolatedCliInvocation(claude({ args }))).toThrow(/전역 설정 차단/);
  });

  it('probe(감지 호출: --version·auth status)는 --model·claude 전역 설정 옵션을 보지 않고 나머지 규약은 그대로 본다(P1-10)', () => {
    const probe = claude({ args: ['auth', 'status'] });
    expect(checkIsolatedCliInvocation(probe, 'probe')).toEqual([]);
    expect(checkIsolatedCliInvocation(probe)).toEqual(
      expect.arrayContaining(['--model을 적어야 한다', expect.stringMatching(/전역 설정 차단/)]),
    );
    expect(
      checkIsolatedCliInvocation(claude({ args: ['--version'], shell: true }), 'probe'),
    ).toContain('shell: false여야 한다');
    expect(
      checkIsolatedCliInvocation(claude({ args: ['--version'], cwd: filledDir }), 'probe'),
    ).toContain('cwd가 비어 있지 않다');
    expect(
      checkIsolatedCliInvocation(
        claude({ args: ['--version'], env: { PATH: '/usr/bin', OPENAI_API_KEY: 'y' } }),
        'probe',
      ),
    ).toContain('env에 OPENAI_API_KEY를 넘기면 안 된다');
  });

  it('P1-10 인자 빌더 3개(텍스트·비전)가 만든 인자는 격리 검사기를 통과한다', () => {
    const schema = { type: 'object', properties: {}, required: [], additionalProperties: false };
    const env = { PATH: '/usr/bin:/bin', HOME: '/Users/someone' };
    const cases: [string, string[]][] = [
      ['claude', buildClaudeArgs({ prompt: '[지시] x', model: 'sonnet', schema, imageDir: null })],
      [
        'claude',
        buildClaudeArgs({ prompt: '[지시] x', model: 'sonnet', schema, imageDir: emptyDir }),
      ],
      [
        'agy',
        buildAgyArgs({
          prompt: '[지시] x',
          model: 'm',
          schema,
          timeoutMs: 120_000,
          imageDir: null,
        }),
      ],
      [
        'codex',
        buildCodexArgs({
          prompt: '[지시] x',
          model: 'gpt-5',
          schemaFile: '/tmp/s.json',
          lastMessageFile: '/tmp/l.json',
          imagePaths: ['/tmp/a.jpg'],
        }),
      ],
    ];
    for (const [bin, args] of cases) {
      expect(checkIsolatedCliInvocation({ bin, args, cwd: emptyDir, env, shell: false })).toEqual(
        [],
      );
    }
  });

  it('허용하지 않은 실행 파일(래퍼·다른 CLI)은 실패', () => {
    expect(checkIsolatedCliInvocation(claude({ bin: 'agy-image' }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/실행 파일은/)]),
    );
  });
});
