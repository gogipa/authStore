import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import sharp from 'sharp';
import { scrubKnownSecrets } from '../../../common/secrets/secret-mask.js';
import { buildAgyArgs, parseAgyResult } from '../ai-engine/adapters/agy.adapter.js';
import {
  detectCli,
  mapSpawnError,
  parseJsonEnvelope,
} from '../ai-engine/adapters/cli-adapter-support.js';
import { AI_ENGINE_BINARY } from '../ai-engine/ai-engine.constants.js';
import {
  AI_RUN_ERROR_CODES,
  AiCallFailedError,
  AiEngineUnavailableError,
  AiOutputInvalidError,
} from '../ai-engine/ai-engine.errors.js';
import type { AiJsonSchema } from '../ai-engine/ai-engine.port.js';
import type { IsolatedCliRunner } from '../ai-engine/process/isolated-cli-runner.js';
import { withAiWorkspace, type AiWorkspace } from '../ai-engine/process/work-dir.js';
import type { CallLogService } from '../http/call-log.service.js';
import type { Clock } from '../http/clock.token.js';
import { AGY_ALLOWED_MODEL } from '../../settings/ai-engine/ai-engine-options.js';
import {
  IMAGE_GEN_CALL_TARGET,
  ImageGenError,
  type ImageGenIdentity,
  type ImageGenProvider,
  type ImageGenRequest,
  type ImageGenResult,
} from './image-gen.port.js';

/**
 * agy `generate_image` 썸네일 공급자(M0 S1 2026-10-02 실측 — docs/dev/07_M0스파이크/S1_썸네일생성.md, D-19).
 * 텍스트·비전 어댑터(`AgyAdapter`)와 섞지 않지만 실행기·인자 빌더·결과 해석·작업 폴더는 그대로 쓴다(P1-10).
 *
 * 한 번 생성:
 * 0. 기록 모델(`generation_run.model` → `--model`)이 Google 모델(`gemini-*`, R12 `AGY_ALLOWED_MODEL`)인지 본다 — 아니면
 *    spawn·call_log 없이 `ImageGenError(AI_ENGINE_UNAVAILABLE)`. 비어 있으면 기본 에이전트 모델
 * 1. 버전을 모르면 `agy --version` 감지(비용 없음) — 없으면 `ImageGenError(AI_ENGINE_UNAVAILABLE)`, 버전은 `identify`에 쓴다.
 *    앱 시작 때도 한 번 읽는다(`detectOnStartup` — 환경변수 AI_ENGINE_STARTUP_CHECK, `RoutingImageGenProvider`가 시작 훅을
 *    넘겨준다). 앱이 띄우는 agy는 자동 업데이트를 끈다
 * 2. `call_log` 1행(AI_AGY_CLI, 보내기 직전)
 * 3. 작업 폴더(빈 cwd) + 이미지 전용 폴더에 레퍼런스 **복사본**(`image-1.jpg` …). `generate_image`는 작업 폴더 경계를 보지 않아
 *    (S1 e05·e08) 앱이 만든 복사본의 절대 경로만 프롬프트에 넣는다
 * 4. 최소 권한 호출(S1): `-p <감싸는 지시문 + 썸네일 프롬프트> --model <에이전트 모델> --output-format json --json-schema
 *    {image_path, error} --print-timeout <하드 - 여유> --add-dir <이미지 폴더> --disable-slash-commands`. 권한 플래그 없음
 *    (`--dangerously-skip-permissions`·`--mode` 없이 기본 request-review에서 동작). env는 허용 목록 + `AGY_CLI_DISABLE_AUTO_UPDATE=true`
 * 5. 결과 해석: `parseAgyResult`(AGY_ERROR·print timeout·exit·status·도구 권한 거부 — agy는 실패를 SUCCESS·exit 0으로 감춘다) →
 *    `structured_output.error`(`classifyAgyImageError` — 거부면 REFUSED, 그 밖은 실패) → `image_path`를 `~/.gemini/antigravity-cli/brain/<conversation_id>/`
 *    바로 아래인지 realpath로 확인(아니면 그 폴더 맨 위 이미지가 정확히 1개일 때 그것) → 바이트를 읽는다
 * 6. 크기·형식은 바꾸지 않는다. agy는 늘 1024×1024 JPEG를 낸다(요청 2048은 지켜지지 않음, S1 12/12). 형식 판별은 생성 작업
 *    (`detectGeneratedImage`), 1000×1000 JPEG 정규화는 ⑧ 업로드(P4-01 `normalizeUploadImage`)가 한다
 * 작업 폴더는 성공·실패 모두 지운다. agy가 오너 홈에 남기는 대화 기록(brain·conversations, 이미지 호출당 약 1.2~2.2MB)은 지우지 않는다
 * (오너 결정 대기 — S1 §7). 프롬프트·경로는 로그·call_log에 남기지 않는다.
 * 학습·텔레메트리를 호출 단위로 끄는 스위치는 S1에서 찾지 못했다 → 오너가 Antigravity 설정 › 계정 › 'Enable Telemetry'를 끈다(D-20).
 */

/** generate_image를 부르는 에이전트 모델(`--model`, S1·S7에서 쓴 agy 텍스트 기본값). 이미지 모델 자체는 고를 수 없다 */
export const AGY_IMAGE_AGENT_MODEL = 'gemini-3.8-flash-medium';
/** generate_image `ImageName`(결과 파일 이름 `thumbnail_<13자리 시각>.jpg`) */
export const AGY_IMAGE_NAME = 'thumbnail';
/**
 * `--print-timeout`을 하드 타임아웃보다 이만큼 짧게 준다(S1 추천: 하드 - 20초). agy가 스스로 먼저 끝나고 stderr에
 * 'print timeout after'를 남기게 한다. 하드 타임아웃이 짧으면(테스트) 절반만 뺀다
 */
export const AGY_IMAGE_PRINT_TIMEOUT_MARGIN_MS = 20_000;
/** 읽을 결과 파일 상한(바이트, Proposed). S1 결과는 447~924KB였다 */
export const AGY_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

/** 결과 스키마(S1 실측 그대로 — 스키마를 쓴 성공 11/11에서 `image_path`가 정확했다) */
export const AGY_IMAGE_RESULT_SCHEMA: AiJsonSchema = {
  type: 'object',
  properties: {
    image_path: { type: 'string' },
    error: { type: ['string', 'null'] },
  },
  required: ['image_path', 'error'],
  additionalProperties: false,
};

/** agy 대화 폴더 뿌리(호출마다 `<뿌리>/<conversation_id>/`에 결과 이미지와 대화 기록이 생긴다, S1) */
export function defaultAgyBrainRoot(home: string = homedir()): string {
  return join(home, '.gemini', 'antigravity-cli', 'brain');
}

/**
 * 감싸는 지시문(S1 실측 문구 그대로 — 이 지시문을 쓴 12회 모두 모델이 Prompt를 글자 그대로 넘겼다). `referencePaths`는 앱이 만든 복사본의
 * 절대 경로만 넣는다. `prompt`는 차단어 검사를 통과한 썸네일 프롬프트 전문이다
 */
export function buildAgyImagePrompt(prompt: string, referencePaths: readonly string[]): string {
  const paths = referencePaths.map((p) => JSON.stringify(p)).join(', ');
  return [
    'You are running one image-generation step for a script. Follow these rules exactly.',
    '1. Call the generate_image tool exactly once with:',
    `   - ImagePaths: [${paths}] (reference photo of the product; the shoe in it is the product to reproduce)`,
    '   - Prompt: the text inside <thumbnail_prompt> below, copied verbatim (do not shorten, translate or rewrite it)',
    `   - ImageName: "${AGY_IMAGE_NAME}"`,
    '2. Do not call any other tool: no shell commands, no directory listing, no file viewing, no browser, no MCP tools.',
    '3. When the tool returns, put the absolute path of the generated image file in image_path and set error to null.',
    '   If the tool refused or failed, set image_path to "" and copy the tool\'s message into error.',
    '',
    '<thumbnail_prompt>',
    prompt,
    '</thumbnail_prompt>',
  ].join('\n');
}

/** `--print-timeout`에 줄 시간(ms): 하드 - min(20초, 하드/2). 0 이하 금지 */
export function agyImagePrintTimeoutMs(hardTimeoutMs: number): number {
  if (!Number.isFinite(hardTimeoutMs) || hardTimeoutMs <= 0) {
    throw new Error('이미지 생성 하드 타임아웃은 0보다 커야 한다(무제한 금지)');
  }
  const margin = Math.min(AGY_IMAGE_PRINT_TIMEOUT_MARGIN_MS, hardTimeoutMs / 2);
  return Math.max(1, Math.floor(hardTimeoutMs - margin));
}

/** 레퍼런스를 읽지 못한 도구 오류(S1 e09 실측: `failed to read image file: <path>: open <path>: no such file or directory`) */
export const AGY_IMAGE_READ_FAILED_PATTERN = /failed to read image file/i;
/**
 * 콘텐츠 필터 종료 사유 이름(S1: 실제 거부는 관찰 못 함 — 바이너리에서 찾은 이름). 대문자 이름 그대로만 본다(대소문자 구분)
 */
export const AGY_IMAGE_FINISH_REASON_PATTERN =
  /\b(?:IMAGE_SAFETY|IMAGE_PROHIBITED_CONTENT|IMAGE_RECITATION|IMAGE_OTHER|NO_IMAGE|SAFETY|PROHIBITED_CONTENT|BLOCKLIST|SPII)\b/;
/**
 * 거부가 아니라 도구·시스템 오류임을 알리는 낱말(파일·권한·네트워크·쿼터). 거부 문구(`AGY_IMAGE_REFUSAL_PATTERN`)보다 먼저 본다
 */
export const AGY_IMAGE_TOOL_FAILURE_PATTERN =
  /no such file|permission denied|\b(?:EACCES|ENOENT|EPERM|RESOURCE_EXHAUSTED)\b|context canceled|deadline exceeded|connection (?:refused|reset)|rate.?limit|quota/i;
/**
 * 거부를 직접 말하는 문구(추정): refused·refusal·declined, safety·content filter/policy, '… violates … policy',
 * 'blocked by (safety·content) policy'. 'policy'·'blocked' 낱말 하나만으로는 거부로 보지 않는다. 첫 실제 거부 때 고친다
 */
export const AGY_IMAGE_REFUSAL_PATTERN =
  /\b(?:refused|refuses|refusal|declined)\b|\b(?:safety|content) (?:filters?|polic(?:y|ies)|guidelines?|system)\b|\bviolat(?:es|ed|ing|ion of)\b.{0,40}\b(?:polic(?:y|ies)|guidelines?)\b|\bblocked (?:by|due to) (?:the |our )?(?:(?:safety|content) )?polic(?:y|ies)\b/i;

/** `structured_output.error` 분류 결과 */
export type AgyImageErrorKind = 'REFERENCE_UNREADABLE' | 'REFUSED' | 'TOOL_ERROR';

/**
 * `structured_output.error` 분류(S1 §4.4). 순서: (1) 레퍼런스 읽기 실패(e09 실측) → (2) 종료 사유 이름 → 거부 →
 * (3) 도구·시스템 오류 낱말 → 도구 오류 → (4) 거부 문구 → 거부 → (5) 그 밖은 도구 오류.
 * 도구 오류 문구에 'policy'·'blocked' 같은 낱말이 섞여도 거부(REFUSED)로 잘못 보지 않게 넓은 낱말 하나로는 판정하지 않는다
 */
export function classifyAgyImageError(text: string): AgyImageErrorKind {
  if (AGY_IMAGE_READ_FAILED_PATTERN.test(text)) return 'REFERENCE_UNREADABLE';
  if (AGY_IMAGE_FINISH_REASON_PATTERN.test(text)) return 'REFUSED';
  if (AGY_IMAGE_TOOL_FAILURE_PATTERN.test(text)) return 'TOOL_ERROR';
  if (AGY_IMAGE_REFUSAL_PATTERN.test(text)) return 'REFUSED';
  return 'TOOL_ERROR';
}

const LOCAL_PATH_PATTERN =
  /(?:~|\/(?:Users|home|private|var|tmp|Volumes|opt|root|mnt))(?:\/[^\s:'",)\]]+)+/g;
const MESSAGE_MAX = 300;

/** 공급자 글에서 로컬 경로·알려진 비밀을 지우고 줄인다(화면·DB에 남는 글) */
export function scrubAgyMessage(text: string): string {
  const cleaned = scrubKnownSecrets(text)
    .replace(LOCAL_PATH_PATTERN, '<경로>')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > MESSAGE_MAX ? `${cleaned.slice(0, MESSAGE_MAX)}…` : cleaned;
}

const LABEL = 'Antigravity CLI(agy)';

/** 이미지 생성 실패 문구(한국어, 비밀·로컬 경로 없음 — `generation_run.error_message`) */
export const AGY_IMAGE_MESSAGES = {
  notInstalled: `${LABEL}를 찾지 못해 이미지를 만들 수 없습니다. agy를 설치하고 로그인한 뒤 다시 만들어 주세요.`,
  notLoggedIn: `${LABEL} 로그인이 풀려 이미지를 만들 수 없습니다. 터미널에서 agy에 다시 로그인한 뒤 다시 만들어 주세요.`,
  timeout: (seconds: number) =>
    `${LABEL} 이미지 생성이 시간 제한(${seconds}초) 안에 끝나지 않아 멈췄습니다. 다시 만들어 주세요.`,
  agyError: `${LABEL}가 오류(AGY_ERROR)를 알렸습니다. 쿼터·한도를 넘었을 수 있습니다. 잠시 뒤 다시 만들어 주세요.`,
  cliFailed: (detail: string) =>
    `${LABEL} 이미지 생성이 오류로 끝났습니다(${detail}). 다시 만들어 주세요.`,
  noImage: `${LABEL}가 생성한 이미지 파일을 찾지 못했습니다(빈 결과). 다시 만들어 주세요.`,
  referenceUnreadable: (detail: string) =>
    `${LABEL}가 레퍼런스 이미지를 읽지 못했습니다(${detail}). 다시 만들어 주세요.`,
  toolError: (detail: string) =>
    `${LABEL} 이미지 생성 도구가 오류로 끝났습니다(${detail}). 다시 만들어 주세요.`,
  refused: (detail: string) => `이미지 모델이 생성을 거부했습니다: ${detail}`,
  modelNotAllowed: (model: string) =>
    `${LABEL} 이미지 생성에 쓸 수 없는 모델(${model})입니다. Google 모델(gemini-*)만 씁니다. 다시 만들어 주세요.`,
} as const;

/** 거부 결과의 call_log 오류 코드(Proposed — `ImageGenError` 기본 코드 `IMAGE_GEN_FAILED`와 짝) */
export const IMAGE_GEN_REFUSED_CODE = 'IMAGE_GEN_REFUSED';

export interface AgyImageGenProviderOptions {
  /** agy 대화 폴더 뿌리(테스트는 임시 폴더). 기본 `~/.gemini/antigravity-cli/brain` */
  brainRoot?: string;
  /** 에이전트 모델(기본 `AGY_IMAGE_AGENT_MODEL`) */
  model?: string;
  /** 앱 시작 때 `agy --version`을 미리 읽는다(비용 없음, 기다리지 않음). 기본 false */
  detectOnStartup?: boolean;
}

type CallLogWriter = Pick<CallLogService, 'start' | 'finish'>;

/** `structured_output` 모양 */
interface AgyImageOutput {
  imagePath: string;
  error: string | null;
}

export class AgyImageGenProvider implements ImageGenProvider, OnApplicationBootstrap {
  private readonly logger = new Logger(AgyImageGenProvider.name);
  private readonly brainRoot: string;
  private readonly model: string;
  private readonly detectOnStartup: boolean;
  private version: string | null = null;

  constructor(
    private readonly runner: IsolatedCliRunner,
    private readonly callLog: CallLogWriter,
    private readonly clock: Clock,
    options: AgyImageGenProviderOptions = {},
  ) {
    this.brainRoot = options.brainRoot ?? defaultAgyBrainRoot();
    this.model = options.model ?? AGY_IMAGE_AGENT_MODEL;
    this.detectOnStartup = options.detectOnStartup ?? false;
  }

  onApplicationBootstrap(): void {
    if (!this.detectOnStartup) return;
    void this.detectVersion().catch((error: unknown) => {
      this.logger.warn({ err: error }, 'agy 버전을 읽지 못했습니다(이미지 생성 공급자)');
    });
  }

  /** 마지막으로 읽은 agy 버전(모르면 null) */
  get cliVersion(): string | null {
    return this.version;
  }

  identify(): ImageGenIdentity {
    return { provider: 'AGY', model: this.model, providerVersion: this.version };
  }

  async generate(request: ImageGenRequest): Promise<ImageGenResult> {
    request.signal.throwIfAborted();
    const model = this.modelOf(request);
    // 버전을 모를 때만 감지한다(agy 시작에 몇 초 걸린다 — S1 감지 호출 4~6초). 그 사이 지워졌으면 spawn이 NOT_FOUND로 알린다
    const installed = this.version !== null || (await this.detectVersion());
    if (!installed) {
      throw new ImageGenError(
        AGY_IMAGE_MESSAGES.notInstalled,
        AI_RUN_ERROR_CODES.ENGINE_UNAVAILABLE,
      );
    }
    request.signal.throwIfAborted();
    const log = await this.callLog.start({
      target: IMAGE_GEN_CALL_TARGET.AGY,
      calledAt: this.clock.now(),
      candidateId: request.candidateId ?? null,
      stepRunId: request.stepRunId ?? null,
    });
    const started = performance.now();
    try {
      const result = await withAiWorkspace({ images: request.referenceImagePaths }, (ws) =>
        this.runOnce(ws, request, model),
      );
      await this.finishLog(log.id, started, {
        succeeded: result.kind === 'IMAGE',
        errorCode: result.kind === 'REFUSED' ? IMAGE_GEN_REFUSED_CODE : null,
        errorMessage: result.kind === 'REFUSED' ? result.reason : null,
      });
      return result;
    } catch (error) {
      await this.finishLog(log.id, started, {
        succeeded: false,
        errorCode:
          error instanceof ImageGenError
            ? error.code
            : request.signal.aborted
              ? 'ABORTED'
              : 'INTERNAL_ERROR',
        errorMessage: error instanceof ImageGenError ? error.userMessage : null,
      });
      throw error;
    }
  }

  /**
   * `--model`에 넣을 에이전트 모델: 시도 행의 기록 모델(비면 기본값). Google 모델(`gemini-*`)만 — 텍스트·비전 설정과 같은 규칙
   * (R12 `AGY_ALLOWED_MODEL`). 제3자 모델은 그 모델 약관을 따르므로 부르지 않는다(spawn·call_log 없음)
   */
  private modelOf(request: ImageGenRequest): string {
    const model = request.identity.model.trim() || this.model;
    if (!AGY_ALLOWED_MODEL.test(model)) {
      throw new ImageGenError(
        AGY_IMAGE_MESSAGES.modelNotAllowed(scrubAgyMessage(model).slice(0, 60)),
        AI_RUN_ERROR_CODES.ENGINE_UNAVAILABLE,
      );
    }
    return model;
  }

  /** `agy --version`(비용 없음). 설치돼 있으면 true, 버전을 기억한다 */
  private async detectVersion(): Promise<boolean> {
    const detection = await detectCli(this.runner, 'AGY');
    if (detection.installed) this.version = detection.cliVersion;
    return detection.installed;
  }

  private async finishLog(
    id: number,
    started: number,
    result: { succeeded: boolean; errorCode: string | null; errorMessage: string | null },
  ): Promise<void> {
    await this.callLog
      .finish(id, { ...result, durationMs: performance.now() - started })
      .catch((e: unknown) =>
        this.logger.error({ err: e }, '이미지 생성 호출 기록을 채우지 못했습니다'),
      );
  }

  private async runOnce(
    ws: AiWorkspace,
    request: ImageGenRequest,
    model: string,
  ): Promise<ImageGenResult> {
    const printTimeoutMs = agyImagePrintTimeoutMs(request.timeoutMs);
    const args = buildAgyArgs({
      prompt: buildAgyImagePrompt(request.prompt, ws.imagePaths),
      model,
      schema: AGY_IMAGE_RESULT_SCHEMA,
      timeoutMs: printTimeoutMs,
      imageDir: ws.imageDir,
    });
    const run = await this.runner
      .run({
        bin: AI_ENGINE_BINARY.AGY,
        args,
        cwd: ws.cwd,
        timeoutMs: printTimeoutMs,
        signal: request.signal,
      })
      .catch((error: unknown) => {
        throw toImageGenError(mapSpawnError('AGY', error));
      });
    let raw: unknown;
    try {
      raw = parseAgyResult(run, printTimeoutMs);
    } catch (error) {
      throw toImageGenError(error);
    }
    const output = readOutput(raw);
    if (output.error) {
      const detail = scrubAgyMessage(output.error);
      const kind = classifyAgyImageError(output.error);
      if (kind === 'REFUSED') {
        this.logger.warn(`agy 이미지 생성 거부: ${detail}`);
        return { kind: 'REFUSED', reason: AGY_IMAGE_MESSAGES.refused(detail) };
      }
      throw new ImageGenError(
        kind === 'REFERENCE_UNREADABLE'
          ? AGY_IMAGE_MESSAGES.referenceUnreadable(detail)
          : AGY_IMAGE_MESSAGES.toolError(detail),
        AI_RUN_ERROR_CODES.CLI_FAILED,
      );
    }
    const conversationId = conversationIdOf(run.stdout);
    const file = await this.locateImage(conversationId, output.imagePath);
    if (!file)
      throw new ImageGenError(AGY_IMAGE_MESSAGES.noImage, AI_RUN_ERROR_CODES.OUTPUT_INVALID);
    const bytes = await readFile(file);
    await this.logResult(bytes, request.sizePx, run.durationMs);
    return { kind: 'IMAGE', bytes, fileName: basename(file) };
  }

  /**
   * 결과 파일 찾기(S1 추천): (1) `image_path`의 realpath가 `<뿌리>/<conversation_id>/` 바로 아래 파일이면 그것,
   * (2) 아니면 그 폴더 맨 위의 이미지 파일(점으로 시작하지 않는 .jpg·.jpeg·.png·.webp)이 정확히 1개일 때 그것, (3) 아니면 null
   */
  private async locateImage(
    conversationId: string | null,
    imagePath: string,
  ): Promise<string | null> {
    if (!conversationId) return null;
    const brainDir = await realpath(join(this.brainRoot, conversationId)).catch(() => null);
    if (!brainDir) return null;
    if (imagePath !== '') {
      const real = await realpath(imagePath).catch(() => null);
      if (real && dirname(real) === brainDir && (await isReadableImageFile(real))) return real;
    }
    const entries = await readdir(brainDir, { withFileTypes: true }).catch(() => []);
    const images = entries.filter(
      (e) => e.isFile() && !e.name.startsWith('.') && /\.(?:jpe?g|png|webp)$/i.test(e.name),
    );
    if (images.length !== 1) return null;
    const only = join(brainDir, images[0]!.name);
    return (await isReadableImageFile(only)) ? only : null;
  }

  /** 요청 크기와 실제 크기를 앱 로그에 남긴다(경로·프롬프트 없음). agy는 늘 1024²다(S1) */
  private async logResult(bytes: Buffer, requestedPx: number, durationMs: number): Promise<void> {
    const meta = await sharp(bytes)
      .metadata()
      .catch(() => null);
    const size = meta?.width && meta.height ? `${meta.width}×${meta.height}` : '크기 모름';
    const mismatch =
      meta?.width && meta.height && (meta.width !== requestedPx || meta.height !== requestedPx)
        ? ' — 요청 크기와 다름(정규화는 ⑧ 업로드에서 1000×1000 JPEG)'
        : '';
    this.logger.log(
      `agy 이미지 생성 완료(${this.version ?? '버전 모름'}): 요청 ${requestedPx}px → ${size} ${meta?.format ?? ''}${mismatch}, ${Math.round(durationMs / 1000)}초`,
    );
  }
}

async function isReadableImageFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info !== null && info.isFile() && info.size > 0 && info.size <= AGY_IMAGE_MAX_BYTES;
}

/** 봉투의 conversation_id(폴더 이름으로 쓰므로 영숫자·하이픈만) */
function conversationIdOf(stdout: string): string | null {
  let id: unknown;
  try {
    id = parseJsonEnvelope(stdout).conversation_id;
  } catch {
    return null;
  }
  return typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/.test(id) ? id : null;
}

/** `structured_output` → {imagePath, error}. 모양이 다르면 빈 결과 */
function readOutput(raw: unknown): AgyImageOutput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ImageGenError(AGY_IMAGE_MESSAGES.noImage, AI_RUN_ERROR_CODES.OUTPUT_INVALID);
  }
  const record = raw as Record<string, unknown>;
  const imagePath = typeof record.image_path === 'string' ? record.image_path.trim() : '';
  const error =
    typeof record.error === 'string' && record.error.trim() !== '' ? record.error.trim() : null;
  if (!error && imagePath === '') {
    throw new ImageGenError(AGY_IMAGE_MESSAGES.noImage, AI_RUN_ERROR_CODES.OUTPUT_INVALID);
  }
  return { imagePath, error };
}

/** 실행기·결과 해석 오류 → `ImageGenError`(이미지 생성 문구). 그 밖(중단 신호·앱 오류)은 그대로 */
function toImageGenError(error: unknown): unknown {
  if (error instanceof AiEngineUnavailableError) {
    return new ImageGenError(
      error.reason === 'NOT_LOGGED_IN'
        ? AGY_IMAGE_MESSAGES.notLoggedIn
        : AGY_IMAGE_MESSAGES.notInstalled,
      AI_RUN_ERROR_CODES.ENGINE_UNAVAILABLE,
    );
  }
  if (error instanceof AiCallFailedError) {
    if (error.errorCode === AI_RUN_ERROR_CODES.TIMEOUT) {
      const seconds = Number.parseInt(error.detail, 10);
      return new ImageGenError(
        AGY_IMAGE_MESSAGES.timeout(Number.isFinite(seconds) ? seconds : 0),
        AI_RUN_ERROR_CODES.TIMEOUT,
      );
    }
    if (error.errorCode === AI_RUN_ERROR_CODES.AGY_ERROR) {
      return new ImageGenError(AGY_IMAGE_MESSAGES.agyError, AI_RUN_ERROR_CODES.AGY_ERROR);
    }
    return new ImageGenError(
      AGY_IMAGE_MESSAGES.cliFailed(scrubAgyMessage(error.detail)),
      AI_RUN_ERROR_CODES.CLI_FAILED,
    );
  }
  if (error instanceof AiOutputInvalidError) {
    return new ImageGenError(AGY_IMAGE_MESSAGES.noImage, AI_RUN_ERROR_CODES.OUTPUT_INVALID);
  }
  return error;
}
