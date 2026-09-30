import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseAgyModels } from '../../src/modules/integrations/ai-engine/agy-models.provider.js';
import type {
  AiEngineAdapter,
  AiEngineAuthStatus,
  AiEngineCode,
  AiEngineDetection,
  AiEngineInputs,
  AiEngineSmokeResult,
  AiJsonSchema,
  AiRunOptions,
  AiStructuredResult,
} from '../../src/modules/integrations/ai-engine/ai-engine.port.js';
import type { PrismaService } from '../../src/prisma/prisma.service.js';

/** 가짜 어댑터 호출 기록 */
export interface FakeAiRunCall {
  task: string;
  model: string;
  timeoutMs: number;
  imagePaths: readonly string[];
  /** 프롬프트 길이만(본문은 남기지 않는다 — 테스트도 규칙 15를 따른다) */
  promptLength: number;
}

/**
 * 가짜 AI 엔진 어댑터(P1-10 e2e·단위). 프로세스를 띄우지 않는다. 테스트가 감지·로그인·연결 테스트·실행 결과를 정하고
 * 호출 수를 센다(스파이). `createTestApp`이 기본으로 `AI_ENGINE_ADAPTERS`를 이것으로 바꾼다(진짜 CLI를 부르지 않게, §8 주의).
 */
export class FakeAiEngineAdapter implements AiEngineAdapter {
  detection: AiEngineDetection;
  auth: AiEngineAuthStatus;
  /** 연결 테스트 결과(모델은 부른 값으로 채운다) */
  smoke: Omit<AiEngineSmokeResult, 'model'>;
  /** 구조화 실행: 결과 객체를 돌려주거나 던진다 */
  runImpl: (call: FakeAiRunCall) => unknown;
  /**
   * 모델 목록(`listModels`, P1-11 — `agy models`). AGY만 기본값이 fixture(agy/models.txt)이고 나머지는 null(목록 명령 없음).
   * 설치 안 됨이면 null을 준다
   */
  models: string[] | null = null;
  /** 연결 테스트를 이만큼 붙잡는다(점검 중 409 ALREADY_IN_PROGRESS 테스트). 풀면 끝난다 */
  smokeGate: Promise<void> | null = null;
  readonly calls = {
    detect: 0,
    authStatus: 0,
    smokeTest: [] as string[],
    runStructured: [] as FakeAiRunCall[],
    listModels: 0,
  };

  constructor(
    readonly code: AiEngineCode,
    defaults: { installed: boolean; cliVersion: string | null; auth: AiEngineAuthStatus },
  ) {
    this.detection = {
      installed: defaults.installed,
      binPath: defaults.installed ? `/usr/local/bin/${code.toLowerCase()}` : null,
      cliVersion: defaults.installed ? defaults.cliVersion : null,
      versionSupported: null,
    };
    this.auth = defaults.auth;
    this.smoke = { status: 'PASSED', latencyMs: 1200, errorCode: null, errorMessage: null };
    this.runImpl = () => ({ answer: 'OK' });
  }

  detect(): Promise<AiEngineDetection> {
    this.calls.detect += 1;
    return Promise.resolve({ ...this.detection });
  }

  authStatus(): Promise<AiEngineAuthStatus> {
    this.calls.authStatus += 1;
    return Promise.resolve(this.auth);
  }

  async smokeTest(model: string): Promise<AiEngineSmokeResult> {
    this.calls.smokeTest.push(model);
    if (this.smokeGate) await this.smokeGate;
    return { ...this.smoke, model };
  }

  listModels(): Promise<string[] | null> {
    this.calls.listModels += 1;
    return Promise.resolve(this.detection.installed && this.models ? [...this.models] : null);
  }

  async runStructured<T>(
    task: string,
    _schema: AiJsonSchema,
    inputs: AiEngineInputs,
    options: AiRunOptions,
  ): Promise<AiStructuredResult<T>> {
    const call: FakeAiRunCall = {
      task,
      model: options.model,
      timeoutMs: options.timeoutMs,
      imagePaths: inputs.imagePaths ?? [],
      promptLength: inputs.prompt.length,
    };
    this.calls.runStructured.push(call);
    const output = (await this.runImpl(call)) as T;
    return { output, model: options.model, cliVersion: this.detection.cliVersion, latencyMs: 900 };
  }

  resetCalls(): void {
    this.calls.detect = 0;
    this.calls.authStatus = 0;
    this.calls.smokeTest.length = 0;
    this.calls.runStructured.length = 0;
    this.calls.listModels = 0;
  }
}

/** `agy models` fixture를 모델 ID 목록으로(실제 파서 `parseAgyModels`를 지난다) */
export function agyModelsFixture(): string[] {
  return parseAgyModels(
    readFileSync(
      join(import.meta.dirname, '..', 'fixtures', 'ai-engine', 'agy', 'models.txt'),
      'utf8',
    ),
  );
}

/** 엔진 3개(기본: CLAUDE 설치·로그인·2.1.269, AGY 설치·1.2.9·UNKNOWN, CODEX 미설치) */
export class FakeAiEngines {
  readonly claude = new FakeAiEngineAdapter('CLAUDE', {
    installed: true,
    cliVersion: '2.1.269',
    auth: 'OK',
  });
  readonly agy = Object.assign(
    new FakeAiEngineAdapter('AGY', {
      installed: true,
      cliVersion: '1.2.9',
      auth: 'UNKNOWN',
    }),
    { models: agyModelsFixture() },
  );
  readonly codex = new FakeAiEngineAdapter('CODEX', {
    installed: false,
    cliVersion: null,
    auth: 'UNKNOWN',
  });

  /** AI_ENGINE_ADAPTERS에 끼울 배열 */
  get adapters(): AiEngineAdapter[] {
    return [this.claude, this.agy, this.codex];
  }

  of(engine: AiEngineCode): FakeAiEngineAdapter {
    return engine === 'CLAUDE' ? this.claude : engine === 'AGY' ? this.agy : this.codex;
  }

  /** 모든 엔진의 구조화 실행 호출 수 */
  totalRuns(): number {
    return this.adapters.reduce(
      (n, a) => n + (a as FakeAiEngineAdapter).calls.runStructured.length,
      0,
    );
  }

  resetCalls(): void {
    for (const a of [this.claude, this.agy, this.codex]) a.resetCalls();
  }
}

export function createFakeAiEngines(): FakeAiEngines {
  return new FakeAiEngines();
}

/** ai_cli_check 1행(테스트용, 없는 값은 쓸 수 있는 CLAUDE 기본값) */
export interface AiCliCheckSeed {
  engineCode?: AiEngineCode;
  trigger?: 'STARTUP' | 'MANUAL' | 'BEFORE_SAVE' | 'FIRST_RUN';
  installed?: boolean;
  cliVersion?: string | null;
  authStatus?: AiEngineAuthStatus;
  smokeStatus?: 'PASSED' | 'FAILED' | 'SKIPPED';
  model?: string | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  checkedAt?: Date;
}

/** ai_cli_check 행을 넣는다(추가만 — 정리는 TRUNCATE) */
export async function seedAiCliCheck(
  prisma: PrismaService,
  seed: AiCliCheckSeed = {},
): Promise<void> {
  const smokeStatus = seed.smokeStatus ?? 'PASSED';
  const skipped = smokeStatus === 'SKIPPED';
  const installed = seed.installed ?? true;
  const engineCode = seed.engineCode ?? 'CLAUDE';
  await prisma.aiCliCheck.create({
    data: {
      engineCode,
      trigger: seed.trigger ?? 'MANUAL',
      installed,
      binPath: installed ? `/usr/local/bin/${engineCode.toLowerCase()}` : null,
      cliVersion: installed ? (seed.cliVersion ?? '2.1.269') : null,
      versionSupported: null,
      authStatus: seed.authStatus ?? 'OK',
      smokeStatus,
      model: skipped ? null : (seed.model ?? 'sonnet'),
      latencyMs: skipped ? null : (seed.latencyMs ?? 1200),
      errorCode: seed.errorCode ?? null,
      errorMessage: seed.errorCode ? '테스트 점검 실패' : null,
      // e2e 가짜 시계 시작(2026-09-28 09:00 KST)과 같다 — 같은 시각이면 id가 큰 행이 최신이다
      checkedAt: seed.checkedAt ?? new Date('2026-09-28T00:00:00Z'),
    },
  });
}

/**
 * AI 단계를 돌리는 e2e(가짜 실행기 THUMBNAIL·COPY·NOTICE_RAW 등)의 준비: 점검 기록을 비우고 선택 엔진(기본 CLAUDE)이
 * 쓸 수 있는 행 1개를 넣는다(P1-10 규칙 11 — 행이 없으면 409 AI_ENGINE_UNAVAILABLE NOT_CHECKED).
 */
export async function seedUsableAiEngine(
  prisma: PrismaService,
  engineCode: AiEngineCode = 'CLAUDE',
): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE ai_cli_check RESTART IDENTITY');
  await seedAiCliCheck(prisma, { engineCode, trigger: 'STARTUP' });
}
