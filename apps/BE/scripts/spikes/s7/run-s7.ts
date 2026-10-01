/**
 * M0 S7 엔진 동등성 스파이크 실행기(PRD §17 S7, §8.9 R15). 앱 코드가 아니다 — 앱 빌드(tsconfig.build: src만)·jest(src·test)·
 * typecheck(tsconfig.json: src·test)에 들지 않는다. 앱의 어댑터·실행기(AiExecutor)·프롬프트·스키마를 그대로 써서 이 PC의
 * claude·agy를 진짜로 부른다(사용자 구독 쿼터를 쓴다). codex는 미설치라 뺀다.
 *
 *   빌드:   pnpm exec tsc -p scripts/spikes/s7/tsconfig.json            (→ dist/spike-s7, dist는 git 제외)
 *   이미지: node dist/spike-s7/scripts/spikes/s7/run-s7.js render
 *   호출:   node dist/spike-s7/scripts/spikes/s7/run-s7.js run --out <폴더> [--tag main] [--engines claude,agy]
 *             [--tasks smoke,copy,fact_text,fact_vision,match] [--limit N] [--concurrency 2]
 *   채점:   node dist/spike-s7/scripts/spikes/s7/run-s7.js score --raw <a.jsonl>[,<b.jsonl>] [--md <파일>]
 *
 * 호출 결과 원본(JSONL: 구조화 출력·CLI 봉투 메타·stderr 앞부분)은 --out 폴더(저장소 밖)에, 짧은 요약은 results/summary.json에 둔다.
 * 비밀값은 넘기지 않는다 — 자식 환경변수는 앱 실행기의 허용 목록(env-allowlist)을 그대로 쓴다.
 */
import 'reflect-metadata';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import sharp from 'sharp';
import { BE_ROOT } from '../../../src/common/config/paths.js';
import { buildCopyPrompt, COPY_AI_TASK } from '../../../src/modules/content/copy/copy.prompt.js';
import { COPY_SCHEMA, type CopyDraft } from '../../../src/modules/content/copy/copy.schema.js';
import type { ItemAttribute } from '../../../src/modules/content/content-sources.js';
import {
  buildFactPrompt,
  factAiSchema,
  factAiTask,
  interpretAiExtras,
  interpretAiFacts,
  type AiExtraField,
} from '../../../src/modules/content/facts/extractors/ai-fact.extractor.js';
import { compareKey, parseHeight } from '../../../src/modules/content/facts/fact-text.js';
import { koreanMaterial, resolveOrigin } from '../../../src/modules/content/facts/fact-values.js';
import { FACT_NAMES, type FactName } from '../../../src/modules/content/facts/fact.schema.js';
import { AgyAdapter } from '../../../src/modules/integrations/ai-engine/adapters/agy.adapter.js';
import { ClaudeCodeAdapter } from '../../../src/modules/integrations/ai-engine/adapters/claude-code.adapter.js';
import { CodexAdapter } from '../../../src/modules/integrations/ai-engine/adapters/codex.adapter.js';
import { parseJsonEnvelope } from '../../../src/modules/integrations/ai-engine/adapters/cli-adapter-support.js';
import {
  AI_SMOKE_PROMPT,
  AI_SMOKE_SCHEMA,
  AI_SMOKE_TASK,
  AI_TEXT_TIMEOUT_MS,
} from '../../../src/modules/integrations/ai-engine/ai-engine.constants.js';
import { isAiExecutionError } from '../../../src/modules/integrations/ai-engine/ai-engine.errors.js';
import type { AiEngineAdapter } from '../../../src/modules/integrations/ai-engine/ai-engine.port.js';
import { AiExecutor } from '../../../src/modules/integrations/ai-engine/ai-executor.service.js';
import type {
  AiExecutionResult,
  PinnedAiContext,
} from '../../../src/modules/integrations/ai-engine/ai-executor.types.js';
import {
  IsolatedCliRunner,
  type CliRunRequest,
  type CliRunResult,
} from '../../../src/modules/integrations/ai-engine/process/isolated-cli-runner.js';
import type { CallLogService } from '../../../src/modules/integrations/http/call-log.service.js';
import { systemClock } from '../../../src/modules/integrations/http/clock.token.js';
import { AI_ENGINE_DEFAULT_MODELS } from '../../../src/modules/settings/ai-engine/ai-engine-options.js';
import type { ContentSettings } from '../../../src/modules/settings/schema/settings.types.js';
import {
  AiMatchService,
  type AiMatchProduct,
  type AiMatchResult,
} from '../../../src/modules/sourcing/ai-match.service.js';

// ───────────────────────── 샘플 모양 ─────────────────────────

const S7_DIR = join(BE_ROOT, 'scripts', 'spikes', 's7');
const SAMPLE_DIR = join(S7_DIR, 'samples');
const IMAGE_DIR = join(SAMPLE_DIR, 'images');
const RESULT_DIR = join(S7_DIR, 'results');

interface Attr {
  name: string;
  text: string;
}
/** 묶음 목록(모든 묶음이 값에 들어 있어야 맞다. 묶음 안은 같은 뜻의 다른 표기). null = 근거 없음이 정답 */
type Groups = string[][] | null;

interface CopySample {
  id: string;
  itemName: string;
  descriptionText: string | null;
  attributes: Attr[];
  forbidden: string[];
  traps: string[];
}

interface ImageSpec {
  file: string;
  title: string;
  columns?: string[];
  rows: string[][];
  note?: string;
}

interface FactTruth {
  origin: Groups;
  material_upper: Groups;
  material_lining: Groups;
  material_sole: Groups;
  heel_height: { value: number; unit: 'cm' | 'mm' } | null;
  color_ko: Groups;
}

interface FactSample {
  id: string;
  itemName: string;
  descriptionText: string | null;
  attributes: Attr[];
  selectedColorRaw: string | null;
  images?: ImageSpec[];
  truth: FactTruth;
  imageIndex?: Partial<Record<FactName, number>>;
  forbid: Partial<Record<string, string[]>>;
}

interface MatchSample {
  id: string;
  anchor: AiMatchProduct & { ownerEntered?: boolean };
  row: AiMatchProduct;
  truth: boolean;
  why: string;
}

function readSamples<T>(file: string): T[] {
  const raw = JSON.parse(readFileSync(join(SAMPLE_DIR, file), 'utf8')) as { samples: T[] };
  return raw.samples;
}

function toItemAttributes(attrs: readonly Attr[]): ItemAttribute[] {
  return attrs.map((a) => ({ name: a.name, value: a.text, text: a.text }));
}

// ───────────────────────── 이미지 그리기 ─────────────────────────

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const FONT = 'Hiragino Sans, Hiragino Kaku Gothic ProN, sans-serif';

/** 스펙표·사이즈표 한 장(SVG → JPEG). 라쿠텐 설명 속 스펙표 이미지를 흉내 낸다 */
function specSvg(spec: ImageSpec): string {
  const width = 900;
  const rowH = 56;
  const top = 80;
  const cols = spec.columns ?? null;
  const lines: string[] = [];
  const bodyRows = cols ? [cols, ...spec.rows] : spec.rows;
  const height = top + bodyRows.length * rowH + (spec.note ? 80 : 30);
  lines.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  lines.push(`<rect x="0" y="0" width="${width}" height="64" fill="#333333"/>`);
  lines.push(
    `<text x="30" y="44" font-family="${FONT}" font-size="30" font-weight="bold" fill="#ffffff">${xml(spec.title)}</text>`,
  );
  bodyRows.forEach((row, r) => {
    const y = top + r * rowH;
    const header = cols !== null && r === 0;
    if (!cols) {
      lines.push(
        `<rect x="20" y="${y}" width="250" height="${rowH}" fill="#eeeeee" stroke="#999999"/>`,
      );
      lines.push(
        `<rect x="270" y="${y}" width="610" height="${rowH}" fill="#ffffff" stroke="#999999"/>`,
      );
      lines.push(
        `<text x="36" y="${y + 37}" font-family="${FONT}" font-size="26" fill="#222222">${xml(row[0] ?? '')}</text>`,
      );
      lines.push(
        `<text x="290" y="${y + 37}" font-family="${FONT}" font-size="26" fill="#222222">${xml(row[1] ?? '')}</text>`,
      );
      return;
    }
    const cellW = 860 / cols.length;
    row.forEach((cell, c) => {
      const x = 20 + c * cellW;
      lines.push(
        `<rect x="${x}" y="${y}" width="${cellW}" height="${rowH}" fill="${header ? '#eeeeee' : '#ffffff'}" stroke="#999999"/>`,
      );
      lines.push(
        `<text x="${x + 16}" y="${y + 37}" font-family="${FONT}" font-size="26" fill="#222222">${xml(cell)}</text>`,
      );
    });
  });
  if (spec.note) {
    const y = top + bodyRows.length * rowH + 50;
    lines.push(
      `<text x="30" y="${y}" font-family="${FONT}" font-size="24" fill="#c00000">${xml(spec.note)}</text>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${lines.join('')}</svg>`;
}

async function render(): Promise<void> {
  mkdirSync(IMAGE_DIR, { recursive: true });
  for (const sample of readSamples<FactSample>('facts-vision.json')) {
    for (const spec of sample.images ?? []) {
      const target = join(IMAGE_DIR, spec.file);
      await sharp(Buffer.from(specSvg(spec)))
        .jpeg({ quality: 88 })
        .toFile(target);
      console.log(`그림 ${spec.file}`);
    }
  }
}

// ───────────────────────── 호출 기록 ─────────────────────────

/** codex는 이 PC에 없어 S7에서 재지 못했다 — 설치·로그인 뒤 `--engines codex --codex-text <모델> --codex-vision <모델>`로 같은 세트를 돈다 */
type EngineName = 'claude' | 'agy' | 'codex';
const TASKS = ['smoke', 'copy', 'fact_text', 'fact_vision', 'match'] as const;
type TaskName = (typeof TASKS)[number];

interface CliTrace {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  outputTruncated: boolean;
  durationMs: number;
  stdoutBytes: number;
  stderrHead: string;
  /** stdout JSON 봉투에서 structured_output을 뺀 나머지(긴 글은 자른다) */
  envelopeMeta: Record<string, unknown> | null;
  /** 봉투의 structured_output 그대로(앱 검증 전) */
  structuredOutput: unknown;
}

export interface CallRecord {
  tag: string;
  engine: EngineName;
  model: string;
  task: TaskName;
  sampleId: string;
  kind: 'TEXT' | 'VISION';
  startedAt: string;
  wallMs: number;
  /** 호출이 앱 검증까지 통과했다(스키마 통과) */
  ok: boolean;
  errorCode: string | null;
  errorName: string | null;
  errorDetail: string | null;
  /** CLI 프로세스 시간(어댑터 결과 latencyMs 또는 마지막 spawn durationMs) */
  latencyMs: number | null;
  output: unknown;
  imagesSeen: string[] | null;
  /** ⑥-2: 앱 해석(interpretAiFacts·interpretAiExtras)을 거친 값 */
  accepted: unknown;
  /** RK-03: AiMatchService.judge 결과 */
  judged: unknown;
  cli: CliTrace[];
}

const traceStore = new AsyncLocalStorage<CliTrace[]>();

function clip(value: unknown): unknown {
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map(clip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clip(v)]));
  }
  return value;
}

function traceOf(result: CliRunResult): CliTrace {
  let envelopeMeta: Record<string, unknown> | null = null;
  let structuredOutput: unknown = null;
  try {
    const envelope = parseJsonEnvelope(result.stdout);
    const { structured_output: so, ...rest } = envelope;
    structuredOutput = so ?? null;
    envelopeMeta = clip(rest) as Record<string, unknown>;
  } catch {
    envelopeMeta = { stdoutHead: result.stdout.slice(0, 400) };
  }
  return {
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    outputTruncated: result.outputTruncated,
    durationMs: result.durationMs,
    stdoutBytes: Buffer.byteLength(result.stdout),
    stderrHead: result.stderr.slice(0, 600),
    envelopeMeta,
    structuredOutput,
  };
}

/** 앱 실행기의 IsolatedCliRunner 그대로 + 호출 결과를 그 작업의 기록에 붙인다(spawn·격리 검사·환경변수는 손대지 않는다) */
class RecordingCliRunner extends IsolatedCliRunner {
  override async run(req: CliRunRequest): Promise<CliRunResult> {
    const result = await super.run(req);
    if ((req.mode ?? 'invoke') === 'invoke') traceStore.getStore()?.push(traceOf(result));
    return result;
  }
}

/** call_log를 DB 대신 메모리에 둔다(스파이크는 DB를 쓰지 않는다) */
function memoryCallLog(): CallLogService {
  let id = 0;
  return {
    start: () => Promise.resolve({ id: (id += 1) }),
    finish: () => Promise.resolve(true),
  } as unknown as CallLogService;
}

interface EngineSetup {
  name: EngineName;
  adapter: AiEngineAdapter;
  pinned: PinnedAiContext;
}

function errorInfo(error: unknown): { code: string; name: string; detail: string } {
  if (isAiExecutionError(error)) {
    const detail = (error as { detail?: unknown }).detail;
    const reason = (error as { reason?: unknown }).reason;
    return {
      code: error.errorCode,
      name: error.name,
      detail:
        typeof detail === 'string' ? detail : typeof reason === 'string' ? reason : error.message,
    };
  }
  const e = error as Error | null;
  return {
    code: 'INTERNAL_ERROR',
    name: e?.name ?? 'Error',
    detail: (e?.message ?? '').slice(0, 300),
  };
}

interface Job {
  task: TaskName;
  sampleId: string;
  kind: 'TEXT' | 'VISION';
  /** 호출 본체: 결과 일부를 rec에 채운다(throw하면 실패로 기록) */
  call: (rec: CallRecord) => Promise<void>;
}

interface JobOptions {
  limit: number;
  /** 이 샘플 id만(쉼표). 없으면 모두 */
  samples: readonly string[] | null;
  /** ⑥-2 지시문 끝에 덧붙이는 실험 문장(앱 프롬프트 개선안 시험용). 없으면 앱 프롬프트 그대로 */
  factExtraInstruction: string | null;
  /** ⑥-1 지시문 끝에 덧붙이는 실험 문장. 없으면 앱 프롬프트 그대로 */
  copyExtraInstruction: string | null;
}

function buildJobs(
  engine: EngineSetup,
  executor: AiExecutor,
  tasks: readonly TaskName[],
  options: JobOptions,
): Job[] {
  const { limit } = options;
  const perTask: Job[][] = [];
  const pinned = engine.pinned;
  if (tasks.includes('smoke')) {
    perTask.push(
      Array.from({ length: 10 }, (_, i) => ({
        task: 'smoke' as const,
        sampleId: `S${String(i + 1).padStart(2, '0')}`,
        kind: 'TEXT' as const,
        call: async (rec: CallRecord) => {
          // 앱의 연결 테스트(runSmokeTest)와 같은 호출 — 실행기를 거치지 않고 어댑터를 부른다
          const result = await engine.adapter.runStructured<{ answer: string }>(
            AI_SMOKE_TASK,
            AI_SMOKE_SCHEMA,
            { prompt: AI_SMOKE_PROMPT },
            { model: pinned.textModel ?? '', timeoutMs: AI_TEXT_TIMEOUT_MS },
          );
          rec.output = result.output;
          rec.latencyMs = result.latencyMs;
        },
      })),
    );
  }
  if (tasks.includes('copy')) {
    perTask.push(
      readSamples<CopySample>('copy.json').map((s) => ({
        task: 'copy' as const,
        sampleId: s.id,
        kind: 'TEXT' as const,
        call: async (rec: CallRecord) => {
          const base = buildCopyPrompt({
            itemName: s.itemName,
            descriptionText: s.descriptionText,
            attributes: toItemAttributes(s.attributes),
          });
          const input = options.copyExtraInstruction
            ? { ...base, instruction: `${base.instruction}\n${options.copyExtraInstruction}` }
            : base;
          const result = await executor.run<CopyDraft>(pinned, COPY_AI_TASK, COPY_SCHEMA, input);
          rec.output = result.output;
          rec.latencyMs = result.latencyMs;
        },
      })),
    );
  }
  const factJobs = (file: string, task: 'fact_text' | 'fact_vision'): Job[] =>
    readSamples<FactSample>(file).map((s) => {
      const images = (s.images ?? []).map((img) => join(IMAGE_DIR, img.file));
      return {
        task,
        sampleId: s.id,
        kind: images.length > 0 ? ('VISION' as const) : ('TEXT' as const),
        call: async (rec: CallRecord) => {
          const extraNames: AiExtraField[] = ['color_ko', 'caution'];
          const names = [...FACT_NAMES, ...extraNames];
          const attributes = toItemAttributes(s.attributes);
          const base = buildFactPrompt({
            names,
            itemName: s.itemName,
            descriptionText: s.descriptionText,
            attributes,
            imageCount: images.length,
            selectedColorRaw: s.selectedColorRaw,
          });
          const input = options.factExtraInstruction
            ? { ...base, instruction: `${base.instruction}\n${options.factExtraInstruction}` }
            : base;
          const result = await executor.run(
            pinned,
            factAiTask(images.length > 0),
            factAiSchema(names),
            images.length > 0 ? { ...input, imagePaths: images } : input,
          );
          rec.output = result.output;
          rec.imagesSeen = result.imagesSeen;
          rec.latencyMs = result.latencyMs;
          const knownText = [
            s.itemName,
            s.descriptionText ?? '',
            s.selectedColorRaw ?? '',
            ...attributes.map((a) => `${a.name}:${a.text}`),
          ].join('\n');
          let facts: unknown;
          try {
            facts = interpretAiFacts(result.output, {
              names: FACT_NAMES,
              imageCount: images.length,
              imagesSeen: result.imagesSeen,
              knownText,
            });
          } catch (error) {
            facts = { interpretError: errorInfo(error) };
          }
          const extras = interpretAiExtras(result.output, {
            names: extraNames,
            knownText,
            imageCount: images.length,
          });
          rec.accepted = { facts, extras };
        },
      };
    });
  if (tasks.includes('fact_text')) perTask.push(factJobs('facts-text.json', 'fact_text'));
  if (tasks.includes('fact_vision')) perTask.push(factJobs('facts-vision.json', 'fact_vision'));
  if (tasks.includes('match')) {
    perTask.push(
      readSamples<MatchSample>('match.json').map((s) => ({
        task: 'match' as const,
        sampleId: s.id,
        kind: 'TEXT' as const,
        call: async (rec: CallRecord) => {
          // 앱의 AiMatchService.judge 그대로(오류를 삼키고 null을 돌려준다) — 실행기 결과·오류는 감싸서 따로 받는다
          const sink: { result?: AiExecutionResult<unknown>; error?: Error } = {};
          const recording = {
            run: async (...args: Parameters<AiExecutor['run']>) => {
              try {
                const r = await executor.run(...args);
                sink.result = r;
                return r;
              } catch (error) {
                sink.error = error instanceof Error ? error : new Error(String(error));
                throw error;
              }
            },
          } as unknown as AiExecutor;
          const judged = await new AiMatchService(recording).judge(pinned, s.anchor, s.row);
          rec.judged = judged;
          if (sink.error !== undefined) throw sink.error;
          rec.output = sink.result?.output ?? null;
          rec.latencyMs = sink.result?.latencyMs ?? null;
        },
      })),
    );
  }
  // 작업을 섞는다(샘플 1의 모든 작업 → 샘플 2 …): 중간에 멈춰도 작업마다 고르게 남는다
  const jobs: Job[] = [];
  const max = Math.max(0, ...perTask.map((l) => l.length));
  for (let i = 0; i < Math.min(max, limit); i += 1) {
    for (const list of perTask) {
      const job = list[i];
      if (job && (!options.samples || options.samples.includes(job.sampleId))) jobs.push(job);
    }
  }
  return jobs;
}

async function runPool(jobs: readonly (() => Promise<void>)[], size: number): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      if (job) await job();
    }
  };
  await Promise.all(Array.from({ length: size }, () => worker()));
}

interface Args {
  [key: string]: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith('--')) {
        out[a.slice(2)] = v;
        i += 1;
      } else {
        out[a.slice(2)] = 'true';
      }
    }
  }
  return out;
}

async function run(args: Args): Promise<void> {
  const out = args.out ?? join(tmpdir(), 'autostore-s7');
  const tag = args.tag ?? 'main';
  const engines = (args.engines ?? 'claude,agy').split(',') as EngineName[];
  const tasks = (args.tasks ?? TASKS.join(',')).split(',') as TaskName[];
  const limit = Number(args.limit ?? '10');
  const concurrency = Number(args.concurrency ?? '2');
  for (const t of tasks)
    if (!(TASKS as readonly string[]).includes(t)) throw new Error(`모르는 작업 ${t}`);
  for (const image of readSamples<FactSample>('facts-vision.json').flatMap((s) => s.images ?? [])) {
    if (!existsSync(join(IMAGE_DIR, image.file)))
      throw new Error(`이미지가 없다(render 먼저): ${image.file}`);
  }
  mkdirSync(out, { recursive: true });
  const rawFile = join(out, `raw-${tag}.jsonl`);
  const runner = new RecordingCliRunner();
  const adapters: Record<EngineName, AiEngineAdapter> = {
    claude: new ClaudeCodeAdapter(runner),
    agy: new AgyAdapter(runner),
    codex: new CodexAdapter(runner),
  };
  const executor = new AiExecutor(Object.values(adapters), memoryCallLog(), systemClock);
  const setups: EngineSetup[] = [];
  const meta: Record<string, unknown> = {
    tag,
    startedAt: new Date().toISOString(),
    tasks,
    limit,
    concurrency,
    samples: args.samples ?? null,
    factExtra: args['fact-extra'] ?? null,
    copyExtra: args['copy-extra'] ?? null,
  };
  for (const name of engines) {
    const adapter = adapters[name];
    const detection = await adapter.detect();
    if (!detection.installed) throw new Error(`${name}가 설치되어 있지 않다`);
    const code = adapter.code;
    const models = AI_ENGINE_DEFAULT_MODELS[code];
    const pinned: PinnedAiContext = {
      engine: code,
      textModel: args[`${name}-text`] ?? models.text,
      visionModel: args[`${name}-vision`] ?? models.vision,
      cliVersion: detection.cliVersion,
      settingsSnapshotId: 0,
      stepRunId: null,
      candidateId: null,
    };
    if (!pinned.textModel || !pinned.visionModel) {
      throw new Error(`${name} 모델이 정해지지 않았다(--${name}-text·--${name}-vision)`);
    }
    meta[name] = {
      cliVersion: detection.cliVersion,
      textModel: pinned.textModel,
      visionModel: pinned.visionModel,
    };
    setups.push({ name, adapter, pinned });
  }
  console.log(`S7 ${tag}: ${JSON.stringify(meta)}`);
  let done = 0;
  await Promise.all(
    setups.map((engine) => {
      const jobs = buildJobs(engine, executor, tasks, {
        limit,
        samples: args.samples ? args.samples.split(',') : null,
        factExtraInstruction: args['fact-extra'] ?? null,
        copyExtraInstruction: args['copy-extra'] ?? null,
      }).map((job) => async () => {
        const model =
          (job.kind === 'VISION' ? engine.pinned.visionModel : engine.pinned.textModel) ?? '';
        const rec: CallRecord = {
          tag,
          engine: engine.name,
          model,
          task: job.task,
          sampleId: job.sampleId,
          kind: job.kind,
          startedAt: new Date().toISOString(),
          wallMs: 0,
          ok: false,
          errorCode: null,
          errorName: null,
          errorDetail: null,
          latencyMs: null,
          output: null,
          imagesSeen: null,
          accepted: null,
          judged: null,
          cli: [],
        };
        const started = performance.now();
        await traceStore.run(rec.cli, async () => {
          try {
            await job.call(rec);
            rec.ok = true;
          } catch (error) {
            const info = errorInfo(error);
            rec.errorCode = info.code;
            rec.errorName = info.name;
            rec.errorDetail = info.detail;
          }
        });
        rec.wallMs = Math.round(performance.now() - started);
        rec.latencyMs ??= rec.cli.at(-1)?.durationMs ?? null;
        appendFileSync(rawFile, `${JSON.stringify(rec)}\n`);
        done += 1;
        console.log(
          `[${done}] ${engine.name} ${job.task} ${job.sampleId} ${rec.ok ? 'OK' : `FAIL ${rec.errorCode} ${rec.errorDetail ?? ''}`} ${rec.latencyMs ?? '-'}ms`,
        );
      });
      return runPool(jobs, concurrency);
    }),
  );
  meta.finishedAt = new Date().toISOString();
  writeFileSync(join(out, `meta-${tag}.json`), `${JSON.stringify(meta, null, 2)}\n`);
  console.log(`끝: ${rawFile}`);
}

// ───────────────────────── 채점 ─────────────────────────

/** 비교 키: NFKC·대문자·공백과 구분 기호 없음 */
function looseKey(value: string): string {
  return value
    .normalize('NFKC')
    .toUpperCase()
    .replace(/[\s.。・･、,，/／()（）「」:：\-_]/g, '');
}

interface FieldResult {
  value: string | null;
  evidence_quote: string | null;
  method: string;
  image_index: number | null;
}

function fieldOf(output: unknown, name: string): FieldResult | null {
  if (!output || typeof output !== 'object') return null;
  const r = (output as Record<string, unknown>)[name];
  return r && typeof r === 'object' ? (r as FieldResult) : null;
}

function valueOf(r: FieldResult | null): string | null {
  if (!r || r.method === 'NONE') return null;
  return typeof r.value === 'string' && r.value.trim() !== '' ? r.value.trim() : null;
}

/**
 * 정답 표기의 한국어 별칭(채점용). 프롬프트는 '원문 표기'를 요구하지만 엔진이 한국어로 옮겨 답하기도 한다 — 뜻이 맞으면 맞게 보고,
 * 원문 표기를 지켰는지는 따로 센다(`jaValue`). 앱 설정 사전(content.materialTerms)의 한국어 + 흔한 다른 표기
 */
const KO_ALIASES: Readonly<Record<string, readonly string[]>> = {
  合成繊維: ['합성섬유'],
  合成皮革: ['합성가죽', '합성피혁', '인조가죽'],
  合皮: ['합성가죽', '합성피혁'],
  天然皮革: ['천연가죽', '천연피혁'],
  本革: ['천연가죽', '천연피혁'],
  牛革: ['소가죽', '우피'],
  豚革: ['돼지가죽', '돈피'],
  レザー: ['가죽', '레더'],
  スムースレザー: ['스무스레더', '스무드레더', '스무스가죽', '스무드가죽'],
  スエード: ['스웨이드'],
  メッシュ: ['메쉬', '메시'],
  キャンバス: ['캔버스'],
  ゴム: ['고무'],
  合成ゴム: ['합성고무'],
  ラバー: ['러버', '고무'],
  ガムラバー: ['검고무', '검러버', '검솔'],
  合成底: ['합성밑창', '합성창', '합성솔', '합성바닥', '합성수지밑창'],
  綿: ['면'],
  コットン: ['코튼', '면'],
  テキスタイル: ['텍스타일', '섬유', '직물'],
  繊維: ['섬유'],
  エナメル: ['에나멜'],
  ビルコフロー: ['비르코플로', '버코플로', '비르코플로우'],
  AIRWAIR: ['에어웨어'],
};

function aliasesOf(alt: string): string[] {
  return [alt, ...(KO_ALIASES[alt] ?? [])];
}

function groupsCorrect(
  value: string | null,
  truth: Groups,
  forbid: readonly string[] = [],
): boolean {
  if (truth === null) return value === null;
  if (value === null) return false;
  const key = looseKey(value);
  if (forbid.some((f) => key.includes(looseKey(f)))) return false;
  return truth.every((group) =>
    group.some((alt) => aliasesOf(alt).some((a) => key.includes(looseKey(a)))),
  );
}

/** 값이 일본어 원문 표기(가나·한자)를 담았는가 — 한글만이면 엔진이 옮긴 것 */
function isJapaneseValue(value: string): boolean {
  return (
    /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u.test(value) &&
    !/\p{Script=Hangul}/u.test(value)
  );
}

function heelCorrect(value: string | null, truth: FactTruth['heel_height']): boolean {
  if (truth === null) return value === null;
  if (value === null) return false;
  const h = parseHeight(value);
  if (!h) return false;
  const mm = (v: { value: number; unit: 'cm' | 'mm' }) =>
    v.unit === 'cm' ? v.value * 10 : v.value;
  return Math.abs(mm(h) - mm(truth)) < 0.01;
}

function factCorrect(name: FactName, value: string | null, sample: FactSample): boolean {
  if (name === 'heel_height') return heelCorrect(value, sample.truth.heel_height);
  return groupsCorrect(value, sample.truth[name], sample.forbid[name] ?? []);
}

function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;
}

function ratio(a: number, b: number): number | null {
  return b === 0 ? null : Math.round((a / b) * 1000) / 1000;
}

/** 앱 설정 기본값의 content 사전(원산지 나라·소재 말) — ⑥-2가 AI 값을 한국어로 정리할 때 쓰는 것과 같다 */
const DEFAULT_CONTENT = (
  JSON.parse(
    readFileSync(
      join(BE_ROOT, 'src', 'modules', 'settings', 'defaults', 'settings.default.json'),
      'utf8',
    ),
  ) as { content: Pick<ContentSettings, 'originCountries' | 'materialTerms'> }
).content;

const COPY_GENERIC_FORBIDDEN = [
  '가격',
  '최저가',
  '할인',
  '특가',
  '쿠폰',
  '무료배송',
  '무료 배송',
  '배송',
  '공식',
  '정품',
  '직접 신어',
  '신어 보니',
  '신어보니',
  '착용 후기',
  '착용해 보니',
  '착용해보니',
  '일본산',
  '일본 제품',
  '일본제',
  '일본에서 만든',
  '메이드 인',
];
const COPY_MATERIAL_WORDS = [
  '합성피혁',
  '합성 피혁',
  '합성가죽',
  '합성 가죽',
  '인조가죽',
  '천연가죽',
  '천연 가죽',
  '소가죽',
  '돼지가죽',
  '스웨이드',
  '캔버스',
  '메시',
  '메쉬',
  '고무',
  '러버',
  '합성섬유',
  '합성 섬유',
  'PVC',
  '에나멜',
  '레더',
];

function copyText(c: CopyDraft): string {
  return [c.headline, ...c.selling_points, c.body, c.fit_and_styling, c.size_guide].join('\n');
}

function hits(text: string, words: readonly string[]): string[] {
  return words.filter((w) => text.includes(w));
}

function copyChecks(c: CopyDraft, s: CopySample) {
  const text = copyText(c);
  const hangul = (text.match(/\p{Script=Hangul}/gu) ?? []).length;
  const japanese = (text.match(/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/gu) ?? [])
    .length;
  const source = [
    s.itemName,
    s.descriptionText ?? '',
    ...s.attributes.map((a) => `${a.name}:${a.text}`),
  ].join('\n');
  const sourceKey = compareKey(source);
  const grounded = c.source_facts_used.filter((q) => sourceKey.includes(compareKey(q))).length;
  // 문장 수: 마침표·물음표·느낌표 뒤가 공백이거나 끝일 때만 끊는다(25.0cm 같은 소수점은 끊지 않는다)
  const sentences = c.body.split(/(?<=[.!?。])(?=\s|$)/).filter((x) => x.trim() !== '').length;
  // 스키마는 통과했지만 모양이 깨진 결과: 필드 값에 결과 JSON 전체를 넣었거나('{"headline": …') 자리 표시 글('placeholder')
  const values = [
    c.headline,
    ...c.selling_points,
    c.body,
    c.fit_and_styling,
    c.size_guide,
    ...c.source_facts_used,
  ];
  const jsonInField = values.some(
    (v) => /^\s*\{/.test(v) || /"(headline|selling_points|body)"\s*:/.test(v),
  );
  const placeholder = values.some((v) => /^\s*placeholder\s*$/i.test(v));
  return {
    structureBroken: jsonInField || placeholder,
    jsonInField,
    placeholder,
    headlineLength: [...c.headline].length,
    sellingPoints: c.selling_points.length,
    bodySentences: sentences,
    bodyRuleOk: sentences >= 2 && sentences <= 4,
    koreanRatio: ratio(hangul, hangul + japanese),
    genericForbidden: hits(text, COPY_GENERIC_FORBIDDEN),
    sampleForbidden: hits(text, s.forbidden),
    materialMentions: hits(text, COPY_MATERIAL_WORDS),
    sourceFacts: c.source_facts_used.length,
    sourceFactsGrounded: grounded,
  };
}

function loadRecords(files: readonly string[]): CallRecord[] {
  return files.flatMap((f) =>
    readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as CallRecord),
  );
}

function usageOf(rec: CallRecord): {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  costUsd: number;
} {
  const zero = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, costUsd: 0 };
  for (const t of rec.cli) {
    const m = t.envelopeMeta ?? {};
    const u = (m.usage ?? null) as Record<string, unknown> | null;
    const num = (v: unknown) => (typeof v === 'number' ? v : 0);
    if (u) {
      zero.input += num(u.input_tokens);
      zero.output += num(u.output_tokens);
      zero.cacheRead += num(u.cache_read_input_tokens);
      zero.cacheCreate += num(u.cache_creation_input_tokens);
    }
    zero.costUsd += num(m.total_cost_usd);
  }
  return zero;
}

function score(args: Args): void {
  const files = (args.raw ?? '').split(',').filter((f) => f !== '');
  if (files.length === 0) throw new Error('--raw <jsonl> 가 필요하다');
  const records = loadRecords(files);
  const factSamples = new Map(
    [
      ...readSamples<FactSample>('facts-text.json'),
      ...readSamples<FactSample>('facts-vision.json'),
    ].map((s) => [s.id, s]),
  );
  const copySamples = new Map(readSamples<CopySample>('copy.json').map((s) => [s.id, s]));
  const matchSamples = new Map(readSamples<MatchSample>('match.json').map((s) => [s.id, s]));
  const engines = [...new Set(records.map((r) => r.engine))];
  const LIMIT_MS = 120_000;

  const groups: Record<string, unknown>[] = [];
  const perEngine: Record<string, unknown> = {};
  const copyRows: Record<string, unknown>[] = [];
  const factRows: Record<string, unknown>[] = [];
  const matchRows: Record<string, unknown>[] = [];

  for (const engine of engines) {
    const mine = records.filter((r) => r.engine === engine);
    const lat = mine.map((r) => r.latencyMs ?? r.wallMs);
    const usage = mine.map(usageOf).reduce(
      (a, b) => ({
        input: a.input + b.input,
        output: a.output + b.output,
        cacheRead: a.cacheRead + b.cacheRead,
        cacheCreate: a.cacheCreate + b.cacheCreate,
        costUsd: a.costUsd + b.costUsd,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheCreate: 0, costUsd: 0 },
    );
    const pass = mine.filter((r) => r.ok).length;
    const over = lat.filter((l) => l > LIMIT_MS).length;
    const passRate = ratio(pass, mine.length);
    perEngine[engine] = {
      models: [...new Set(mine.map((r) => `${r.kind}:${r.model}`))],
      calls: mine.length,
      schemaPass: pass,
      schemaPassRate: passRate,
      latencyP50: percentile(lat, 0.5),
      latencyP95: percentile(lat, 0.95),
      latencyMax: lat.length ? Math.max(...lat) : null,
      over120s: over,
      usage: { ...usage, costUsd: Math.round(usage.costUsd * 10000) / 10000 },
      verdict: passRate !== null && passRate >= 0.95 && over === 0 ? '통과' : '실험적',
    };
    for (const task of TASKS) {
      const recs = mine.filter((r) => r.task === task);
      if (recs.length === 0) continue;
      const tl = recs.map((r) => r.latencyMs ?? r.wallMs);
      const errors: Record<string, number> = {};
      for (const r of recs.filter((x) => !x.ok)) {
        const k = `${r.errorCode ?? '?'}${r.errorDetail ? ` (${r.errorDetail})` : ''}`;
        errors[k] = (errors[k] ?? 0) + 1;
      }
      const g: Record<string, unknown> = {
        engine,
        task,
        model: recs[0]!.model,
        n: recs.length,
        schemaPass: recs.filter((r) => r.ok).length,
        schemaPassRate: ratio(recs.filter((r) => r.ok).length, recs.length),
        errors,
        latencyP50: percentile(tl, 0.5),
        latencyP95: percentile(tl, 0.95),
        latencyMax: Math.max(...tl),
        over120s: tl.filter((l) => l > LIMIT_MS).length,
      };
      if (task === 'smoke') {
        g.answerOk = recs.filter(
          (r) => (r.output as { answer?: string } | null)?.answer === 'OK',
        ).length;
      }
      if (task === 'fact_text' || task === 'fact_vision') {
        let rawCorrect = 0;
        let acceptedCorrect = 0;
        let total = 0;
        let okTotal = 0;
        let colorCorrect = 0;
        let colorAccepted = 0;
        let cautionPresent = 0;
        let imageIdxCorrect = 0;
        let imageIdxTotal = 0;
        let textValues = 0;
        let jaValues = 0;
        let originSettled = 0;
        let originFound = 0;
        const byField: Record<string, { raw: number; accepted: number; n: number }> = {};
        for (const r of recs) {
          const s = factSamples.get(r.sampleId);
          if (!s) continue;
          const accepted = (r.accepted ?? {}) as {
            facts?: Record<
              string,
              { raw?: string; height?: { value: number; unit: string } | null }
            >;
            extras?: Record<string, { value: string }>;
          };
          const row: Record<string, unknown> = { engine, task, sampleId: r.sampleId, ok: r.ok };
          for (const name of FACT_NAMES) {
            const f = (byField[name] ??= { raw: 0, accepted: 0, n: 0 });
            f.n += 1;
            total += 1;
            const field = fieldOf(r.output, name);
            const rawValue = r.ok ? valueOf(field) : null;
            const rawOk = r.ok && factCorrect(name, rawValue, s);
            const acc = accepted.facts?.[name];
            const accValue = !r.ok
              ? null
              : acc
                ? name === 'heel_height' && acc.height
                  ? `${acc.height.value}${acc.height.unit}`
                  : (acc.raw ?? null)
                : null;
            const accOk = r.ok && factCorrect(name, accValue, s);
            if (r.ok) okTotal += 1;
            if (rawOk) {
              rawCorrect += 1;
              f.raw += 1;
            }
            if (accOk) {
              acceptedCorrect += 1;
              f.accepted += 1;
            }
            const want = s.imageIndex?.[name];
            if (task === 'fact_vision' && want !== undefined && rawValue !== null) {
              imageIdxTotal += 1;
              if (field?.method === 'IMAGE' && field.image_index === want) imageIdxCorrect += 1;
            }
            if (rawValue !== null && name !== 'heel_height') {
              textValues += 1;
              if (isJapaneseValue(rawValue)) jaValues += 1;
            }
            // 앱이 저장할 값(설정 기본 사전으로 한국어 정리 — fact-values.ts). 원산지는 사전에 없는 나라가 있으면 입력 대기
            let appValue: unknown = null;
            if (accValue !== null && name === 'origin') {
              const resolved = resolveOrigin(accValue, DEFAULT_CONTENT.originCountries);
              appValue = resolved;
              originFound += 1;
              if (resolved.unresolved.length === 0) originSettled += 1;
            } else if (accValue !== null && name !== 'heel_height') {
              appValue = koreanMaterial(accValue, DEFAULT_CONTENT.materialTerms);
            }
            row[name] = {
              value: rawValue,
              ok: rawOk,
              accepted: accValue,
              acceptedOk: accOk,
              appValue,
              method: field?.method ?? null,
              image_index: field?.image_index ?? null,
            };
          }
          const color = r.ok ? valueOf(fieldOf(r.output, 'color_ko')) : null;
          const colorOk = r.ok && groupsCorrect(color, s.truth.color_ko);
          if (colorOk) colorCorrect += 1;
          const colorAcc = accepted.extras?.color_ko?.value ?? null;
          if (r.ok && groupsCorrect(colorAcc, s.truth.color_ko)) colorAccepted += 1;
          const caution = r.ok ? valueOf(fieldOf(r.output, 'caution')) : null;
          if (caution) cautionPresent += 1;
          row.color_ko = { value: color, ok: colorOk, accepted: colorAcc };
          row.caution = caution;
          row.imagesSeen = r.imagesSeen;
          factRows.push(row);
        }
        g.fieldAccuracyAll = ratio(rawCorrect, total);
        g.fieldAccuracyOk = ratio(rawCorrect, okTotal);
        g.fieldAccuracyAcceptedAll = ratio(acceptedCorrect, total);
        g.fieldCorrect = rawCorrect;
        g.fieldTotal = total;
        g.byField = byField;
        g.colorKoCorrect = colorCorrect;
        g.colorKoAccepted = colorAccepted;
        g.cautionPresent = cautionPresent;
        g.japaneseValues = { ja: jaValues, total: textValues };
        g.originSettledByDictionary = { settled: originSettled, found: originFound };
        if (task === 'fact_vision')
          g.imageIndex = { correct: imageIdxCorrect, total: imageIdxTotal };
      }
      if (task === 'match') {
        let tp = 0;
        let tn = 0;
        let fp = 0;
        let fn = 0;
        let none = 0;
        for (const r of recs) {
          const s = matchSamples.get(r.sampleId);
          if (!s) continue;
          const judged = (r.judged ?? null) as { result: AiMatchResult | null } | null;
          const res = judged?.result ?? null;
          if (!res) none += 1;
          else if (res.match && s.truth) tp += 1;
          else if (!res.match && !s.truth) tn += 1;
          else if (res.match && !s.truth) fp += 1;
          else fn += 1;
          matchRows.push({
            engine,
            sampleId: r.sampleId,
            truth: s.truth,
            match: res?.match ?? null,
            confidence: res?.confidence ?? null,
            reason: res?.reason ?? null,
          });
        }
        g.accuracyAll = ratio(tp + tn, recs.length);
        g.confusion = { tp, tn, fp, fn, noResult: none };
      }
      if (task === 'copy') {
        let violations = 0;
        let groundedSum = 0;
        let factSum = 0;
        let bodyRuleOk = 0;
        let broken = 0;
        for (const r of recs) {
          const s = copySamples.get(r.sampleId);
          if (!s || !r.ok) {
            copyRows.push({ engine, sampleId: r.sampleId, ok: false });
            continue;
          }
          const c = r.output as CopyDraft;
          const checks = copyChecks(c, s);
          if (checks.genericForbidden.length + checks.sampleForbidden.length > 0) violations += 1;
          groundedSum += checks.sourceFactsGrounded;
          factSum += checks.sourceFacts;
          if (checks.bodyRuleOk) bodyRuleOk += 1;
          if (checks.structureBroken) broken += 1;
          copyRows.push({ engine, sampleId: r.sampleId, ok: true, ...checks });
        }
        g.samplesWithForbidden = violations;
        g.sourceFactsGroundedRate = ratio(groundedSum, factSum);
        g.bodyRuleOk = bodyRuleOk;
        g.structureBroken = broken;
      }
      groups.push(g);
    }
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    sources: files.map((f) => basename(f)),
    criteria: { schemaPassRate: 0.95, maxLatencyMs: LIMIT_MS, factAccuracyS6: 0.9 },
    perEngine,
    perTask: groups,
    facts: factRows,
    match: matchRows,
    copy: copyRows,
  };
  mkdirSync(RESULT_DIR, { recursive: true });
  const summaryFile = join(RESULT_DIR, args.name ?? 'summary.json');
  writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`요약: ${summaryFile}`);

  if (args.md) {
    const lines: string[] = ['# S7 카피 나란히 보기', ''];
    const ids = (args.copyIds ?? 'C01,C04,C09').split(',');
    for (const id of ids) {
      lines.push(
        `## ${id}`,
        '',
        '| 항목 | ' + engines.join(' | ') + ' |',
        '|---|' + engines.map(() => '---').join('|') + '|',
      );
      const outs = engines.map(
        (e) =>
          records.find((r) => r.engine === e && r.task === 'copy' && r.sampleId === id && r.ok)
            ?.output as CopyDraft | undefined,
      );
      const cell = (v: string | undefined) =>
        (v ?? '(실패)').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| headline | ${outs.map((o) => cell(o?.headline)).join(' | ')} |`);
      lines.push(
        `| selling_points | ${outs.map((o) => cell(o?.selling_points.map((p) => `· ${p}`).join('<br>'))).join(' | ')} |`,
      );
      lines.push(`| body | ${outs.map((o) => cell(o?.body)).join(' | ')} |`);
      lines.push(`| fit_and_styling | ${outs.map((o) => cell(o?.fit_and_styling)).join(' | ')} |`);
      lines.push(`| size_guide | ${outs.map((o) => cell(o?.size_guide)).join(' | ')} |`);
      lines.push(
        `| source_facts_used | ${outs.map((o) => cell(o?.source_facts_used.join(' / '))).join(' | ')} |`,
        '',
      );
    }
    writeFileSync(args.md, `${lines.join('\n')}\n`);
    console.log(`카피 비교: ${args.md}`);
  }
}

// ───────────────────────── 시작 ─────────────────────────

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (mode === 'render') return render();
  if (mode === 'run') return run(args);
  if (mode === 'score') return score(args);
  console.error('사용법: run-s7.js render | run --out <폴더> [...] | score --raw <jsonl>');
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
