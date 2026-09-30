import { AGY_ISOLATION_ARGS, AI_ENGINE_BINARY } from '../ai-engine.constants.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
  AiEngineUnavailableError,
  AiOutputInvalidError,
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
import { AGY_MODELS_ARGS, parseAgyModels } from '../agy-models.provider.js';
import type { CliRunResult, IsolatedCliRunner } from '../process/isolated-cli-runner.js';
import { withAiWorkspace } from '../process/work-dir.js';
import { assertAiSchemaRules } from '../schema/ai-schema-rules.js';
import {
  assertCliSucceeded,
  assertModel,
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

/** agy 호출 인자 입력 */
export interface AgyArgsInput {
  prompt: string;
  model: string;
  schema: AiJsonSchema;
  /** CLI 시간 제한(ms). `--print-timeout`에 단위를 붙여 넣는다(0·음수 금지 — 0은 무제한) */
  timeoutMs: number;
  /** 비전: 이미지 전용 폴더(`--add-dir`). 텍스트면 null */
  imageDir: string | null;
}

/** `--print-timeout` 값(초 단위 + 's', 예 120000 → '120s'). 0·음수·숫자 아님은 오류(무제한 금지, AI-03) */
export function agyPrintTimeout(timeoutMs: number): string {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('agy --print-timeout은 0보다 커야 한다(0 = 무제한 금지)');
  }
  return `${Math.max(1, Math.ceil(timeoutMs / 1000))}s`;
}

/**
 * agy 호출 인자(규칙 6, PRD §8.9 agy 템플릿): `-p <prompt> --model <id> --output-format json --json-schema <schema>
 * --print-timeout <120s·180s>`, 비전은 `--add-dir <이미지 폴더>`. 사용자 MCP 끄기 플래그(`AGY_ISOLATION_ARGS`)는 M0 S6 뒤.
 */
export function buildAgyArgs(input: AgyArgsInput): string[] {
  if (!input.model || input.model.trim() === '') throw new Error('agy --model 값이 비었다');
  return [
    '-p',
    input.prompt,
    '--model',
    input.model,
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(input.schema),
    '--print-timeout',
    agyPrintTimeout(input.timeoutMs),
    ...(input.imageDir ? ['--add-dir', input.imageDir] : []),
    ...AGY_ISOLATION_ARGS,
  ];
}

/** 부분 출력 경고(합성본: `partial: true` 또는 warnings에 partial·truncat·incomplete·부분) */
export function hasAgyPartialWarning(envelope: Record<string, unknown>): boolean {
  if (envelope.partial === true || envelope.partial_output === true) return true;
  const warnings = envelope.warnings;
  if (!Array.isArray(warnings)) return false;
  const textOf = (v: unknown): string => (typeof v === 'string' ? v : '');
  return warnings.some((w) => {
    const text =
      typeof w === 'string'
        ? w
        : w && typeof w === 'object'
          ? `${textOf((w as Record<string, unknown>).code)} ${textOf((w as Record<string, unknown>).message)}`
          : '';
    return /partial|truncat|incomplete|부분/i.test(text);
  });
}

/**
 * agy 결과 해석(규칙 8, PRD §8.9 agy): exit code, stderr의 `AGY_ERROR`, `status`를 보고 `structured_output`만 쓴다.
 * SUCCESS인데 비었거나(재검증) 부분 출력 경고가 있으면 실패. 합성본 봉투: `{ status:'SUCCESS', structured_output:{…}, warnings:[] }`.
 */
export function parseAgyResult(result: CliRunResult, timeoutMs: number): unknown {
  if (!result.timedOut && /AGY_ERROR/.test(result.stderr)) {
    throw new AiCallFailedError('AGY', AI_RUN_ERROR_CODES.AGY_ERROR, 'stderr AGY_ERROR');
  }
  assertCliSucceeded('AGY', result, timeoutMs);
  const envelope = parseJsonEnvelope(result.stdout);
  const status = typeof envelope.status === 'string' ? envelope.status : '';
  if (status !== 'SUCCESS') {
    if (LOGGED_OUT_PATTERN.test(`${JSON.stringify(envelope)}\n${result.stderr}`)) {
      throw new AiEngineUnavailableError('AGY', 'NOT_LOGGED_IN');
    }
    if (/TIMEOUT/i.test(status)) {
      throw new AiCallFailedError(
        'AGY',
        AI_RUN_ERROR_CODES.TIMEOUT,
        `${Math.round(timeoutMs / 1000)}초`,
      );
    }
    throw new AiCallFailedError('AGY', AI_RUN_ERROR_CODES.CLI_FAILED, `status ${status || '없음'}`);
  }
  if (hasAgyPartialWarning(envelope)) {
    throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, '부분 출력 경고');
  }
  return envelope.structured_output;
}

/** Antigravity CLI(`agy`) 텍스트·비전 어댑터(F-BS-74). 이미지 생성 경로(P3-02 ImageGenProvider)와 분리한다 */
export class AgyAdapter implements AiEngineAdapter {
  readonly code = 'AGY' as const;
  private lastVersion: string | null = null;

  constructor(private readonly runner: IsolatedCliRunner) {}

  async detect(): Promise<AiEngineDetection> {
    const detection = await detectCli(this.runner, this.code);
    this.lastVersion = detection.cliVersion;
    return detection;
  }

  /** agy는 로그인 확인 명령이 없다 — 부르지 않고 UNKNOWN('연결 테스트로 확인', R6) */
  authStatus(): Promise<AiEngineAuthStatus> {
    return Promise.resolve('UNKNOWN');
  }

  smokeTest(model: string): Promise<AiEngineSmokeResult> {
    return runSmokeTest(this, model);
  }

  /**
   * `agy models`(P1-11, F-ST-30): 호출 비용이 없는 감지 호출(probe, 빈 작업 폴더·허용 환경변수만). 모델 ID 목록으로 바꾼다
   * (`parseAgyModels`). 실행 파일이 없거나 실패·시간 초과·빈 목록이면 null. 던지지 않는다.
   */
  async listModels(): Promise<string[] | null> {
    if (!this.runner.locate(AI_ENGINE_BINARY.AGY)) return null;
    const result = await runProbe(this.runner, this.code, AGY_MODELS_ARGS).catch(() => null);
    if (!result || result.timedOut || result.exitCode !== 0) return null;
    const models = parseAgyModels(result.stdout);
    return models.length > 0 ? models : null;
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
      const args = buildAgyArgs({
        prompt,
        model: options.model,
        schema: eff.schema,
        timeoutMs: options.timeoutMs,
        imageDir: ws.imageDir,
      });
      const result = await this.runner
        .run({ bin: AI_ENGINE_BINARY.AGY, args, cwd: ws.cwd, timeoutMs: options.timeoutMs })
        .catch((error: unknown) => {
          throw mapSpawnError(this.code, error);
        });
      const output = revalidate(
        eff.schema,
        parseAgyResult(result, options.timeoutMs),
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
