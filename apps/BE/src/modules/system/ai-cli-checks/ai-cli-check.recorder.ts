import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { ProgressEventsService } from '../../../common/events/progress-events.service.js';
import type { AiCliCheck } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import {
  AI_ENGINE_BINARY,
  AI_ENGINE_LABEL,
} from '../../integrations/ai-engine/ai-engine.constants.js';
import type { AiEngineCode } from '../../integrations/ai-engine/ai-engine.port.js';
import { AiExecutor } from '../../integrations/ai-engine/ai-executor.service.js';
import { CLOCK, type Clock } from '../../integrations/http/clock.token.js';
import type { AI_CLI_CHECK_TRIGGERS } from './ai-cli-check.dto.js';

export type AiCliCheckTrigger = (typeof AI_CLI_CHECK_TRIGGERS)[number];

export interface AiCliCheckOptions {
  /** 연결 테스트까지 할 엔진(설치됐고 로그인이 풀리지 않았을 때만 돈다). 나머지는 감지만(SKIPPED) */
  smokeTest: readonly AiEngineCode[];
  /** 연결 테스트 모델(설정의 텍스트 모델). 없으면 FAILED·MODEL_NOT_SET */
  models: Partial<Record<AiEngineCode, string | null>>;
  trigger: AiCliCheckTrigger;
}

/** 행의 error_message(한국어, 비밀·경로 없음) */
function notInstalledMessage(engine: AiEngineCode): string {
  return `${AI_ENGINE_LABEL[engine]} 실행 파일(${AI_ENGINE_BINARY[engine]})을 찾지 못했습니다. 설치한 뒤 다시 감지해 주세요.`;
}

function notLoggedInMessage(engine: AiEngineCode): string {
  return `${AI_ENGINE_LABEL[engine]}에 로그인되어 있지 않습니다. 터미널에서 본인 계정으로 로그인한 뒤 다시 감지해 주세요.`;
}

const MODEL_NOT_SET_MESSAGE =
  '연결 테스트에 쓸 텍스트 모델이 설정에 없습니다. AI 엔진 설정에서 모델을 골라 주세요.';

/**
 * AI CLI 점검 기록(P1-10 규칙 13, ERD §3.14 ai_cli_check, F-BS-67). 엔진마다 감지(`--version`·경로) + 로그인 확인
 * (claude·codex, agy는 UNKNOWN) → 설치됐고 테스트 대상이면 연결 테스트 1회(`AiExecutor.smokeTest`, call_log 1행) →
 * `ai_cli_check` 1행 INSERT(추가만) → SSE `ai-cli-check.completed`(binPath는 넣지 않는다).
 * - 미설치·SKIPPED는 model·latency_ms NULL(ck_ai_cli_check_not_installed·skipped)
 * - 로그인이 풀린 엔진은 연결 테스트를 하지 않는다(SKIPPED, error_code NOT_LOGGED_IN, Proposed)
 * - 점검은 한 번에 하나씩 돈다(앱 시작 점검과 P1-11 `POST /ai-cli-checks`가 겹쳐도 CLI를 동시에 부르지 않는다)
 * 앱 시작 점검(`AiEngineStartupCheck`)과 P1-11의 수동 점검이 이 클래스를 쓴다.
 */
@Injectable()
export class AiCliCheckRecorder implements OnApplicationShutdown {
  private readonly logger = new Logger(AiCliCheckRecorder.name);
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: AiExecutor,
    private readonly events: ProgressEventsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** 엔진마다 1행. 순서 = 넘긴 순서 */
  check(engineCodes: readonly AiEngineCode[], options: AiCliCheckOptions): Promise<AiCliCheck[]> {
    const run = this.queue.then(() => this.checkAll(engineCodes, options));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** 진행 중인 점검이 끝날 때까지(없으면 곧바로). AI 단계 시작 판정·테스트가 기다린다 */
  async whenIdle(): Promise<void> {
    let current: Promise<unknown>;
    do {
      current = this.queue;
      await current;
    } while (current !== this.queue);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.whenIdle();
  }

  private async checkAll(
    engineCodes: readonly AiEngineCode[],
    options: AiCliCheckOptions,
  ): Promise<AiCliCheck[]> {
    const rows: AiCliCheck[] = [];
    for (const engine of engineCodes) rows.push(await this.checkOne(engine, options));
    return rows;
  }

  private async checkOne(engine: AiEngineCode, options: AiCliCheckOptions): Promise<AiCliCheck> {
    const detection = await this.executor.detect(engine);
    const authStatus = detection.installed ? await this.executor.authStatus(engine) : 'UNKNOWN';
    let smokeStatus: 'PASSED' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
    let model: string | null = null;
    let latencyMs: number | null = null;
    let errorCode: string | null = null;
    let errorMessage: string | null = null;
    if (!detection.installed) {
      errorCode = 'NOT_INSTALLED';
      errorMessage = notInstalledMessage(engine);
    } else if (authStatus === 'NOT_LOGGED_IN') {
      errorCode = 'NOT_LOGGED_IN';
      errorMessage = notLoggedInMessage(engine);
    } else if (options.smokeTest.includes(engine)) {
      const wanted = options.models[engine];
      if (!wanted || wanted.trim() === '') {
        smokeStatus = 'FAILED';
        errorCode = 'MODEL_NOT_SET';
        errorMessage = MODEL_NOT_SET_MESSAGE;
      } else {
        const smoke = await this.executor.smokeTest(engine, wanted);
        smokeStatus = smoke.status;
        model = smoke.model.slice(0, 100);
        latencyMs = Math.max(0, Math.round(smoke.latencyMs));
        errorCode = smoke.errorCode;
        errorMessage = smoke.errorMessage;
      }
    }
    const row = await this.prisma.aiCliCheck.create({
      data: {
        engineCode: engine,
        trigger: options.trigger,
        installed: detection.installed,
        binPath: detection.installed ? (detection.binPath?.slice(0, 1024) ?? null) : null,
        cliVersion: detection.installed ? (detection.cliVersion?.slice(0, 40) ?? null) : null,
        versionSupported: detection.installed ? detection.versionSupported : null,
        authStatus,
        smokeStatus,
        model,
        latencyMs,
        errorCode: errorCode?.slice(0, 100) ?? null,
        errorMessage,
        checkedAt: this.clock.now(),
      },
    });
    this.events.publish('ai-cli-check.completed', {
      engineCode: engine,
      installed: row.installed,
      cliVersion: row.cliVersion,
      authStatus: row.authStatus as 'OK' | 'NOT_LOGGED_IN' | 'UNKNOWN',
      smokeStatus: row.smokeStatus as 'PASSED' | 'FAILED' | 'SKIPPED',
      latencyMs: row.latencyMs,
      errorCode: row.errorCode,
    });
    if (detection.installed && detection.versionSupported === false) {
      // 지원 밖 버전은 거절하지 않고 경고만(P1-10 Proposed, PRD §8.9 '버전')
      this.logger.warn(
        `${AI_ENGINE_LABEL[engine]} ${row.cliVersion ?? '?'}는 지원 범위 밖 버전입니다`,
      );
    }
    return row;
  }
}
