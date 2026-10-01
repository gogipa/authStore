import {
  AI_ENGINE_BINARY,
  AI_PROBE_TIMEOUT_MS,
  AI_SMOKE_PROMPT,
  AI_SMOKE_SCHEMA,
  AI_SMOKE_TASK,
  AI_SUPPORTED_VERSION_RANGE,
  AI_TEXT_TIMEOUT_MS,
} from '../ai-engine.constants.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
  AiEngineUnavailableError,
  AiExecutionError,
  AiOutputInvalidError,
} from '../ai-engine.errors.js';
import type {
  AiEngineAdapter,
  AiEngineAuthStatus,
  AiEngineCode,
  AiEngineDetection,
  AiEngineSmokeResult,
  AiJsonSchema,
} from '../ai-engine.port.js';
import {
  CliSpawnError,
  type CliRunResult,
  type IsolatedCliRunner,
} from '../process/isolated-cli-runner.js';
import { createAiWorkDir, removeAiDir } from '../process/work-dir.js';
import { validateAiOutput, withImagesSeen } from '../schema/ai-output-validator.js';

/**
 * 세 어댑터가 같이 쓰는 조각(P1-10). 엔진별 봉투 해석은 `adapters/*.adapter.ts`에 있다(M0 S6·S7 실측 반영, codex는 합성본).
 */

/** 로그인이 풀렸다는 출력(합성본 기준, 녹화본이 오면 고친다) */
export const LOGGED_OUT_PATTERN =
  /not logged in|logged out|please (?:run )?\/?login|login required|run `?\w+ login`?|invalid api key|authentication (?:failed|required)|unauthori[sz]ed|로그인(?:이|을)? ?(?:필요|하지|되어 있지)/i;

/** `--version` 출력에서 버전(예: '2.1.269 (Claude Code)' → 2.1.269). 40자까지 */
export function parseCliVersion(stdout: string): string | null {
  const m = /(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/.exec(stdout);
  return m ? m[1]!.slice(0, 40) : null;
}

/** 지원 버전 범위 안인가(P-13 미정 → null) */
export function isVersionSupported(engine: AiEngineCode, version: string | null): boolean | null {
  const range = AI_SUPPORTED_VERSION_RANGE[engine];
  if (!range || !version) return null;
  const cmp = compareVersions(version, range.min);
  if (cmp < 0) return false;
  return range.max === null ? true : compareVersions(version, range.max) <= 0;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 감지 호출 한 번(빈 작업 폴더에서, 호출 비용 없음). 실행 파일이 없으면 null */
export async function runProbe(
  runner: IsolatedCliRunner,
  engine: AiEngineCode,
  args: readonly string[],
): Promise<CliRunResult | null> {
  const cwd = await createAiWorkDir();
  try {
    return await runner.run({
      bin: AI_ENGINE_BINARY[engine],
      args,
      cwd,
      timeoutMs: AI_PROBE_TIMEOUT_MS,
      mode: 'probe',
    });
  } catch (error) {
    if (error instanceof CliSpawnError) return null;
    throw error;
  } finally {
    await removeAiDir(cwd);
  }
}

/** `--version`·실행 파일 경로(R6). installed = `--version` 성공(ERD ai_cli_check.installed) */
export async function detectCli(
  runner: IsolatedCliRunner,
  engine: AiEngineCode,
): Promise<AiEngineDetection> {
  const notInstalled: AiEngineDetection = {
    installed: false,
    binPath: null,
    cliVersion: null,
    versionSupported: null,
  };
  if (!runner.locate(AI_ENGINE_BINARY[engine])) return notInstalled;
  const result = await runProbe(runner, engine, ['--version']);
  if (!result || result.timedOut || result.exitCode !== 0) return notInstalled;
  const cliVersion = parseCliVersion(result.stdout);
  return {
    installed: true,
    binPath: result.binPath,
    cliVersion,
    versionSupported: isVersionSupported(engine, cliVersion),
  };
}

/**
 * `claude auth status`·`codex login status` 결과 해석(합성본 기준 — M0 S6·S7 녹화본으로 고친다).
 * 로그아웃 문구가 있으면 NOT_LOGGED_IN, 아니고 exit 0이면 OK, 그 밖(명령을 부르지 못함·시간 초과·알 수 없는 실패)은 UNKNOWN.
 * 모르는 실패를 NOT_LOGGED_IN으로 보면 AI 단계가 모두 막히므로 UNKNOWN으로 두고 연결 테스트가 판단하게 한다(Proposed).
 */
export function authStatusFromProbe(result: CliRunResult | null): AiEngineAuthStatus {
  if (!result || result.timedOut) return 'UNKNOWN';
  if (LOGGED_OUT_PATTERN.test(`${result.stdout}\n${result.stderr}`)) return 'NOT_LOGGED_IN';
  return result.exitCode === 0 ? 'OK' : 'UNKNOWN';
}

/**
 * 실행 결과의 공통 실패(시간 초과·로그인 풀림·exit ≠ 0·잘린 출력). 문제가 없으면 아무것도 하지 않는다.
 * `usesStdout: false`(codex — 결과는 파일)면 표준 출력이 잘려도 실패로 보지 않는다.
 */
export function assertCliSucceeded(
  engine: AiEngineCode,
  result: CliRunResult,
  timeoutMs: number,
  options: { usesStdout?: boolean } = {},
): void {
  if (result.timedOut) {
    throw new AiCallFailedError(
      engine,
      AI_RUN_ERROR_CODES.TIMEOUT,
      `${Math.round(timeoutMs / 1000)}초`,
    );
  }
  if (result.exitCode !== 0) {
    if (LOGGED_OUT_PATTERN.test(`${result.stdout}\n${result.stderr}`)) {
      throw new AiEngineUnavailableError(engine, 'NOT_LOGGED_IN');
    }
    throw new AiCallFailedError(
      engine,
      AI_RUN_ERROR_CODES.CLI_FAILED,
      result.exitCode === null ? `신호 ${result.signal ?? '?'}` : `종료 코드 ${result.exitCode}`,
    );
  }
  if (result.outputTruncated && options.usesStdout !== false) {
    throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, '출력이 너무 길어 잘림');
  }
}

/** stdout의 JSON 봉투 하나. 앞뒤에 다른 줄이 있으면 마지막 JSON 객체 줄을 쓴다 */
export function parseJsonEnvelope(stdout: string): Record<string, unknown> {
  const text = stdout.trim();
  const tryParse = (s: string): Record<string, unknown> | null => {
    try {
      const v: unknown = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  };
  const whole = tryParse(text);
  if (whole) return whole;
  const lines = text.split('\n').reverse();
  for (const line of lines) {
    const v = tryParse(line.trim());
    if (v) return v;
  }
  throw new AiOutputInvalidError(AI_RUN_ERROR_CODES.OUTPUT_INVALID, 'JSON 결과가 아님');
}

/** 모델 값이 비었으면 spawn하지 않는다(규칙 2) */
export function assertModel(engine: AiEngineCode, model: string): void {
  if (typeof model !== 'string' || model.trim() === '') {
    throw new AiEngineUnavailableError(engine, 'MODEL_NOT_SET');
  }
}

/** 실행 파일이 없음(ENOENT) → 규칙 12 NOT_INSTALLED. 그 밖은 그대로 */
export function mapSpawnError(engine: AiEngineCode, error: unknown): unknown {
  if (error instanceof CliSpawnError && error.reason === 'NOT_FOUND') {
    return new AiEngineUnavailableError(engine, 'NOT_INSTALLED');
  }
  return error;
}

/** 어댑터가 쓸 결과 스키마와 images_seen 기대값 */
export function effectiveSchemaOf(
  schema: AiJsonSchema,
  imageNames: readonly string[],
): { schema: AiJsonSchema; expectedImages: readonly string[] | undefined } {
  return imageNames.length > 0
    ? { schema: withImagesSeen(schema), expectedImages: imageNames }
    : { schema, expectedImages: undefined };
}

/** 봉투에서 꺼낸 결과를 다시 검증한다(규칙 8·9) */
export function revalidate(
  schema: AiJsonSchema,
  raw: unknown,
  expectedImages: readonly string[] | undefined,
): Record<string, unknown> {
  return validateAiOutput(schema, raw, { expectedImages });
}

/** 비전 프롬프트 뒤에 붙이는 이미지 안내(파일 이름만, 폴더 경로는 CLI 인자로 연다). claude·codex */
export function visionPromptSuffix(imageNames: readonly string[], where: string): string {
  return [
    '',
    `[이미지] ${where}의 이미지 ${imageNames.length}장을 모두 확인하라. 확인한 파일 이름을 images_seen 배열에 그대로 적어라.`,
    ...imageNames.map((n) => `- ${n}`),
  ].join('\n');
}

/**
 * agy 비전 이미지 안내(M0 S6 §6.5·S7 §4.7). 폴더 경로만 주면 agy가 폴더를 보려고 터미널 명령을 쓰다가 headless에서 자동 거부돼
 * 빈 결과로 끝났다(S6 0/2, S7 7/10 실패). 파일 절대 경로를 하나씩 주고 파일 보기 도구만 쓰게 하면 성공했다(S6 2/2, S7 5/6).
 * 남은 실패는 URL 읽기 거부 1건이라 그것도 금지 목록에 넣는다. images_seen은 절대 경로로 와도 검증기가 마지막 조각만 본다.
 */
export function agyVisionPromptSuffix(imagePaths: readonly string[]): string {
  return [
    '',
    `[이미지] 아래 이미지 ${imagePaths.length}장을 파일 보기 도구(view_file)로 하나씩 직접 열어 확인하라. ` +
      '터미널 명령(ls·file·cat 등)·폴더 목록·URL 읽기 도구는 쓰지 않는다 — 이 환경에서는 허용되지 않는다. ' +
      '확인한 파일 이름을 images_seen 배열에 그대로 적어라.',
    ...imagePaths.map((p) => `- ${p}`),
  ].join('\n');
}

/** 결과 봉투의 거부 목록 길이(claude `permission_denials`, agy `denied_actions`). 배열이 아니면 0 */
export function deniedCountOf(envelope: Record<string, unknown>, key: string): number {
  const v = envelope[key];
  return Array.isArray(v) ? v.length : 0;
}

/**
 * 도구 권한 거부로 끝난 호출(M0 S6 §5 발견 2·§6.6). claude는 읽기가 모두 거부돼도 images_seen에 프롬프트의 파일 이름을 적어
 * 이름 검사를 통과했고, agy는 거부돼도 `status: SUCCESS`·exit 0이다. 비전이면 AI_IMAGES_NOT_SEEN, 아니면 AI_CLI_FAILED.
 */
export function toolDeniedError(
  engine: AiEngineCode,
  vision: boolean,
  count: number | null,
): AiOutputInvalidError | AiCallFailedError {
  const detail = count && count > 0 ? `도구 권한 거부 ${count}건` : '도구 권한 거부';
  return vision
    ? new AiOutputInvalidError(AI_RUN_ERROR_CODES.IMAGES_NOT_SEEN, detail)
    : new AiCallFailedError(engine, AI_RUN_ERROR_CODES.CLI_FAILED, detail);
}

/**
 * 계약·연결 테스트(R7, AI-07): 'OK' 한 단어를 스키마로 받는 호출 1회. 던지지 않고 결과로 돌려준다.
 * errorCode는 ai_cli_check.error_code 값(NOT_INSTALLED·NOT_LOGGED_IN·MODEL_NOT_SET·CONTRACT_FAILED)이다.
 */
export async function runSmokeTest(
  adapter: Pick<AiEngineAdapter, 'code' | 'runStructured'>,
  model: string,
): Promise<AiEngineSmokeResult> {
  const started = performance.now();
  const elapsed = () => Math.max(0, Math.round(performance.now() - started));
  try {
    const result = await adapter.runStructured<{ answer: string }>(
      AI_SMOKE_TASK,
      AI_SMOKE_SCHEMA,
      { prompt: AI_SMOKE_PROMPT },
      { model, timeoutMs: AI_TEXT_TIMEOUT_MS },
    );
    if (result.output.answer !== 'OK') {
      return smokeFailed(model, elapsed(), 'CONTRACT_FAILED', "답이 'OK'가 아닙니다.");
    }
    return {
      status: 'PASSED',
      model,
      latencyMs: result.latencyMs,
      errorCode: null,
      errorMessage: null,
    };
  } catch (error) {
    if (error instanceof AiEngineUnavailableError) {
      return smokeFailed(model, elapsed(), error.reason, error.userMessage);
    }
    if (error instanceof AiExecutionError) {
      return smokeFailed(model, elapsed(), 'CONTRACT_FAILED', error.userMessage);
    }
    return smokeFailed(model, elapsed(), 'CONTRACT_FAILED', '연결 테스트 중 앱 오류가 났습니다.');
  }
}

function smokeFailed(
  model: string,
  latencyMs: number,
  errorCode: string,
  errorMessage: string,
): AiEngineSmokeResult {
  return { status: 'FAILED', model, latencyMs, errorCode, errorMessage };
}
