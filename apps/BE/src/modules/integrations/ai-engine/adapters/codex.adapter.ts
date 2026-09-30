import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AI_ENGINE_BINARY, CODEX_ISOLATION_ARGS } from '../ai-engine.constants.js';
import { AI_RUN_ERROR_CODES, AiOutputInvalidError } from '../ai-engine.errors.js';
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
  mapSpawnError,
  revalidate,
  runProbe,
  runSmokeTest,
  visionPromptSuffix,
} from './cli-adapter-support.js';

/** 작업 폴더 안 결과 파일 이름(`--output-last-message`, spawn 뒤 codex가 만든다) */
export const CODEX_LAST_MESSAGE_FILE = 'last-message.json';
/** 입출력 폴더 안 스키마 파일 이름(`--output-schema`) */
export const CODEX_SCHEMA_FILE = 'output-schema.json';

export interface CodexArgsInput {
  prompt: string;
  model: string;
  /** `--output-schema` 파일 경로 */
  schemaFile: string;
  /** `--output-last-message` 결과 파일 경로(작업 폴더 안) */
  lastMessageFile: string;
  /** 비전: 이미지 파일(프롬프트 인자 바로 뒤에 `--image <path>`를 이미지마다 반복) */
  imagePaths: readonly string[];
}

/**
 * codex 호출 인자(규칙 6, F-BS-73, PRD §8.9 codex 템플릿 — M0 S7에서 확정):
 * `exec <prompt> [--image <path>]… --model <id> --output-schema <파일> --sandbox read-only --skip-git-repo-check
 * --ephemeral --output-last-message <결과 파일>`. `~/.codex` 격리 플래그(`CODEX_ISOLATION_ARGS`)는 S7 뒤.
 */
export function buildCodexArgs(input: CodexArgsInput): string[] {
  if (!input.model || input.model.trim() === '') throw new Error('codex --model 값이 비었다');
  return [
    'exec',
    input.prompt,
    ...input.imagePaths.flatMap((path) => ['--image', path]),
    '--model',
    input.model,
    '--output-schema',
    input.schemaFile,
    '--sandbox',
    'read-only',
    '--skip-git-repo-check',
    '--ephemeral',
    '--output-last-message',
    input.lastMessageFile,
    ...CODEX_ISOLATION_ARGS,
  ];
}

/**
 * codex 결과 해석(규칙 8): `--output-last-message` 파일의 JSON만 믿는다. stdout(`--json` 이벤트 등)은 쓰지 않는다.
 * 파일이 없거나 비었거나 JSON이 아니면 실패.
 */
export function parseCodexResult(
  result: CliRunResult,
  lastMessage: string | null,
  timeoutMs: number,
): unknown {
  assertCliSucceeded('CODEX', result, timeoutMs, { usesStdout: false });
  if (lastMessage === null || lastMessage.trim() === '') {
    throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, '결과 파일이 비었음');
  }
  try {
    return JSON.parse(lastMessage) as unknown;
  } catch {
    throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, '결과 파일이 JSON이 아님');
  }
}

/** Codex(`codex`) 어댑터(F-BS-73). M0 S7 전에는 합성 fixture로만 검증한다 */
export class CodexAdapter implements AiEngineAdapter {
  readonly code = 'CODEX' as const;
  private lastVersion: string | null = null;

  constructor(private readonly runner: IsolatedCliRunner) {}

  async detect(): Promise<AiEngineDetection> {
    const detection = await detectCli(this.runner, this.code);
    this.lastVersion = detection.cliVersion;
    return detection;
  }

  /** `codex login status`(로그인 정보·`~/.codex` 파일은 읽지 않는다) */
  async authStatus(): Promise<AiEngineAuthStatus> {
    return authStatusFromProbe(await runProbe(this.runner, this.code, ['login', 'status']));
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
    return withAiWorkspace({ images: inputs.imagePaths ?? [], io: true }, async (ws) => {
      const eff = effectiveSchemaOf(schema, ws.imageNames);
      assertAiSchemaRules(eff.schema);
      const schemaFile = join(ws.ioDir!, CODEX_SCHEMA_FILE);
      await writeFile(schemaFile, JSON.stringify(eff.schema), 'utf8');
      const lastMessageFile = join(ws.cwd, CODEX_LAST_MESSAGE_FILE);
      const prompt = ws.imageNames.length
        ? inputs.prompt + visionPromptSuffix(ws.imageNames, '첨부한 이미지')
        : inputs.prompt;
      const args = buildCodexArgs({
        prompt,
        model: options.model,
        schemaFile,
        lastMessageFile,
        imagePaths: ws.imagePaths,
      });
      const result = await this.runner
        .run({ bin: AI_ENGINE_BINARY.CODEX, args, cwd: ws.cwd, timeoutMs: options.timeoutMs })
        .catch((error: unknown) => {
          throw mapSpawnError(this.code, error);
        });
      const lastMessage = await readFile(lastMessageFile, 'utf8').catch(() => null);
      const output = revalidate(
        eff.schema,
        parseCodexResult(result, lastMessage, options.timeoutMs),
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
