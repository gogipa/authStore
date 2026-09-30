import { AI_ENGINE_BINARY, CLAUDE_ISOLATION_ARGS } from '../ai-engine.constants.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
  AiEngineUnavailableError,
} from '../ai-engine.errors.js';
import type {
  AiEngineAdapter,
  AiEngineAuthStatus,
  AiEngineDetection,
  AiEngineInputs,
  AiEngineSmokeResult,
  AiJsonSchema,
  AiRunOptions,
  AiStructuredResult,
} from '../ai-engine.port.js';
import type { CliRunResult, IsolatedCliRunner } from '../process/isolated-cli-runner.js';
import { withAiWorkspace } from '../process/work-dir.js';
import { assertAiSchemaRules } from '../schema/ai-schema-rules.js';
import {
  assertCliSucceeded,
  assertModel,
  authStatusFromProbe,
  detectCli,
  effectiveSchemaOf,
  LOGGED_OUT_PATTERN,
  mapSpawnError,
  parseJsonEnvelope,
  revalidate,
  runProbe,
  runSmokeTest,
  visionPromptSuffix,
} from './cli-adapter-support.js';

/** claude 호출 인자 입력 */
export interface ClaudeArgsInput {
  prompt: string;
  model: string;
  /** 결과 스키마(규칙 7). JSON 문자열로 넘긴다 */
  schema: AiJsonSchema;
  /** 비전: 이미지 전용 폴더(Read 도구와 이 폴더만 연다). 텍스트면 null */
  imageDir: string | null;
}

/**
 * claude 호출 인자(규칙 4·6, PRD §8.9 호출 템플릿). 순수 함수 — P1-01 F-BS-07 인자 검사 테스트도 이것을 쓴다.
 * - 텍스트: `-p <prompt> --model <alias> --output-format json --json-schema <schema> --tools "" --no-session-persistence`
 * - 비전: `--tools ""` 대신 `--tools Read --allowedTools Read --add-dir <이미지 폴더>`
 * - 끝에 전역 설정 차단 플래그(`CLAUDE_ISOLATION_ARGS`, 기본 `--safe-mode`)
 */
export function buildClaudeArgs(input: ClaudeArgsInput): string[] {
  if (!input.model || input.model.trim() === '') throw new Error('claude --model 값이 비었다');
  const tools = input.imageDir
    ? ['--tools', 'Read', '--allowedTools', 'Read', '--add-dir', input.imageDir]
    : ['--tools', ''];
  return [
    '-p',
    input.prompt,
    '--model',
    input.model,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(input.schema),
    ...tools,
    '--no-session-persistence',
    ...CLAUDE_ISOLATION_ARGS,
  ];
}

/**
 * claude 결과 봉투 해석(합성본: `{ type:'result', subtype:'success', is_error:false, structured_output:{…} }`).
 * `structured_output` 필드만 결과로 쓴다(나머지 stdout은 쓰지 않는다, 규칙 8). 비었는지·스키마는 재검증이 본다.
 */
export function parseClaudeResult(result: CliRunResult, timeoutMs: number): unknown {
  assertCliSucceeded('CLAUDE', result, timeoutMs);
  const envelope = parseJsonEnvelope(result.stdout);
  const failed =
    envelope.is_error === true ||
    (typeof envelope.subtype === 'string' && envelope.subtype !== 'success');
  if (failed) {
    const text = `${typeof envelope.result === 'string' ? envelope.result : ''}\n${result.stderr}`;
    if (LOGGED_OUT_PATTERN.test(text))
      throw new AiEngineUnavailableError('CLAUDE', 'NOT_LOGGED_IN');
    throw new AiCallFailedError(
      'CLAUDE',
      AI_RUN_ERROR_CODES.CLI_FAILED,
      `오류 결과 ${typeof envelope.subtype === 'string' ? envelope.subtype : 'error'}`,
    );
  }
  return envelope.structured_output;
}

/** Claude Code(`claude`) 어댑터(D-16, F-BS-26·27·28·30·31·32) */
export class ClaudeCodeAdapter implements AiEngineAdapter {
  readonly code = 'CLAUDE' as const;
  private lastVersion: string | null = null;

  constructor(private readonly runner: IsolatedCliRunner) {}

  async detect(): Promise<AiEngineDetection> {
    const detection = await detectCli(this.runner, this.code);
    this.lastVersion = detection.cliVersion;
    return detection;
  }

  /** `claude auth status`(로그인 정보·토큰 파일은 읽지 않는다, CON-11) */
  async authStatus(): Promise<AiEngineAuthStatus> {
    return authStatusFromProbe(await runProbe(this.runner, this.code, ['auth', 'status']));
  }

  smokeTest(model: string): Promise<AiEngineSmokeResult> {
    return runSmokeTest(this, model);
  }

  async runStructured<T>(
    _task: string,
    schema: AiJsonSchema,
    inputs: AiEngineInputs,
    options: AiRunOptions,
  ): Promise<AiStructuredResult<T>> {
    assertModel(this.code, options.model);
    return withAiWorkspace({ images: inputs.imagePaths ?? [] }, async (ws) => {
      const eff = effectiveSchemaOf(schema, ws.imageNames);
      assertAiSchemaRules(eff.schema);
      const prompt = ws.imageDir
        ? inputs.prompt + visionPromptSuffix(ws.imageNames, `폴더 ${ws.imageDir}`)
        : inputs.prompt;
      const args = buildClaudeArgs({
        prompt,
        model: options.model,
        schema: eff.schema,
        imageDir: ws.imageDir,
      });
      const result = await this.runner
        .run({ bin: AI_ENGINE_BINARY.CLAUDE, args, cwd: ws.cwd, timeoutMs: options.timeoutMs })
        .catch((error: unknown) => {
          throw mapSpawnError(this.code, error);
        });
      const output = revalidate(
        eff.schema,
        parseClaudeResult(result, options.timeoutMs),
        eff.expectedImages,
      );
      return {
        output: output as T,
        model: options.model,
        cliVersion: this.lastVersion,
        latencyMs: result.durationMs,
      };
    });
  }
}
